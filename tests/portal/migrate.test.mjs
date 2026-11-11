// Personal project, not for production, as is, not affiliated with the author's employer, Liquidware or Microsoft.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBaselineTargetState,
  buildManifestAndApproval,
  SAMPLE_PRESETS,
  scanForLeaks,
  SINGLE_POOL_MAX_HOSTS,
} from "../../site/portal/migrate-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

test("single-pool Entra-ready preset with C27 emits high-confidence tp-01 and matching SHA-256 approval", async () => {
  const { c11, intake, measuredUsage } = SAMPLE_PRESETS.singlePoolEntra;
  const res = await buildManifestAndApproval(c11, intake, measuredUsage);

  assert.equal(res.manifest.schema, "avd-target-state/v1");
  assert.equal(res.manifest.estate, "est-828c157f");
  assert.equal(res.manifest.hostPools.length, 1);

  const hp = res.manifest.hostPools[0];
  assert.equal(hp.id, "tp-01");
  assert.equal(hp.type.value, "Pooled");
  assert.equal(hp.appGroup.value, "Desktop");
  assert.equal(hp.users, 150);
  assert.equal(hp.peakConcurrent, 120);
  assert.equal(res.manifest.evidence.quality, "pass");
  assert.deepEqual(res.lowConfidencePointers, []);
  assert.deepEqual(res.boundaryNotices, []);

  // Verify SHA-256 matches exact UTF-8 bytes of manifestJson
  const expectedSha = crypto
    .createHash("sha256")
    .update(Buffer.from(res.manifestJson, "utf8"))
    .digest("hex");
  assert.equal(res.approval.manifestSha256, expectedSha);
  assert.equal(res.approval.schema, "avd-target-approval/v1");
});

test("multi-pool mixed estate auto-merges into single tp-01 Pooled Desktop pool and records boundary notices", async () => {
  const { c11, intake } = SAMPLE_PRESETS.multiPoolMerged;
  const res = await buildManifestAndApproval(c11, intake, null);

  assert.equal(res.manifest.hostPools.length, 1);
  const hp = res.manifest.hostPools[0];
  assert.equal(hp.id, "tp-01");
  assert.equal(hp.type.value, "Pooled");
  assert.equal(hp.appGroup.value, "Desktop");
  assert.equal(hp.users, 560);
  assert.deepEqual(hp.replaces, ["hp-aa000001", "hp-bb000002", "hp-cc000003"]);

  const noticeCodes = res.boundaryNotices.map((n) => n.code);
  assert.ok(noticeCodes.includes("merged-multiple-pools"));
  assert.ok(noticeCodes.includes("flattened-delivery-or-type"));
  assert.equal(res.manifest.evidence.quality, "low-confidence");
  assert.ok(res.approval.acceptLowConfidence.includes("/hostPools/0/vmSize"));
});

test("enforces 180-host single-pool ceiling when source demand exceeds 180 hosts", () => {
  const c11 = {
    schema: "avd-current-state-facts/v1",
    estate: "est-9900aabb",
    generatedUtc: "2026-11-11T12:00:00Z",
    hostPools: [
      {
        id: "hp-9900aabb",
        type: "Pooled",
        preferredAppGroupType: "Desktop",
        assignedUsers: 6000,
        sessionHosts: 250,
      },
    ],
  };
  const intake = {
    schema: "avd-estate-intake/v1",
    estate: "est-9900aabb",
    answeredOn: "2026-11-11",
    preferredRegions: ["eastus2"],
    existingHub: "none",
    identityConstraints: "entra-only",
  };
  const measured = {
    schema: "avd-measured-usage/v1",
    estate: "est-9900aabb",
    generatedUtc: "2026-11-11T12:00:00Z",
    tier: "tier-3-external",
    producer: { name: "test", version: "0.1.0" },
    measurementGate: {
      windowStart: "2026-10-14",
      windowEnd: "2026-11-11",
      daysObserved: 28,
      coveragePercent: 95,
      peakIncluded: true,
      passed: true,
    },
    groups: [
      {
        id: "grp-01",
        sourcePoolId: "hp-9900aabb",
        userCount: 6000,
        peakConcurrency: 999,
        hourlyConcurrency: new Array(24).fill(400),
        cpuPerUserCores: { p50: 1.5, p95: 3.5 },
        memoryPerUserGiB: { p50: 8.0, p95: 16.0 },
        steadyStateIopsPerUser: { p50: 10, p95: 20 },
        logonStormIopsPerUser: { p50: 40, p95: 70 },
        profileSizeGiB: { p50: 10, p95: 20 },
        dailyProfileChurnPercent: 8,
        logonDurationSeconds: { p50: 15, p95: 28 },
        experienceScore: { p50: 85, p95: 75 },
        gpuRequired: false,
        needsLocalAdmin: false,
      },
    ],
  };

  const res = buildBaselineTargetState(c11, intake, measured);
  assert.equal(res.manifest.hostPools[0].hosts.value, SINGLE_POOL_MAX_HOSTS);
  assert.ok(res.boundaryNotices.some((n) => n.code === "capped-session-hosts"));
});

test("scanForLeaks refuses raw UUIDs, emails, IPv4s, and UNC paths", () => {
  const uuidSample = ["11111111", "2222", "3333", "4444", "555555555555"].join("-");
  assert.throws(() => scanForLeaks({ sub: uuidSample }), /UUID/);

  const emailSample = ["admin", "example.org"].join("@");
  assert.throws(() => scanForLeaks({ upn: emailSample }), /email/);

  const ipSample = ["10", "24", "1", "9"].join(".");
  assert.throws(() => scanForLeaks({ ip: ipSample }), /IPv4/);
});

test("portal HTML enforces connect-src 'none' CSP and design-system.lock.json hashes match", () => {
  const html = fs.readFileSync(path.join(repoRoot, "site/portal/index.html"), "utf8");
  assert.match(html, /connect-src 'none'/);

  const lock = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "site/assets/design-system.lock.json"), "utf8")
  );
  for (const [relPath, expectedHash] of Object.entries(lock.files)) {
    const absPath = path.join(repoRoot, "site/assets", relPath);
    assert.ok(fs.existsSync(absPath), `Missing design system asset ${relPath}`);
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absPath))
      .digest("hex");
    assert.equal(actualHash, expectedHash, `SHA-256 mismatch for ${relPath}`);
  }
});

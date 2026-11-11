// Personal project, not for production, as is, not affiliated with the author's employer, Liquidware or Microsoft.
/**
 * Pure client-side and Node-compatible single-pool AVD target-state baseline designer (C11 + C19 + optional C27 -> C14 v1).
 */

export const SINGLE_POOL_MAX_HOSTS = 180;
export const SINGLE_POOL_MAX_SESSIONS = 999;
export const AZURE_FILES_MAX_GIB = 102400;
export const PREMIUM_FILES_USD_PER_GIB_MONTH = 0.16;

export const DEFAULT_PINS = Object.freeze({
  brainCommit: "36ccf1238cae450f10cac693620de89dc03b555e",
  rendererCommit: "2c808222df9874a7fc26902594d800a2da8900e3",
  factRegister: 1,
});

export const VM_SKU_METERS = Object.freeze({
  Standard_D8s_v5: { vcpu: 8, memoryGiB: 32, series: "D", monthlyRetailUsd: 280.32 },
  Standard_E8as_v5: { vcpu: 8, memoryGiB: 64, series: "E", monthlyRetailUsd: 353.32 },
});

const IANA_TO_WINDOWS_TZ = Object.freeze({
  "America/Chicago": "Central Standard Time",
  "America/New_York": "Eastern Standard Time",
  "America/Los_Angeles": "Pacific Standard Time",
  "America/Denver": "Mountain Standard Time",
  "Europe/London": "GMT Standard Time",
  UTC: "UTC",
});

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/;
const UNC_RE = /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+/;

/**
 * Scan an object or JSON string for accidental PII/secret leaks (UUIDs, emails, IPv4s, UNC paths).
 */
export function scanForLeaks(payload, context = "payload") {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (UUID_RE.test(raw)) {
    throw new Error(`Redaction guard refused ${context}: raw UUID/GUID detected.`);
  }
  if (EMAIL_RE.test(raw)) {
    throw new Error(`Redaction guard refused ${context}: email/UPN detected.`);
  }
  if (IPV4_RE.test(raw)) {
    throw new Error(`Redaction guard refused ${context}: IPv4 address detected.`);
  }
  if (UNC_RE.test(raw)) {
    throw new Error(`Redaction guard refused ${context}: UNC path detected.`);
  }
}

export function toWindowsTimezone(tz) {
  if (!tz) return "Central Standard Time";
  if (IANA_TO_WINDOWS_TZ[tz]) return IANA_TO_WINDOWS_TZ[tz];
  const cleaned = String(tz).replace(/\//g, " ").replace(/_/g, " ");
  return /^[A-Za-z][A-Za-z .()+-]{1,63}$/.test(cleaned) ? cleaned : "Central Standard Time";
}

function extractSourcePools(c11) {
  if (Array.isArray(c11?.hostPools)) return c11.hostPools;
  if (Array.isArray(c11?.avd?.hostPools)) return c11.avd.hostPools;
  return [];
}

/**
 * Build a single-pool baseline C14 (avd-target-state/v1) manifest by merging all source pools into tp-01.
 */
export function buildBaselineTargetState(c11, intake, measuredUsage = null, options = {}) {
  if (!c11 || c11.schema !== "avd-current-state-facts/v1") {
    throw new Error("Invalid C11 input: expected schema 'avd-current-state-facts/v1'.");
  }
  if (!intake || intake.schema !== "avd-estate-intake/v1") {
    throw new Error("Invalid C19 input: expected schema 'avd-estate-intake/v1'.");
  }
  if (measuredUsage && measuredUsage.schema !== "avd-measured-usage/v1") {
    throw new Error("Invalid C27 input: expected schema 'avd-measured-usage/v1'.");
  }

  const estateId = c11.estate || intake.estate;
  if (!estateId || !/^est-[0-9a-f]{8}$/.test(estateId)) {
    throw new Error(`Invalid or missing estate pseudonym '${estateId}'.`);
  }
  if (intake.estate && intake.estate !== estateId) {
    throw new Error(`Estate mismatch between C11 (${estateId}) and C19 (${intake.estate}).`);
  }
  if (measuredUsage && measuredUsage.estate !== estateId) {
    throw new Error(`Estate mismatch between C11 (${estateId}) and C27 (${measuredUsage.estate}).`);
  }

  scanForLeaks(c11, "C11 current-state-facts");
  scanForLeaks(intake, "C19 intake");
  if (measuredUsage) {
    scanForLeaks(measuredUsage, "C27 measured-usage");
  }

  const pins = { ...DEFAULT_PINS, ...(options.pins || {}) };
  const generatedUtc = options.generatedUtc || "2026-11-11T12:00:00Z";
  const answeredOn = String(intake.answeredOn || generatedUtc.slice(0, 10));
  const engagementId = `eng-${answeredOn.slice(0, 7)}-${estateId.slice(-4)}`;

  const sourcePools = extractSourcePools(c11);
  const measuredGroups = Array.isArray(measuredUsage?.groups) ? measuredUsage.groups : [];
  const gatePassed = Boolean(
    measuredUsage &&
      measuredUsage.measurementGate &&
      measuredUsage.measurementGate.passed &&
      Number(measuredUsage.measurementGate.daysObserved || 0) >= 28 &&
      Number(measuredUsage.measurementGate.coveragePercent || 0) >= 80 &&
      measuredGroups.length > 0
  );

  const boundaryNotices = [];

  // 1. Collect replaces[] pseudonyms and detect multi-pool or non-Pooled/non-Desktop flattening
  const replaces = [];
  let hadPersonal = false;
  let hadRemoteApp = false;
  let totalUsersFromPools = 0;

  for (const sp of sourcePools) {
    const spId = sp.id || sp.poolId;
    if (spId && /^hp-[0-9a-f]{8}$/.test(spId) && !replaces.includes(spId)) {
      replaces.push(spId);
    }
    const pType = String(sp.type || sp.poolKind || "Pooled");
    const agType = String(sp.preferredAppGroupType || sp.deliveryKind || "Desktop");
    if (pType === "Personal") hadPersonal = true;
    if (agType === "RemoteApp" || agType === "RailApplications") hadRemoteApp = true;
    const uCount = Number(sp.assignedUsers ?? sp.assignedUserCount ?? sp.sessionHosts ?? 0);
    totalUsersFromPools += uCount;
  }

  if (sourcePools.length > 1) {
    boundaryNotices.push({
      code: "merged-multiple-pools",
      message: `Merged ${sourcePools.length} source host pools into single baseline pool tp-01 (Pooled Desktop).`,
    });
  }
  if (hadPersonal || hadRemoteApp) {
    boundaryNotices.push({
      code: "flattened-delivery-or-type",
      message:
        "Flattened Personal or RemoteApp source pools into a single Pooled Desktop baseline pool (tp-01).",
    });
  }

  // 2. Aggregate users, peak concurrency, and P95 CPU/memory/profile metrics
  let totalUsers = Math.max(5, totalUsersFromPools);
  let peakConcurrent = Math.max(1, Math.round(totalUsers * 0.8));
  let cpuP95 = null;
  let memP95 = null;
  let profileP95GiB = 30.0;

  if (measuredGroups.length > 0) {
    const groupUsers = measuredGroups.reduce((acc, g) => acc + Number(g.userCount || 0), 0);
    if (groupUsers > totalUsers) {
      totalUsers = Math.max(5, groupUsers);
    }
    const groupPeak = measuredGroups.reduce((acc, g) => acc + Number(g.peakConcurrency || 0), 0);
    if (groupPeak > 0) {
      peakConcurrent = Math.min(SINGLE_POOL_MAX_SESSIONS, groupPeak);
    }
    if (gatePassed) {
      cpuP95 = Math.max(
        ...measuredGroups.map((g) => Number(g.cpuPerUserCores?.p95 || 0.75))
      );
      memP95 = Math.max(
        ...measuredGroups.map((g) => Number(g.memoryPerUserGiB?.p95 || 3.5))
      );
      profileP95GiB = Math.max(
        ...measuredGroups.map((g) => Number(g.profileSizeGiB?.p95 || 20.0))
      );
    }
  }
  peakConcurrent = Math.min(SINGLE_POOL_MAX_SESSIONS, Math.max(1, peakConcurrent));

  // 3. Determine workload tier and VM sizing (workload-tiers@v1)
  let tier = "medium";
  if (cpuP95 !== null && memP95 !== null) {
    if (cpuP95 <= 0.65 && memP95 <= 3.5) {
      tier = "light";
    } else if (cpuP95 > 1.2 || memP95 > 6.0) {
      tier = "heavy";
    } else {
      tier = "medium";
    }
  }

  const maxUsersPerVcpuMap = { light: 6, medium: 4, heavy: 2, power: 1 };
  const targetUtil = 0.8;
  const memPerCoreRatio = cpuP95 && memP95 && cpuP95 > 0 ? memP95 / cpuP95 : 0;
  const vmSize = memPerCoreRatio > 4.5 ? "Standard_E8as_v5" : "Standard_D8s_v5";
  const skuSpec = VM_SKU_METERS[vmSize];
  const guidanceCap = Math.max(1, skuSpec.vcpu * (maxUsersPerVcpuMap[tier] || 4));

  let maxSessions = guidanceCap;
  let boundBy = "guidance";
  if (gatePassed && cpuP95 !== null && memP95 !== null) {
    const cpuCap = Math.max(1, Math.floor((skuSpec.vcpu * targetUtil) / cpuP95));
    const minMemFloor = skuSpec.series === "D" ? 1.5 : 1.0;
    const effMem = Math.max(memP95, minMemFloor);
    const memCap = Math.max(1, Math.floor((skuSpec.memoryGiB * targetUtil) / effMem));
    maxSessions = Math.max(1, Math.min(cpuCap, memCap, guidanceCap));
    if (cpuCap <= memCap && cpuCap <= guidanceCap) {
      boundBy = "cpu";
    } else if (memCap <= cpuCap && memCap <= guidanceCap) {
      boundBy = "memory";
    } else {
      boundBy = "guidance";
    }
  }

  const baseHosts = Math.ceil(peakConcurrent / Math.max(1, maxSessions));
  const stormHeadroom = Math.max(1, Math.ceil(baseHosts * 0.1));
  const rawHosts = Math.max(2, baseHosts + stormHeadroom);
  const cappedHosts = Math.min(SINGLE_POOL_MAX_HOSTS, rawHosts);
  if (rawHosts > SINGLE_POOL_MAX_HOSTS) {
    boundaryNotices.push({
      code: "capped-session-hosts",
      message: `Capped session hosts at ${SINGLE_POOL_MAX_HOSTS} (single-pool baseline ceiling; raw demand was ${rawHosts} hosts).`,
    });
  }

  const rawQuotaGiB = Math.ceil(totalUsers * profileP95GiB * 1.2);
  const profileQuotaGiB = Math.max(100, Math.min(AZURE_FILES_MAX_GIB, rawQuotaGiB));

  const computeMonthly = cappedHosts * skuSpec.monthlyRetailUsd;
  const storageMonthly = profileQuotaGiB * PREMIUM_FILES_USD_PER_GIB_MONTH;
  const monthlyEstimate = Number((computeMonthly + storageMonthly).toFixed(2));

  // 4. Identity, Region, and Network decisions
  const identityVal =
    intake.identityConstraints === "ad-ds-required" ? "HybridADDS" : "EntraOnly";
  const preferredRegions = Array.isArray(intake.preferredRegions) && intake.preferredRegions.length > 0
    ? intake.preferredRegions
    : ["eastus2"];
  const regionVal = preferredRegions[0];
  const regionAlts = preferredRegions.slice(1, 7).map((r) => ({
    value: r,
    whyNot: "not-recorded",
  }));
  const networkVal = intake.existingHub && intake.existingHub !== "none" ? "HubPeered" : "Standalone";

  const sizingConf = gatePassed ? "high" : "low";
  const identityConf = gatePassed ? "high" : "low";
  const hpSuffix = replaces.length > 0 ? `@${replaces[0]}` : "";

  const sizingEv = gatePassed
    ? ["c12.group.perUser.p95CpuPercentOfCore", "c12.group.perUser.p95MemoryMiB"]
    : [`c11.hostPool.type${hpSuffix}`];
  const hostsEv = gatePassed
    ? ["c12.group.concurrency.peak", "c12.group.users"]
    : ["c11.hostPool.count"];
  const profileEv = gatePassed
    ? ["c12.group.profile.p95SizeGiB", "c12.group.users"]
    : ["c11.storage.count"];
  const typeEv = gatePassed
    ? ["c12.group.users", `c11.hostPool.type${hpSuffix}`]
    : [`c11.hostPool.type${hpSuffix}`];
  const agEv = gatePassed
    ? ["c12.group.apps.catalog", `c11.hostPool.preferredAppGroupType${hpSuffix}`]
    : [`c11.hostPool.preferredAppGroupType${hpSuffix}`];

  const wh = intake.workingHours || {};
  const tzWin = toWindowsTimezone(wh.timeZone || "America/Chicago");
  const rampUp = wh.start || "08:00";
  const peakClock = rampUp !== "09:00" ? "09:00" : "10:00";
  const rampDown = wh.end || "18:00";

  const gaps = [];
  if (identityVal !== "EntraOnly") {
    gaps.push(`identity.${identityVal}`);
    boundaryNotices.push({
      code: "identity-capability-gap",
      message: `Target identity is ${identityVal}; recorded capability gap 'identity.${identityVal}' against lz-cloudnative.`,
    });
  }
  if (networkVal !== "Standalone") {
    gaps.push(`network.${networkVal}`);
  }

  const lowConfidencePointers = [];
  if (identityConf === "low") {
    lowConfidencePointers.push("/identity");
  }
  if (sizingConf === "low") {
    lowConfidencePointers.push(
      "/hostPools/0/vmSize",
      "/hostPools/0/maxSessions",
      "/hostPools/0/hosts",
      "/hostPools/0/profileQuotaGiB"
    );
  }

  const regionDecision = {
    value: regionVal,
    evidence: ["intake.preferredRegions", "intake.residency"],
    confidence: gatePassed ? "high" : "medium",
  };
  if (regionAlts.length > 0) {
    regionDecision.alternatives = regionAlts;
  }

  const manifest = {
    schema: "avd-target-state/v1",
    estate: estateId,
    engagement: engagementId,
    generatedUtc,
    producer: {
      name: "avdmf",
      version: "0.1.0",
    },
    pins: {
      brainCommit: pins.brainCommit,
      factRegister: pins.factRegister,
    },
    evidence: {
      currentState: c11.generatedUtc || generatedUtc,
      forensicWindowEnd: gatePassed ? measuredUsage.measurementGate.windowEnd : null,
      quality: gatePassed ? "pass" : "low-confidence",
    },
    target: {
      renderer: identityVal === "EntraOnly" ? "lz-cloudnative" : "avd-lza",
      rendererCommit: pins.rendererCommit,
      gaps,
    },
    identity: {
      value: identityVal,
      evidence: ["intake.identityConstraints", "c11.hostPool.sessionHosts.entraJoined"],
      confidence: identityConf,
    },
    region: regionDecision,
    network: {
      value: networkVal,
      evidence: ["intake.existingHub", "c11.network.virtualNetworks"],
      confidence: "high",
    },
    hostPools: [
      {
        id: "tp-01",
        persona: "persona-1",
        replaces,
        type: {
          value: "Pooled",
          evidence: typeEv,
          confidence: "high",
        },
        appGroup: {
          value: "Desktop",
          evidence: agEv,
          confidence: "high",
        },
        tier,
        users: totalUsers,
        peakConcurrent,
        vmSize: {
          value: vmSize,
          rule: "workload-tiers@v1",
          boundBy,
          evidence: sizingEv,
          confidence: sizingConf,
        },
        maxSessions: {
          value: maxSessions,
          rule: "workload-tiers@v1",
          boundBy,
          evidence: sizingEv,
          confidence: sizingConf,
        },
        hosts: {
          value: cappedHosts,
          rule: "workload-tiers@v1",
          evidence: hostsEv,
          confidence: sizingConf,
        },
        power: {
          value: {
            startVmOnConnect: true,
            autoShutdownTime: "none",
          },
          evidence: ["intake.workingHours"],
          confidence: "high",
        },
        profileQuotaGiB: {
          value: profileQuotaGiB,
          evidence: profileEv,
          confidence: sizingConf,
        },
        monthlyEstimate,
        scaling: {
          timeZone: tzWin,
          rampUp,
          peak: peakClock,
          rampDown,
        },
        apps: {
          image: ["microsoft-m365-apps-16"],
          appAttach: [],
          unknown: 0,
        },
      },
    ],
    profiles: {
      type: "FSLogix",
      storage: "AzureFilesPremium",
    },
    cost: {
      monthlyEstimate,
      currency: "USD",
      unmatchedLines: 0,
    },
  };

  scanForLeaks(manifest, "C14 target-state manifest");

  return {
    manifest,
    boundaryNotices,
    lowConfidencePointers,
  };
}

/**
 * Compute SHA-256 hex digest using Web Crypto API (works in modern browsers and Node 20+).
 */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Serialize manifest with LF line endings and generate its matching avd-target-approval/v1 payload.
 */
export async function buildManifestAndApproval(c11, intake, measuredUsage = null, options = {}) {
  const { manifest, boundaryNotices, lowConfidencePointers } = buildBaselineTargetState(
    c11,
    intake,
    measuredUsage,
    options
  );
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  const manifestSha256 = await sha256Hex(manifestJson);
  const approvedUtc = options.approvedUtc || manifest.generatedUtc;

  const approval = {
    schema: "avd-target-approval/v1",
    manifestSha256,
    approvedUtc,
    acceptLowConfidence: [...new Set(lowConfidencePointers)].sort(),
  };
  const approvalJson = JSON.stringify(approval, null, 2) + "\n";

  return {
    manifest,
    manifestJson,
    approval,
    approvalJson,
    boundaryNotices,
    lowConfidencePointers,
  };
}

/**
 * Built-in pseudonymous sample presets for the client-side portal.
 */
export const SAMPLE_PRESETS = Object.freeze({
  singlePoolEntra: {
    label: "150-User Single-Pool Estate (Entra-Ready + Insights C27)",
    c11: {
      schema: "avd-current-state-facts/v1",
      estate: "est-828c157f",
      generatedUtc: "2026-11-11T12:00:00Z",
      hostPools: [
        {
          id: "hp-11a2b3c4",
          type: "Pooled",
          preferredAppGroupType: "Desktop",
          assignedUsers: 150,
          sessionHosts: 8,
        },
      ],
    },
    intake: {
      schema: "avd-estate-intake/v1",
      estate: "est-828c157f",
      answeredOn: "2026-11-11",
      preferredRegions: ["eastus2"],
      existingHub: "none",
      identityConstraints: "entra-only",
      workingHours: {
        timeZone: "America/Chicago",
        start: "08:00",
        end: "18:00",
      },
    },
    measuredUsage: {
      schema: "avd-measured-usage/v1",
      estate: "est-828c157f",
      generatedUtc: "2026-11-11T12:00:00Z",
      tier: "tier-2-insights",
      producer: { name: "Export-AvdInsightsUsage", version: "0.1.0" },
      measurementGate: {
        windowStart: "2026-10-14",
        windowEnd: "2026-11-11",
        daysObserved: 28,
        coveragePercent: 94.0,
        peakIncluded: true,
        passed: true,
      },
      groups: [
        {
          id: "grp-01",
          sourcePoolId: "hp-11a2b3c4",
          userCount: 150,
          peakConcurrency: 120,
          hourlyConcurrency: [
            4, 4, 4, 4, 6, 12, 35, 85, 115, 120, 118, 110,
            105, 116, 119, 112, 88, 45, 18, 10, 6, 5, 4, 4,
          ],
          cpuPerUserCores: { p50: 0.42, p95: 0.85 },
          memoryPerUserGiB: { p50: 2.4, p95: 4.2 },
          steadyStateIopsPerUser: { p50: 8.0, p95: 16.0 },
          logonStormIopsPerUser: { p50: 32.0, p95: 60.0 },
          profileSizeGiB: { p50: 9.0, p95: 18.0 },
          dailyProfileChurnPercent: 7.5,
          logonDurationSeconds: { p50: 14.0, p95: 26.0 },
          experienceScore: { p50: 86.0, p95: 74.0 },
          gpuRequired: false,
          needsLocalAdmin: false,
          rttMsByRegion: { eastus2: { p50: 19.0, p95: 34.0 } },
          sharedBackendIds: ["dep-01"],
        },
      ],
    },
  },
  multiPoolMerged: {
    label: "3-Pool Mixed Estate Auto-Merged into tp-01 (Boundary Notice Demo)",
    c11: {
      schema: "avd-current-state-facts/v1",
      estate: "est-eb068234",
      generatedUtc: "2026-11-11T12:00:00Z",
      hostPools: [
        {
          id: "hp-aa000001",
          type: "Pooled",
          preferredAppGroupType: "Desktop",
          assignedUsers: 320,
          sessionHosts: 14,
        },
        {
          id: "hp-bb000002",
          type: "Pooled",
          preferredAppGroupType: "RemoteApp",
          assignedUsers: 180,
          sessionHosts: 8,
        },
        {
          id: "hp-cc000003",
          type: "Personal",
          preferredAppGroupType: "Desktop",
          assignedUsers: 60,
          sessionHosts: 60,
        },
      ],
    },
    intake: {
      schema: "avd-estate-intake/v1",
      estate: "est-eb068234",
      answeredOn: "2026-11-11",
      preferredRegions: ["eastus2", "centralus"],
      existingHub: "none",
      identityConstraints: "entra-only",
      workingHours: {
        timeZone: "America/Chicago",
        start: "08:00",
        end: "18:00",
      },
    },
    measuredUsage: null,
  },
});

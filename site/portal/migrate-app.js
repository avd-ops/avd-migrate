// Personal project, not for production, as is, not affiliated with the author's employer, Liquidware or Microsoft.
/**
 * Browser UI controller for migrate.avd-ops.dev single-pool baseline designer.
 */

import { buildManifestAndApproval, SAMPLE_PRESETS } from "./migrate-core.js";

const state = {
  c11: null,
  intake: null,
  measuredUsage: null,
  migrationMode: "same-tenant",
  lastResult: null,
};

function downloadJsonFile(filename, content) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function renderCurrentState() {
  const banner = document.getElementById("status-banner");
  const noticesBox = document.getElementById("boundary-notices");
  const summaryBox = document.getElementById("summary-cards");
  const preview = document.getElementById("manifest-preview");
  const snippet = document.getElementById("cloudshell-snippet");
  const btnManifest = document.getElementById("btn-download-manifest");
  const btnApproval = document.getElementById("btn-download-approval");
  const btnT2t = document.getElementById("btn-download-t2t-checklist");

  if (!state.c11 || !state.intake) {
    banner.textContent = "Waiting for both C11 (current-state-facts.json) and C19 (intake.json).";
    return;
  }

  try {
    const res = await buildManifestAndApproval(state.c11, state.intake, state.measuredUsage, {
      migrationMode: state.migrationMode,
    });
    state.lastResult = res;
    const hp = res.manifest.hostPools[0];

    banner.textContent = `RESULT PASS: Designed ${res.manifest.estate} (${hp.id}, ${res.migrationMode}, ${hp.hosts.value} hosts, $${res.manifest.cost.monthlyEstimate.toFixed(2)}/mo, SHA-256 ${res.approval.manifestSha256.slice(0, 12)}...)`;

    if (res.boundaryNotices.length > 0) {
      noticesBox.hidden = false;
      noticesBox.innerHTML =
        "<h3>Single-Pool Baseline Notices</h3><ul>" +
        res.boundaryNotices.map((n) => `<li><strong>${n.code}</strong>: ${n.message}</li>`).join("") +
        "</ul>";
    } else {
      noticesBox.hidden = true;
      noticesBox.innerHTML = "";
    }

    summaryBox.innerHTML = `
      <ul>
        <li><strong>Estate / Engagement:</strong> <code>${res.manifest.estate}</code> / <code>${res.manifest.engagement}</code></li>
        <li><strong>Target Pool:</strong> <code>${hp.id}</code> (${hp.type.value} ${hp.appGroup.value}, tier <code>${hp.tier}</code>)</li>
        <li><strong>Users / Peak Concurrent:</strong> ${hp.users} users / ${hp.peakConcurrent} concurrent</li>
        <li><strong>VM SKU &amp; Sessions:</strong> <code>${hp.vmSize.value}</code> &times; ${hp.hosts.value} hosts (${hp.maxSessions.value} max sessions/host, bound by <code>${hp.vmSize.boundBy}</code>)</li>
        <li><strong>Profile Quota:</strong> ${hp.profileQuotaGiB.value} GiB (<code>${res.manifest.profiles.storage}</code>)</li>
        <li><strong>Estimated Retail Cost:</strong> $${res.manifest.cost.monthlyEstimate.toFixed(2)} USD/month</li>
        <li><strong>Evidence Quality:</strong> <code>${res.manifest.evidence.quality}</code> (${res.lowConfidencePointers.length} low-confidence pointer(s))</li>
      </ul>
    `;

    preview.textContent = res.manifestJson;
    const snippetHeader =
      res.migrationMode === "basic-t2t"
        ? "# Render avd.bicepparam in avd-landing-zone (supply destination-tenant Subscription & Group Object IDs):"
        : "# Render avd.bicepparam in avd-landing-zone:";
    snippet.textContent = [
      snippetHeader,
      "./scripts/ConvertFrom-AvdTargetState.ps1 `",
      "    -ManifestPath ./manifest.json `",
      "    -ApprovalPath ./manifest.approval.json `",
      "    -SubscriptionId $DestinationSubscriptionId `",
      "    -AvdUsersGroupObjectId $DestinationAvdUsersGroupObjectId `",
      "    -AvdAdminsGroupObjectId $DestinationAvdAdminsGroupObjectId `",
      "    -OutputPath ./avd.bicepparam",
    ].join("\n");

    btnManifest.disabled = false;
    btnApproval.disabled = false;
    if (btnT2t) {
      btnT2t.disabled = !res.t2tChecklistJson;
    }
  } catch (err) {
    banner.textContent = `ERROR: ${err.message}`;
    btnManifest.disabled = true;
    btnApproval.disabled = true;
    if (btnT2t) {
      btnT2t.disabled = true;
    }
  }
}

function wireFileInput(inputId, stateKey) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    state[stateKey] = JSON.parse(text);
    await renderCurrentState();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireFileInput("file-c11", "c11");
  wireFileInput("file-c19", "intake");
  wireFileInput("file-c27", "measuredUsage");

  const modeSelect = document.getElementById("select-migration-mode");
  modeSelect?.addEventListener("change", async (ev) => {
    state.migrationMode = ev.target.value || "same-tenant";
    await renderCurrentState();
  });

  document.getElementById("btn-preset-single")?.addEventListener("click", async () => {
    state.c11 = structuredClone(SAMPLE_PRESETS.singlePoolEntra.c11);
    state.intake = structuredClone(SAMPLE_PRESETS.singlePoolEntra.intake);
    state.measuredUsage = structuredClone(SAMPLE_PRESETS.singlePoolEntra.measuredUsage);
    state.migrationMode = "same-tenant";
    if (modeSelect) modeSelect.value = "same-tenant";
    await renderCurrentState();
  });

  document.getElementById("btn-preset-multi")?.addEventListener("click", async () => {
    state.c11 = structuredClone(SAMPLE_PRESETS.multiPoolMerged.c11);
    state.intake = structuredClone(SAMPLE_PRESETS.multiPoolMerged.intake);
    state.measuredUsage = null;
    state.migrationMode = "same-tenant";
    if (modeSelect) modeSelect.value = "same-tenant";
    await renderCurrentState();
  });

  document.getElementById("btn-preset-t2t")?.addEventListener("click", async () => {
    state.c11 = structuredClone(SAMPLE_PRESETS.basicT2tEntra.c11);
    state.intake = structuredClone(SAMPLE_PRESETS.basicT2tEntra.intake);
    state.measuredUsage = null;
    state.migrationMode = "basic-t2t";
    if (modeSelect) modeSelect.value = "basic-t2t";
    await renderCurrentState();
  });

  document.getElementById("btn-download-manifest")?.addEventListener("click", () => {
    if (state.lastResult) {
      downloadJsonFile("manifest.json", state.lastResult.manifestJson);
    }
  });

  document.getElementById("btn-download-approval")?.addEventListener("click", () => {
    if (state.lastResult) {
      downloadJsonFile("manifest.approval.json", state.lastResult.approvalJson);
    }
  });

  document.getElementById("btn-download-t2t-checklist")?.addEventListener("click", () => {
    if (state.lastResult?.t2tChecklistJson) {
      downloadJsonFile("t2t-checklist.json", state.lastResult.t2tChecklistJson);
    }
  });
});

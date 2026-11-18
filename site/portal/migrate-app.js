// Personal project, not for production, as is, not affiliated with the author's employer, Liquidware or Microsoft.
/**
 * Browser UI controller for avd-ops.app/migrate/ single-pool baseline designer.
 */

import { buildManifestAndApproval, SAMPLE_PRESETS } from "./migrate-core.js";

const STEP_LABELS = ["Load estate", "Review baseline", "Export & hand off"];

const state = {
  c11: null,
  intake: null,
  measuredUsage: null,
  migrationMode: "same-tenant",
  lastResult: null,
  step: 0,
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

function setStatusReply(tone, headline, detail) {
  const bl = document.getElementById("status-bl");
  const banner = document.getElementById("status-banner");
  if (bl) {
    bl.className = tone ? `bl ${tone}` : "bl";
    bl.textContent = headline;
  }
  if (banner) {
    banner.textContent = detail;
  }
}

function setDropState(dropId, nameId, fileName) {
  const drop = document.getElementById(dropId);
  const nameEl = document.getElementById(nameId);
  if (drop) {
    drop.classList.toggle("loaded", Boolean(fileName));
  }
  if (nameEl) {
    nameEl.textContent = fileName || "";
  }
}

function syncWizardChrome() {
  const ready = Boolean(state.lastResult);
  const stages = document.querySelectorAll(".wz-stage");
  stages.forEach((stage, idx) => {
    stage.classList.toggle("hidden", idx !== state.step);
  });

  document.querySelectorAll(".wz-list button.step").forEach((btn, idx) => {
    const unlocked = idx === 0 || ready;
    btn.disabled = !unlocked;
    btn.classList.toggle("done", idx < state.step || (idx === 0 && ready && state.step > 0));
    if (idx === state.step) {
      btn.setAttribute("aria-current", "step");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  document.querySelectorAll(".wz-progress button.seg").forEach((seg, idx) => {
    const unlocked = idx === 0 || ready;
    seg.disabled = !unlocked;
    seg.classList.toggle("current", idx === state.step);
    seg.classList.toggle("done", idx < state.step || (idx === 0 && ready && state.step > 0));
  });

  const prev = document.getElementById("btn-prev");
  const next = document.getElementById("btn-next");
  const where = document.getElementById("step-where");
  if (prev) prev.disabled = state.step === 0;
  if (next) {
    next.disabled = !ready || state.step >= STEP_LABELS.length - 1;
    next.textContent = state.step === 1 ? "Continue to export" : "Next";
  }
  if (where) {
    where.textContent = `Step ${state.step + 1} of ${STEP_LABELS.length} · ${STEP_LABELS[state.step]}`;
  }
}

function goToStep(index) {
  if (index < 0 || index >= STEP_LABELS.length) return;
  if (index > 0 && !state.lastResult) return;
  state.step = index;
  syncWizardChrome();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderCurrentState() {
  const noticesBox = document.getElementById("boundary-notices");
  const summaryBox = document.getElementById("summary-cards");
  const preview = document.getElementById("manifest-preview");
  const snippet = document.getElementById("cloudshell-snippet");
  const btnManifest = document.getElementById("btn-download-manifest");
  const btnApproval = document.getElementById("btn-download-approval");
  const btnT2t = document.getElementById("btn-download-t2t-checklist");
  const btnLza = document.getElementById("btn-download-lza-bicepparam");

  if (!state.c11 || !state.intake) {
    state.lastResult = null;
    setStatusReply("ok", "Waiting for inputs", "Load both C11 (current-state-facts.json) and C19 (intake.json), or pick a sample preset.");
    syncWizardChrome();
    return;
  }

  try {
    const res = await buildManifestAndApproval(state.c11, state.intake, state.measuredUsage, {
      migrationMode: state.migrationMode,
    });
    state.lastResult = res;
    const hp = res.manifest.hostPools[0];

    setStatusReply(
      "good",
      `Baseline ready · ${hp.id} (${hp.hosts.value} hosts)`,
      `Designed ${res.manifest.estate} (${res.migrationMode}, $${res.manifest.cost.monthlyEstimate.toFixed(2)}/mo, SHA-256 ${res.approval.manifestSha256.slice(0, 12)}...). Select Next to review.`
    );

    if (res.boundaryNotices.length > 0) {
      noticesBox.hidden = false;
      noticesBox.innerHTML =
        "<h3>Single-Pool Baseline Notices</h3><ul>" +
        res.boundaryNotices.map((n) => `<li><strong>${escapeHtml(n.code)}</strong>: ${escapeHtml(n.message)}</li>`).join("") +
        "</ul>";
    } else {
      noticesBox.hidden = true;
      noticesBox.innerHTML = "";
    }

    summaryBox.innerHTML = `
      <div class="kpis">
        <div class="kpi">
          <div class="kpi-label">Target Pool</div>
          <div class="kpi-val"><code>${escapeHtml(hp.id)}</code></div>
          <div class="kpi-sub">${escapeHtml(hp.type.value)} ${escapeHtml(hp.appGroup.value)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Session Hosts</div>
          <div class="kpi-val">${hp.hosts.value} &times; <code>${escapeHtml(hp.vmSize.value)}</code></div>
          <div class="kpi-sub">${hp.maxSessions.value} max sessions/host</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Estimated Cost</div>
          <div class="kpi-val">$${res.manifest.cost.monthlyEstimate.toFixed(2)}/mo</div>
          <div class="kpi-sub">Retail USD (${hp.profileQuotaGiB.value} GiB FSLogix)</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Evidence Quality</div>
          <div class="kpi-val">${escapeHtml(res.manifest.evidence.quality)}</div>
          <div class="kpi-sub">${res.lowConfidencePointers.length} low-confidence pointer(s)</div>
        </div>
      </div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Baseline specification">
        <table class="kv">
          <tbody>
            <tr><th scope="row">Estate / Engagement</th><td><code>${escapeHtml(res.manifest.estate)}</code> / <code>${escapeHtml(res.manifest.engagement)}</code></td></tr>
            <tr><th scope="row">Migration Mode</th><td><code>${escapeHtml(res.migrationMode)}</code> (tier <code>${escapeHtml(hp.tier)}</code>)</td></tr>
            <tr><th scope="row">Users / Peak Concurrent</th><td>${hp.users} users / ${hp.peakConcurrent} concurrent</td></tr>
            <tr><th scope="row">VM Sizing Constraint</th><td>Bound by <code>${escapeHtml(hp.vmSize.boundBy)}</code></td></tr>
            <tr><th scope="row">Profile Storage</th><td>${hp.profileQuotaGiB.value} GiB (<code>${escapeHtml(res.manifest.profiles.storage)}</code>)</td></tr>
            <tr><th scope="row">Approval SHA-256</th><td><code>${escapeHtml(res.approval.manifestSha256)}</code></td></tr>
          </tbody>
        </table>
      </div>
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
    if (btnT2t) btnT2t.disabled = !res.t2tChecklistJson;
    if (btnLza) btnLza.disabled = !res.lzaBicepparamStarter;
    syncWizardChrome();
  } catch (err) {
    state.lastResult = null;
    setStatusReply("poor", "Could not design baseline", err.message);
    btnManifest.disabled = true;
    btnApproval.disabled = true;
    if (btnT2t) btnT2t.disabled = true;
    if (btnLza) btnLza.disabled = true;
    syncWizardChrome();
  }
}

function wireFileInput(inputId, stateKey, dropId, nameId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      state[stateKey] = JSON.parse(text);
      setDropState(dropId, nameId, file.name);
      await renderCurrentState();
    } catch (err) {
      setDropState(dropId, nameId, "");
      setStatusReply("poor", `Invalid JSON in ${file.name}`, err.message);
    }
  });
}

function resetDesigner() {
  state.c11 = null;
  state.intake = null;
  state.measuredUsage = null;
  state.migrationMode = "same-tenant";
  state.lastResult = null;
  state.step = 0;

  ["file-c11", "file-c19", "file-c27"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  setDropState("drop-c11", "file-c11-name", "");
  setDropState("drop-c19", "file-c19-name", "");
  setDropState("drop-c27", "file-c27-name", "");

  const modeSelect = document.getElementById("select-migration-mode");
  if (modeSelect) modeSelect.value = "same-tenant";

  const noticesBox = document.getElementById("boundary-notices");
  if (noticesBox) {
    noticesBox.hidden = true;
    noticesBox.innerHTML = "";
  }
  const summaryBox = document.getElementById("summary-cards");
  if (summaryBox) summaryBox.innerHTML = "";
  const preview = document.getElementById("manifest-preview");
  if (preview) preview.textContent = "{}";

  setStatusReply("ok", "Ready to design", "Select a sample preset or drop your JSON files above.");
  syncWizardChrome();
}

document.addEventListener("DOMContentLoaded", () => {
  wireFileInput("file-c11", "c11", "drop-c11", "file-c11-name");
  wireFileInput("file-c19", "intake", "drop-c19", "file-c19-name");
  wireFileInput("file-c27", "measuredUsage", "drop-c27", "file-c27-name");

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
    setDropState("drop-c11", "file-c11-name", "preset: single-pool C11");
    setDropState("drop-c19", "file-c19-name", "preset: single-pool C19");
    setDropState("drop-c27", "file-c27-name", "preset: 28-day C27");
    await renderCurrentState();
  });

  document.getElementById("btn-preset-multi")?.addEventListener("click", async () => {
    state.c11 = structuredClone(SAMPLE_PRESETS.multiPoolMerged.c11);
    state.intake = structuredClone(SAMPLE_PRESETS.multiPoolMerged.intake);
    state.measuredUsage = null;
    state.migrationMode = "same-tenant";
    if (modeSelect) modeSelect.value = "same-tenant";
    setDropState("drop-c11", "file-c11-name", "preset: 3-pool C11");
    setDropState("drop-c19", "file-c19-name", "preset: 3-pool C19");
    setDropState("drop-c27", "file-c27-name", "");
    await renderCurrentState();
  });

  document.getElementById("btn-preset-t2t")?.addEventListener("click", async () => {
    state.c11 = structuredClone(SAMPLE_PRESETS.basicT2tEntra.c11);
    state.intake = structuredClone(SAMPLE_PRESETS.basicT2tEntra.intake);
    state.measuredUsage = null;
    state.migrationMode = "basic-t2t";
    if (modeSelect) modeSelect.value = "basic-t2t";
    setDropState("drop-c11", "file-c11-name", "preset: T2T C11");
    setDropState("drop-c19", "file-c19-name", "preset: T2T C19");
    setDropState("drop-c27", "file-c27-name", "");
    await renderCurrentState();
  });

  document.querySelectorAll(".wz-list button.step, .wz-progress button.seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-step"));
      goToStep(idx);
    });
  });

  document.getElementById("btn-prev")?.addEventListener("click", () => goToStep(state.step - 1));
  document.getElementById("btn-next")?.addEventListener("click", () => goToStep(state.step + 1));
  document.getElementById("btn-reset")?.addEventListener("click", resetDesigner);

  document.getElementById("btn-copy-snippet")?.addEventListener("click", async () => {
    const snippet = document.getElementById("cloudshell-snippet");
    const btn = document.getElementById("btn-copy-snippet");
    if (!snippet || !btn || !navigator.clipboard) return;
    await navigator.clipboard.writeText(snippet.textContent || "");
    const orig = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
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

  document.getElementById("btn-download-lza-bicepparam")?.addEventListener("click", () => {
    if (state.lastResult?.lzaBicepparamStarter) {
      downloadJsonFile("lza.starter.bicepparam", state.lastResult.lzaBicepparamStarter);
    }
  });

  syncWizardChrome();
});

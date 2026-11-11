# Threat Model — avd-migrate (`migrate.avd-ops.dev`)

> **Personal project, not for production.** Provided as is, without warranty of any kind (MIT License). Not affiliated with, endorsed by or supported by the author's employer, Liquidware or Microsoft.

## Trust Boundaries

1. **Pseudonymous Input Boundary (`C11`, `C19`, `C27`):**
   - `avd-migrate` accepts only pseudonymous JSON documents (`est-xxxxxxxx`, `hp-xxxxxxxx`, `grp-xx`) containing zero raw Azure subscription GUIDs, tenant IDs, UPNs, hostnames, or SMB UNC paths.
   - Both the browser portal (`site/portal/migrate-core.js`) and the PowerShell CLI (`ConvertTo-AvdTargetState.ps1`) run a leak-detection scan over input and output JSON and refuse to emit a manifest if a raw GUID, email, IPv4 address, or UNC path is detected.
2. **Client-Side Zero-Egress Boundary (`site/portal/`):**
   - `site/portal/index.html` enforces `connect-src 'none'` via Content Security Policy. All sizing, merging, cost estimation, and SHA-256 approval hashing execute locally in the user's browser via Web Crypto (`crypto.subtle.digest('SHA-256', ...)`).
3. **Approval Integrity Boundary (`C14` + `avd-target-approval/v1`):**
   - `manifest.approval.json` pins the exact `manifestSha256` of `manifest.json` (`LF`-normalized UTF-8 bytes) and explicitly lists every low-confidence JSON pointer in `acceptLowConfidence` so `avd-landing-zone/scripts/ConvertFrom-AvdTargetState.ps1` can verify operator approval before generating `.bicepparam`.

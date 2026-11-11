# avd-migrate — Single-Pool AVD Target-State Baseline Designer

> **Personal project, not for production.** Provided as is, without warranty of any kind (MIT License). Not affiliated with, endorsed by or supported by the author's employer, Liquidware or Microsoft.

`avd-migrate` (`https://migrate.avd-ops.dev`) is the open-source, single-pool baseline target-state designer for the [avd-ops](https://avd-ops.dev) family. It reads pseudonymous single-tenant Azure outputs from [`avd-current-state`](https://github.com/avd-ops/avd-current-state) and [`avd-assess`](https://github.com/avd-ops/avd-assess):

- **`C11` (`avd-current-state-facts/v1`)** — pseudonymous current-state facts exported by `avd_current_state_facts.ps1`.
- **`C19` (`avd-estate-intake/v1`)** — operator intake answers exported by `assess.avd-ops.dev`.
- **`C27` (`avd-measured-usage/v1`, optional)** — 28-day host-pool and user-cohort percentiles exported by `Export-AvdInsightsUsage.ps1`.

And emits a schema-valid **`C14` (`avd-target-state/v1`)** manifest (`manifest.json`) plus **`avd-target-approval/v1`** (`manifest.approval.json`) ready for [`avd-landing-zone/scripts/ConvertFrom-AvdTargetState.ps1`](https://github.com/avd-ops/avd-landing-zone).

## Single-Pool Baseline Scope

`avd-migrate` intentionally sizes a **single baseline pooled desktop pool (`tp-01`)** inside a single Azure cloud landing-zone stamp:

- **1 target host pool (`tp-01`, `Pooled`, `Desktop`)** — if `C11` contains multiple source host pools or mixed delivery types (`Personal`, `RemoteApp`, `Gpu`), `avd-migrate` merges all source user counts and concurrency into `tp-01` and records transparent `boundaryNotices` describing what was flattened.
- **Up to 180 session hosts and 1,000 concurrent sessions** — capped at the single-pool landing-zone ceiling (`1` subscription, `1` Azure Files Premium profile share).
- **100% client-side / offline execution** — the browser portal (`site/portal/`) enforces `connect-src 'none'` and never transmits uploaded files over the network. The companion PowerShell CLI (`ConvertTo-AvdTargetState.ps1`) runs completely offline.

## Quick Start (PowerShell 7.2+)

```powershell
./ConvertTo-AvdTargetState.ps1 `
    -CurrentStatePath ./current-state-facts.json `
    -IntakePath ./intake.json `
    -MeasuredUsagePath ./measured-usage.json `
    -OutputDirectory ./out
```

Then render the `.bicepparam` file in [`avd-landing-zone`](https://github.com/avd-ops/avd-landing-zone):

```powershell
../avd-landing-zone/scripts/ConvertFrom-AvdTargetState.ps1 `
    -ManifestPath ./out/manifest.json `
    -ApprovalPath ./out/manifest.approval.json `
    -SubscriptionId $SubscriptionId `
    -AvdUsersGroupObjectId $AvdUsersGroupObjectId `
    -AvdAdminsGroupObjectId $AvdAdminsGroupObjectId `
    -OutputPath ./avd.bicepparam
```

## Verification Checks

```bash
pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path ./ConvertTo-AvdTargetState.ps1 -Settings ./PSScriptAnalyzerSettings.psd1 -EnableExit"
pwsh -NoProfile -Command "Invoke-Pester -Path ./tests -CI"
node --test "tests/portal/*.test.mjs"
```

## License

MIT License — see [LICENSE](LICENSE).

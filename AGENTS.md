# Instructions for AI agents

For any coding agent: Claude Code, Gemini CLI, Codex and others. Read this file first, then
the section below and [README.md](README.md). Claude Code loads
this file through [CLAUDE.md](CLAUDE.md); Gemini CLI loads this file through [GEMINI.md](GEMINI.md). Where they differ,
the more specific rule wins, and the owner's own words win over all of them.

## How to make a change

- Say what you assumed. When the ask leaves a detail open, pick the reasonable default, say which,
  and keep going.
- Write the least code that does the job: no features, options or abstractions nobody asked for,
  and no handling for cases that can't happen.
- Touch only what the task needs and match the style around it. Every changed line should trace
  back to the ask.
- Before you start, name the check that proves the task is done, and don't call it done until it
  passes in front of you.

## Family rules

- **No spend without the owner's exact go.** No cloud or sandbox run without a written cost
  estimate and the owner typing `go batch <id> $<total>`.
- **Never leave the meter running.**
- **Never delete the last copy** of data without a checked copy elsewhere or explicit `-DiscardLastCopy`.
- **No secrets, IDs or names.** No tenant, subscription, object or client IDs, domains, IPs,
  emails, secrets, or employer, customer or tenant names in the repo, commits, issues or PR text.
- **Public text stays public-safe.** Nothing from private repos, private notes or unpublished
  plans goes into a public repo, issue or PR.
- **Pull requests only; the owner merges.**
- **Stay in your lane.**
- **Personal project, not for production, as is, not affiliated with the author's employer,
  Liquidware or Microsoft.** Keep the notices that say so.
- **American English** in docs, output and comments.

## This repo

`avd-migrate` (`https://migrate.avd-ops.dev`) is the single-pool baseline target-state designer (`C11` + `C19` + optional `C27` -> `C14` `avd-target-state/v1` + `avd-target-approval/v1`).

CI (`.github/workflows/test.yml`) runs:

```bash
pwsh -c "Invoke-ScriptAnalyzer -Path ./ConvertTo-AvdTargetState.ps1 -Settings ./PSScriptAnalyzerSettings.psd1 -EnableExit"
pwsh -c "Invoke-Pester -Path ./tests -CI"
node --test "tests/portal/*.test.mjs"
```

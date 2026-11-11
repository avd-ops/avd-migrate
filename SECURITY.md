# Security Policy

> **Personal project, not for production.** Provided as is, without warranty of any kind (MIT License). Not affiliated with, endorsed by or supported by the author's employer, Liquidware or Microsoft.

## Scope and Architecture

- `avd-migrate` is a pure offline / client-side transformation tool. It reads pseudonymous `C11` (`avd-current-state-facts/v1`), `C19` (`avd-estate-intake/v1`), and optional `C27` (`avd-measured-usage/v1`) JSON files and emits `C14` (`avd-target-state/v1`) and `avd-target-approval/v1`.
- The web portal (`site/portal/`) enforces a strict Content Security Policy (`default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'`) and never makes outbound network requests with user data.
- Never commit tenant IDs, subscription IDs, object IDs, client IDs, domains, IP addresses, emails, or secrets to this repository.

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories on `avd-ops/avd-migrate`.

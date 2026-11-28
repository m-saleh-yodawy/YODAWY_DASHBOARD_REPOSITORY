# YODAWY Dashboard Agent Instructions

This repository has separate DEVELOPMENT and PRODUCTION environments. All code and tool changes must be developed and verified on `develop` and the Cloudflare DEV Worker first. Never modify or deploy Production unless Mohamed explicitly requests and approves a release through a Pull Request from `develop` to `main` and the Production Environment approval gate.

Follow the always-on rules in `.agents/rules/yodawy-environments.md` for branch discipline, Cloudflare isolation, release approvals, secrets, and the authorized sanitized Production-to-DEV demo-data refresh. These rules apply to every task in this workspace.

The already-distributed Production Tampermonkey loader is immutable unless Mohamed explicitly authorizes a specific change. Keep Production data and credentials isolated. Actual Production user identity and approved configuration data may be copied to Development, but authentication credentials, sessions, portal accounts, passwords, tokens, and operational secrets must never be copied.

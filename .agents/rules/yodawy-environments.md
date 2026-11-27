---
trigger: always_on
---

# YODAWY Environment and Release Policy

This repository controls two separate live environments. These rules are mandatory for every task, even when a user request sounds like a quick code edit.

## Environment identities

- GitHub `main` is PRODUCTION.
- GitHub `develop` is DEVELOPMENT.
- Production Cloudflare Worker: `yodawy-dashboard` at `https://yodawy-dashboard.m-saleh-yodawy.workers.dev`.
- Production D1: `yodawy-dashboard`, ID `7a4fd7ce-fdef-4f99-8927-97bdeb8c5083`.
- Development Cloudflare Worker: `yodawy-dashboard-dev` at `https://yodawy-dashboard-dev.m-saleh-yodawy.workers.dev`.
- Development D1: `yodawy-dashboard-dev`, ID `2222b085-5cb3-4991-a24a-d96187883941`.
- The user's Production and Development Tampermonkey loaders run in separate browser profiles. Never change the already-distributed `CLOUDFLARE/tampermonkey-loader.js` or redirect Production users to DEV unless Mohamed explicitly requests that exact change.

## Default development workflow

1. Before editing, inspect `git status`, current branch, latest remote refs, and the relevant workflow/configuration.
2. All ordinary feature work, fixes, refactors, tool changes, and tests must happen on `develop` or a feature branch based on the latest `develop`. Never commit ordinary work directly to `main`.
3. Push completed development changes to `develop` only. The `Deploy Cloudflare Development` workflow is the only automatic deployment path for the DEV Worker.
4. Verify the live DEV Worker reports `environment: DEVELOPMENT`, uses the DEV D1 ID, serves the DEV loader, and contains the DEVELOPMENT banner before declaring a deployment successful.
5. Keep `DEV_ALLOW_EXTERNAL_MUTATIONS=false`. Do not create real prescriptions, edit real Portal records, or trigger external Odoo/Portal mutations during tests. Use mocks, fixtures, or safe read-only operations.

## Production release workflow

1. Do not deploy, merge, push, or write to Production merely because a change passes local tests or DEV deployment.
2. When Mohamed says a DEV change is stable and requests release, compare the exact tested `develop` commit with `main`, review every changed file, run all required checks, and create a Pull Request from `develop` into `main`.
3. The PR must identify the exact tested DEV commit, included migrations, tool registry/asset changes, security implications, rollback plan, and verification plan.
4. Stop and wait for Mohamed's explicit approval before merging. Never self-approve, auto-merge, bypass branch protection, or approve the Production GitHub Environment on his behalf.
5. Production deployment is allowed only from `main`, through the repository's `production` GitHub Environment approval gate and its Production workflows. Confirm the expected reviewer/approval gate is active before release.
6. After approved deployment, verify Production endpoints and assets against the release commit. Do not copy Development D1 data back into Production.
7. A later DEV change must never silently alter Production. The Production loader, Worker, D1, secrets, and user records are protected release targets.

## Cloudflare and GitHub safety boundaries

- Never point a DEV Wrangler config, generated asset, loader, or workflow at the Production Worker URL or Production D1 ID.
- Never point a Production config or loader at DEV.
- Do not execute Production D1 writes during development. Production access for a DEV data refresh is strictly read-only.
- DEV deployment secrets must be scoped to the GitHub `development` Environment and must be separate from Production secrets. The DEV workflow must use the dedicated secret names `CLOUDFLARE_DEV_API_TOKEN` and `CLOUDFLARE_DEV_D1_API_TOKEN`; never use the Production/repository-level `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_D1_API_TOKEN` as a fallback. Use least-privilege DEV tokens.
- Production deployment secrets must be scoped to the `production` Environment.
- Never hard-code passwords, setup secrets, API tokens, encryption keys, session tokens, or database credentials in source, workflow YAML, tests, or logs. Never echo secrets.
- Never commit generated DEV configs, exports, SQL data dumps, D1 backups, or credential material.
- Review workflow triggers before editing them. `develop` pushes may deploy DEV; only approved changes on `main` may deploy Production.

## Production-to-Development demo-data refresh

Mohamed has authorized a one-way refresh of DEV test data from the current Production users and tool configuration. This is NOT authorization to copy raw Production data.

Before any refresh:

1. Confirm both exact D1 names and IDs. Read Production only; write only to the DEV D1.
2. Create/confirm a recoverable DEV D1 backup before replacing existing DEV demo data. Preserve the existing `Q-999` DEV administrator and its independent DEV-only authentication.
3. Read the current schema and all relevant foreign keys/migrations. Use a temporary secure transfer method; never store a raw Production export in GitHub, the repository, workflow logs, or persistent artifacts. Delete temporary raw exports after import and verification.
4. Import only the minimum sanitized data required to exercise the dashboard's Users, Roles, Tools, Permissions, and Visibility interfaces.

Allowed sanitized data:
- User role and status values, where needed for realistic permission behavior.
- A deterministic mapping from each Production user to a synthetic DEV-only `Q-###` user ID, excluding/reserving `Q-999`.
- Generic names such as `DEV USER 001`, and synthetic personal repository labels such as `DEV_USER_001`; never copy real names or personal repository identifiers.
- Tool registry metadata and enabled/disabled state, using the current canonical tool source and manifest in GitHub. Preserve tool IDs only where they match the canonical tool catalog.
- User-to-tool permission assignments and tool visibility modes, after remapping user IDs to synthetic DEV IDs.
- In `user_settings`, copy only validated `tools` enabled/disabled preferences and an allowed `startPage` value (`overview` or `tools`). Drop all other preference values unless individually reviewed and proven non-sensitive.

Never copy:
- `password_hash`, `password_ciphertext`, `password_encryption_iv`, passwords, password reset material, MFA material, failed-login counters, lock state, or any authentication material.
- Any rows from `sessions`.
- Any rows from `portal_accounts`; they contain real Portal usernames, Odoo keys, and encrypted passwords. Do not copy them even though the DEV encryption key is different.
- Production API tokens, GitHub credentials, Cloudflare secrets, encryption keys, cookies, JWTs, refresh tokens, or browser storage.
- Raw `network_transactions`, `audit_logs`, `auth_events`, or `user_activity_logs` because payloads/details can contain personal or operational data.
- Real announcements or message bodies unless separately reviewed and replaced with synthetic text.

Sanitization requirements:
- Preserve the relationship mapping between synthetic users and their permissions/visibility rows.
- Ensure every imported DEV user has a synthetic identifier and generic name; no original identity mapping may remain in DEV.
- Ensure synthetic users cannot authenticate until a separate DEV-only password is explicitly established. Keep `Q-999` as the only known DEV administrator login unless Mohamed explicitly requests otherwise.
- Do not copy Production user passwords or allow DEV credentials to work in Production.
- Verify counts, role distribution, permission mapping, tool counts, and foreign-key integrity.
- Scan DEV data for original user names, real user IDs, personal repository labels, secrets, credential-like values, and Production-only identifiers before declaring completion.
- Report source row counts, imported sanitized row counts, skipped tables, sanitization rules, backup reference, and verification results without exposing source PII or secrets.

## Tool source of truth

- Canonical tool code and metadata are maintained in `TOOLS/` and `TOOLS/manifest.json`.
- DEVELOPMENT tests changes first. DEV assets and D1 tool registry must be built from the exact `develop` commit being tested.
- Production assets and registry may be updated only through the approved `develop` → `main` release process.
- Never overwrite Production user permissions, visibility, settings, or user records as a side effect of tool synchronization.

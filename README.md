# YODAWY Dashboard

Single source repository for the YODAWY Dashboard, Cloudflare Worker, D1 migrations, runtime engines, official Tampermonkey tools, and personal repository templates.

## Repository layout

- `CLOUDFLARE/`: Worker source, D1 migrations, static runtime, and deployed tool assets.
- `TOOLS/`: canonical source for active tools, backups, and the tool manifest.
- `LEGACY/`: retained legacy tools that are still referenced by the runtime.
- `TEMPLATE/`: baseline files and workflow distributed to personal repositories.
- `ARCHIVE/`: retained legacy repository configuration and historical workflows. Archived files are not loaded by the Worker.

## Deployment

- `.github/workflows/deploy-cloudflare-worker.yml` applies pending D1 migrations and deploys the Worker when `CLOUDFLARE/**` changes.
- `.github/workflows/sync-tools-to-cloudflare.yml` validates the tool source, regenerates the manifest and SHA-256 registry, updates Cloudflare assets, and synchronizes the D1 tool records.
- `.github/workflows/sync-personal-repositories.yml` distributes `TEMPLATE/` to personal repositories. It requires the `YODAWY_REPOSITORIES_SYNC_TOKEN` Actions secret on this repository.

## Required GitHub Actions secret

- `CLOUDFLARE_API_TOKEN`: deploys the Worker and static assets.
- `CLOUDFLARE_D1_API_TOKEN`: applies D1 migrations and synchronizes the tool registry. Grant this token D1 Edit access for the configured account.
- `YODAWY_REPOSITORIES_SYNC_TOKEN`: reads and updates the personal repositories used by the template workflow.

Never store API tokens, passwords, or personal portal credentials in repository files. Portal credentials belong in the encrypted Cloudflare D1 account store.

Historical Portal split backups that contained hard-coded credentials are retained only as redacted archival copies under `ARCHIVE/TOOLS_REPOSITORY/`.

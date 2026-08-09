# GitHub-hosted workflows are intentionally retired

This private repository does not run GitHub-hosted Actions. Release validation
runs on the operator's Mac via `pnpm release:local`; deployment is then started
from that Mac with `pnpm deploy:local`.

Do not add a workflow YAML file here without an explicit decision to resume
GitHub Actions billing and an approved monthly budget.

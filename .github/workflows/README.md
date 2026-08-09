# GitHub Actions is deploy-only

Daily development checks and the complete release gate run on the operator's
Mac. Pull requests and ordinary pushes do not trigger GitHub Actions.

deploy-production.yml is the only GitHub-hosted workflow. It can only be
started manually after pnpm deploy:local has validated a clean, exact
origin/main checkout and a complete local release receipt. The runner does
not install project dependencies, run tests, install browsers, or build the
application; it validates the non-sensitive receipt summary, then calls the
existing server-side backup, migration, deployment, health-check, confirmation,
and recovery chain.

Keep the Actions overage budget at $0. This allows included monthly minutes
only and blocks additional charges. Do not add push, pull-request, cache, or
artifact workflows here without a new explicit decision.

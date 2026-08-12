# GitHub Actions responsibilities

Pull requests and pushes to `main` run `.github/workflows/ci.yml`. Independent
quality, unit-test, build/manifest, and PostgreSQL 16 matrix shards execute in
parallel. The stable `Release gates` summary succeeds only when every branch
passes. This remote check complements the operator Mac's exact-SHA
`pnpm release:local` receipt; it does not replace the production release gate.

`deploy-production.yml` is the only production deployment workflow. It can only be
started manually after pnpm deploy:local has validated a clean, exact
origin/main checkout and a complete local release receipt. The runner does
not install project dependencies, run tests, install browsers, or build the
application; it validates the non-sensitive receipt summary, then calls the
existing server-side backup, migration, deployment, health-check, confirmation,
and recovery chain.

`deploy-production.yml` remains manually dispatched and does not rebuild or
retest the application. Restoring CI does not authorize deployment, migration,
data cleanup, or production access.

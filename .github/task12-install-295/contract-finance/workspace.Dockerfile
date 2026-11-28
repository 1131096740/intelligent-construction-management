FROM contract-finance-loader AS contract-finance-deps
WORKDIR /qualification/workspace
COPY workspace/package.json workspace/pnpm-lock.yaml workspace/pnpm-workspace.yaml ./
COPY workspace/packages/shared-domain/package.json packages/shared-domain/
COPY workspace/services/api/package.json services/api/
COPY workspace/apps/web-admin/package.json apps/web-admin/
RUN --mount=type=cache,id=jg-qualification-pnpm-v9-amd64,target=/var/cache/jg-pnpm,sharing=locked pnpm --filter @jiangkong/api... --filter @jiangkong/web-admin... install --frozen-lockfile --store-dir=/var/cache/jg-pnpm

# Select the CLI from the web workspace's frozen Playwright dependency chain.
FROM contract-finance-deps AS contract-finance-playwright-cli
RUN node -e '\
  const assert = require("node:assert/strict"); \
  const { cpSync, realpathSync } = require("node:fs"); \
  const { createRequire } = require("node:module"); \
  const { dirname } = require("node:path"); \
  const web = createRequire("/qualification/workspace/apps/web-admin/package.json"); \
  const version = web("./package.json").devDependencies["@playwright/test"]; \
  assert.match(version, /^\d+\.\d+\.\d+$/u); \
  const tests = createRequire(web.resolve("@playwright/test/package.json")); \
  const playwright = createRequire(tests.resolve("playwright/package.json")); \
  const core = realpathSync(playwright.resolve("playwright-core/package.json")); \
  for (const manifest of [tests("./package.json"), playwright("./package.json"), require(core)]) \
    assert.equal(manifest.version, version); \
  cpSync(dirname(core), "/opt/jg-playwright-cli", { recursive: true });'

# These layers depend on the sealed loader and the selected CLI bytes only.
FROM contract-finance-loader AS contract-finance-browser-runtime
COPY --from=contract-finance-playwright-cli /opt/jg-playwright-cli/ /opt/jg-playwright-cli/
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
RUN node /opt/jg-playwright-cli/cli.js install --with-deps chromium \
 && apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer=4:25.2.3-2+deb13u12 libreoffice-calc=4:25.2.3-2+deb13u12 fonts-noto-cjk=1:20240730+repack1-1 \
 && command -v soffice \
 && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC' \
 && LC_ALL=C.UTF-8 locale charmap | grep -Fx UTF-8

FROM contract-finance-browser-runtime AS contract-finance-mobile-runtime
RUN node /opt/jg-playwright-cli/cli.js install --with-deps webkit

FROM contract-finance-browser-runtime AS contract-finance-browser-tools
COPY --link --from=contract-finance-deps /qualification/workspace/ /qualification/workspace/

FROM contract-finance-mobile-runtime AS contract-finance-mobile-tools
COPY --link --from=contract-finance-deps /qualification/workspace/ /qualification/workspace/

FROM contract-finance-${JG_CONTRACT_FINANCE_TOOLS} AS contract-finance-api
WORKDIR /qualification/workspace
COPY workspace/ ./
RUN pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate \
 && NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @jiangkong/api build

FROM contract-finance-api AS contract-finance-restore
COPY --from=contract-finance-api /qualification/workspace/ /qualification/loan-workspace/

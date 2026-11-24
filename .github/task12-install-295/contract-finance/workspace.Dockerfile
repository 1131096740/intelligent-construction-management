FROM contract-finance-loader AS contract-finance-deps
WORKDIR /qualification/workspace
COPY workspace/package.json workspace/pnpm-lock.yaml workspace/pnpm-workspace.yaml ./
COPY workspace/packages/shared-domain/package.json packages/shared-domain/
COPY workspace/services/api/package.json services/api/
COPY workspace/apps/web-admin/package.json apps/web-admin/
RUN pnpm --filter @jiangkong/api... --filter @jiangkong/web-admin... install --frozen-lockfile

FROM contract-finance-deps AS contract-finance-browser-tools
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
RUN pnpm --filter @jiangkong/web-admin exec playwright install --with-deps chromium \
 && apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer=4:25.2.3-2+deb13u12 libreoffice-calc=4:25.2.3-2+deb13u12 fonts-noto-cjk=1:20240730+repack1-1 \
 && command -v soffice \
 && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC' \
 && LC_ALL=C.UTF-8 locale charmap | grep -Fx UTF-8

FROM contract-finance-browser-tools AS contract-finance-mobile-tools
RUN pnpm --filter @jiangkong/web-admin exec playwright install --with-deps webkit

FROM contract-finance-${JG_CONTRACT_FINANCE_TOOLS} AS contract-finance-api
COPY workspace/ ./
RUN pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate \
 && NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @jiangkong/api build

FROM contract-finance-api AS contract-finance-restore
COPY --from=contract-finance-api /qualification/workspace/ /qualification/loan-workspace/

ARG CI_SOURCE_SHA
ARG CONTEXT_SHA256
LABEL org.jiangkong.contract-finance.source-sha=$CI_SOURCE_SHA \
      org.jiangkong.contract-finance.context-sha256=$CONTEXT_SHA256
WORKDIR /qualification/workspace
COPY workspace/ ./
RUN pnpm --filter @jiangkong/api... --filter @jiangkong/web-admin... install --frozen-lockfile \
 && pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate \
 && pnpm --filter @jiangkong/api build

FROM contract-finance-api AS contract-finance-browser
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
RUN pnpm --filter @jiangkong/web-admin exec playwright install --with-deps chromium \
 && apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer=4:25.2.3-2+deb13u12 libreoffice-calc=4:25.2.3-2+deb13u12 fonts-noto-cjk=1:20240730+repack1-1 \
 && command -v soffice \
 && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC' \
 && LC_ALL=C.UTF-8 locale charmap | grep -Fx UTF-8

FROM contract-finance-browser AS contract-finance-restore
COPY --from=contract-finance-api /qualification/workspace/ /qualification/loan-workspace/

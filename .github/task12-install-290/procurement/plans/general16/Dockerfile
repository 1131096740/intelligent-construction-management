FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS node
FROM postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d
COPY --from=node /usr/local/ /usr/local/
WORKDIR /qualification/source
ENV COREPACK_HOME=/opt/corepack
COPY --chmod=644 checkout.cjs installer.cjs source-seal.txt source-admission.json /qualification/
COPY source/ ./
RUN corepack enable pnpm && corepack prepare pnpm@9.15.9 --activate && pnpm --filter @jiangkong/api... install --frozen-lockfile
WORKDIR /qualification/procurement289-nodb
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
COPY workspace/ ./
RUN pnpm --filter @jiangkong/api... --filter @jiangkong/web-admin... install --frozen-lockfile \
 && pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate \
 && pnpm --filter @jiangkong/api build
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer=4:25.2.3-2+deb13u12 fonts-noto-cjk=1:20240730+repack1-1 \
 && command -v soffice \
 && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC' \
 && pnpm --filter @jiangkong/web-admin exec playwright install --with-deps chromium \
 && test -d /opt/jg-playwright/chromium-1248 \
 && test -d /opt/jg-playwright/chromium_headless_shell-1248 \
 && test -d /opt/jg-playwright/ffmpeg-1013
ENV COREPACK_ENABLE_NETWORK=0 COREPACK_DEFAULT_TO_LATEST=0
COPY --chmod=644 scope.json successor.cjs successor.sql entry.cjs stage-procurement.cjs owner-observation.cjs stage-browser.cjs input-check.cjs consumer.cjs source-inputs.json image.id /qualification/
USER postgres
ENTRYPOINT ["node", "/qualification/entry.cjs"]

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
WORKDIR /qualification/workspace
COPY workspace/ ./
RUN corepack enable pnpm && corepack prepare pnpm@9.15.9 --activate \
 && pnpm --filter @jiangkong/api... --filter @jiangkong/web-admin... install --frozen-lockfile \
 && pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate \
 && pnpm --filter @jiangkong/api build
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer=4:25.2.3-2+deb13u12 fonts-noto-cjk=1:20240730+repack1-1 \
 && command -v soffice \
 && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC'
RUN pnpm --filter @jiangkong/web-admin exec playwright install --with-deps chromium \
 && test -d /opt/jg-playwright/chromium-1248 \
 && test -d /opt/jg-playwright/chromium_headless_shell-1248 \
 && test -d /opt/jg-playwright/ffmpeg-1013
COPY --chmod=644 owner-observation.cjs approval-round-catalog.cjs controlled-correction.cjs workspace-inputs.json /qualification/

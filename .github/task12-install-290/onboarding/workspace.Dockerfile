# Append to the already pinned historical 289 Dockerfile after the owner installer image stage.
WORKDIR /qualification/workspace
COPY workspace/ ./
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/jg-playwright
RUN pnpm --filter @jiangkong/api... --filter @jiangkong/web-admin... install --frozen-lockfile  && pnpm --filter @jiangkong/shared-domain build  && pnpm --filter @jiangkong/api exec prisma generate  && pnpm --filter @jiangkong/api build  && pnpm --filter @jiangkong/web-admin exec playwright install --with-deps chromium webkit
RUN apt-get update  && apt-get install -y --no-install-recommends libreoffice-writer=4:25.2.3-2+deb13u12 fonts-noto-cjk=1:20240730+repack1-1  && command -v soffice  && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC'

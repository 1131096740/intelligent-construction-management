COPY --chmod=644 contract-ci.cjs checkout.cjs installer.cjs /qualification/
WORKDIR /qualification/workspace
COPY workspace/ ./
RUN pnpm --filter @jiangkong/api... install --frozen-lockfile \
  && pnpm --filter @jiangkong/shared-domain build \
  && pnpm --filter @jiangkong/api exec prisma generate
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer fonts-noto-cjk \
  && command -v soffice \
  && fc-match --format '%{family}' 'Noto Sans CJK SC' | grep -Fx 'Noto Sans CJK SC'
RUN pnpm --filter @jiangkong/api build

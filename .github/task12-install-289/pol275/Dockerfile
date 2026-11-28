COPY --chmod=644 pol275.cjs /qualification/
WORKDIR /qualification/workspace
COPY workspace/ ./
RUN pnpm --filter @jiangkong/api... install --frozen-lockfile \
 && pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate
WORKDIR /qualification/pol275-legacy
COPY legacy/ ./
RUN pnpm --store-dir=/opt/pol275-legacy-store fetch --frozen-lockfile \
 && pnpm --store-dir=/opt/pol275-legacy-store install --frozen-lockfile --offline \
 && pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate

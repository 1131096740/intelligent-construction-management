COPY --chmod=644 owner-observation.cjs approval-round-catalog.cjs controlled-correction.cjs verify-behavior.cjs app-inputs.json /qualification/
WORKDIR /qualification/workspace
COPY workspace/ ./
RUN pnpm --filter @jiangkong/api... install --frozen-lockfile \
 && pnpm --filter @jiangkong/shared-domain build \
 && pnpm --filter @jiangkong/api exec prisma generate

# Local verification only. The caller pins RUNTIME_IMAGE to a verified digest.
ARG RUNTIME_IMAGE=node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
FROM ${RUNTIME_IMAGE} AS runtime-base
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Build-only dependencies never enter the test runtime image. The generated
# probe is not the application Schema and never connects to a database.
FROM runtime-base AS prisma-engine-builder
RUN npm install --prefix /opt/pol122-prisma --ignore-scripts --no-audit --no-fund \
    prisma@5.22.0 @prisma/client@5.22.0
COPY isolated-cleanup-engine.prisma /opt/pol122-prisma/schema.prisma
RUN cd /opt/pol122-prisma \
    && PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
       DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/unused \
       node node_modules/prisma/build/index.js generate --schema schema.prisma

FROM runtime-base
COPY --from=prisma-engine-builder \
    /opt/pol122-prisma/generated/libquery_engine-linux-arm64-openssl-3.0.x.so.node \
    /opt/pol122/libquery_engine-linux-arm64-openssl-3.0.x.so.node

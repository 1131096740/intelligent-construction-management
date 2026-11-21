FROM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS node
FROM postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d
COPY --from=node /usr/local/ /usr/local/
WORKDIR /qualification/source
ENV COREPACK_HOME=/opt/corepack
COPY --chmod=644 checkout.cjs installer.cjs exact-source.json install-only.cjs source-seal.txt source-admission.json /qualification/
COPY source/ ./
RUN corepack enable pnpm && corepack prepare pnpm@9.15.9 --activate && pnpm --filter @jiangkong/api... install --frozen-lockfile

#!/usr/bin/env node
"use strict";

// #424 isolated drill fixture (evidence only, not product code).
//
// Builds a disposable PostgreSQL 16 database at the last pre-simplification
// migration prefix (261) by reusing the source-owned staged migration fixture.
// That fixture is the same one CI uses for the "current 259/261" technical
// profiles: it provisions the archive ACL/app-role stage before migration 204,
// runs the tail qualification supplies for prefixes 213/215/218/221, and only
// then deploys the remaining prefix. A plain `prisma migrate deploy` cannot
// pass migration 20261108220000 without that installer/ACL supply.
//
// Inputs (environment):
//   DRILL_ROOT     writable directory for staged copies and container.json
//   LEGACY_SCHEMA  path to the 261-prefix schema.prisma (copy of the repo schema
//                  next to a migrations/ directory containing exactly the first
//                  261 canonical migration directories + migration_lock.toml)
//   PG_IMAGE       optional, default postgres:16
//
// The script never deletes the container; the operator removes it in the
// cleanup step. It writes DRILL_ROOT/container.json (mode 0600) with a random
// password; that file is temporary storage and must be deleted after cleanup.

const { randomBytes, randomUUID } = require("node:crypto");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../../..");
const prismaDir = path.join(repoRoot, "services/api/prisma");
const { createCommandRuntime } = require(path.join(prismaDir, "money-bigint-runner-runtime.cjs"));
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } =
  require(path.join(prismaDir, "local-staged-ci-dynamic.cjs"));

const drillRoot = process.env.DRILL_ROOT;
if (!drillRoot) throw new Error("DRILL_ROOT is required");
mkdirSync(path.join(drillRoot, "home/.cache"), { recursive: true });
const legacySchema = process.env.LEGACY_SCHEMA;
const image = process.env.PG_IMAGE || "postgres:16";
if (!legacySchema) throw new Error("LEGACY_SCHEMA is required");
const ciFixture = "DYNAMIC_LINE_A_V1";
const database = "jiangkong_line_a_real_db";
const runId = randomUUID();
const containerName = `jiangkong-am424-${runId}`;
const password = randomBytes(24).toString("hex");
let endpoint;

function command(bin, args, env = process.env, { quiet = false, timeout = 900_000 } = {}) {
  const result = spawnSync(bin, args, {
    cwd: repoRoot, env, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    if (!quiet) process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    throw new Error(`DRILL_COMMAND_FAILED ${bin} ${args[0]} status=${result.status}`);
  }
  return { stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}
const docker = (args, options) => command("docker", ["--host", endpoint, ...args], process.env, options);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("DRILL_FORBIDDEN_PRODUCTION");
  endpoint = process.env.DOCKER_HOST ||
    command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], process.env, { quiet: true })
      .stdout.replace(/^"|"$/gu, "");
  if (!endpoint.startsWith("unix://")) throw new Error("DRILL_LOCAL_DOCKER_ONLY");
  docker(["image", "inspect", "--format", "{{.Id}}", image], { quiet: true });

  // Reserve the run before Docker starts so failed startup can be inspected by name.
  writeFileSync(path.join(drillRoot, "container-ownership.json"),
    JSON.stringify({ runId, containerName, endpoint }, null, 2),
    { mode: 0o600, flag: "wx" });

  const containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", containerName,
    "--label", `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`,
    "--env", "POSTGRES_USER=jiangkong", "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", `POSTGRES_DB=${database}`, "--publish", "127.0.0.1::5432", image], { quiet: true }).stdout;
  if (!/^[a-f0-9]{64}$/u.test(containerId)) throw new Error("DRILL_CONTAINER_ID");

  let port;
  for (let attempt = 0; attempt < 60 && !port; attempt += 1) {
    const binding = docker(["port", containerId, "5432/tcp"], { quiet: true }).stdout;
    port = /^127\.0\.0\.1:(\d+)$/u.exec(binding)?.[1];
    if (!port) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!port) throw new Error("DRILL_NO_LOOPBACK_PORT");
  docker(["exec", containerId, "sh", "-c",
    `for attempt in $(seq 1 200); do pg_isready -h 127.0.0.1 -U jiangkong -d ${database} >/dev/null 2>&1 && exit 0; sleep 0.2; done; exit 1`],
    { quiet: true });

  const ownerUrl = `postgresql://jiangkong:${password}@127.0.0.1:${port}/${database}`;
  const env = { ...process.env, NODE_ENV: "test", CI: "true", DATABASE_URL: ownerUrl };
  const state = {
    runId, containerId, containerName, endpoint, port: Number(port), database, password, ownerUrl,
    legacySchema, startedAt: new Date().toISOString()
  };
  writeFileSync(path.join(drillRoot, "container.json"), JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });

  const { command: stagedCommand } = createCommandRuntime({ defaultCwd: repoRoot });
  const migration = createCiDynamicMigrationFixture({
    ciFixture,
    container: { id: containerId, name: containerName, runId },
    databaseNames: [database],
    temporaryRoot: mkdtempSync(path.join(drillRoot, "staged-migrations-")),
    dockerCommand: (args, options) =>
      stagedCommand("docker", ["--host", endpoint, ...args], { ...options, env: process.env }),
    deploy({ databaseUrl, runtimeEnv, schemaPath }) {
      const args = ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"];
      if (schemaPath) args.push("--schema", schemaPath);
      return {
        stdout: command("pnpm", args, {
          ...runtimeEnv,
          HOME: path.join(drillRoot, "home"),
          XDG_CACHE_HOME: path.join(drillRoot, "home/.cache"),
          CHECKPOINT_DISABLE: "1",
          DATABASE_URL: databaseUrl
        }, { quiet: true }).stdout
      };
    }
  });

  const started = Date.now();
  await migration.migrate({ databaseUrl: ownerUrl, runtimeEnv: env, schemaPath: legacySchema });
  const handle = migration.getStagedSetupHandle(database);
  if (handle) writeFileSync(path.join(drillRoot, "staged-handle.json"),
    JSON.stringify({ plan: handle.plan, setup: handle.setup }, null, 2), { mode: 0o600, flag: "wx" });

  console.log(JSON.stringify({
    status: "LEGACY_261_APPLIED",
    durationMs: Date.now() - started,
    containerId,
    containerName,
    port: Number(port),
    database,
    drillRoot
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

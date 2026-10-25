#!/usr/bin/env node
"use strict";

// Opt-in Docker regression: creates only its own sleeping containers and test volume.
// It does not initialize PostgreSQL, publish ports, pull images or prune any resources.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

function listPostgresRunners() {
  return readdirSync(__dirname).filter((name) => {
    if (!/^(?:run-.*-local|verify-fund-execution-v7)\.cjs$/u.test(name)) return false;
    const source = readFileSync(path.join(__dirname, name), "utf8");
    return /(["'])postgres:16\1/u.test(source) && /(["'])--name\1/u.test(source);
  });
}

const cleanupIdentifiers = new Set(["name", "containerName", "containerId", "endpoint"]);

// Cleanup argv need only plain option literals and these per-run identifiers.
// Reject expressions instead of evaluating JavaScript from a runner's source.
function parseCleanupArray(source) {
  if (typeof source !== "string") throw new Error("Missing cleanup array");
  let offset = 0;
  const values = [];
  const skipWhitespace = () => {
    while (/\s/u.test(source[offset] ?? "") && offset < source.length) offset += 1;
  };
  skipWhitespace();
  if (source[offset++] !== "[") throw new Error("Unsupported cleanup array");
  while (true) {
    skipWhitespace();
    if (source[offset] === "]") {
      offset += 1;
      break;
    }
    const rest = source.slice(offset);
    const literal = /^(["'])([A-Za-z0-9_:/=.\-]+)\1/u.exec(rest);
    const identifier = /^[A-Za-z_$][\w$]*/u.exec(rest);
    if (literal) {
      values.push({ literal: literal[2] });
      offset += literal[0].length;
    } else if (identifier && cleanupIdentifiers.has(identifier[0])) {
      values.push({ identifier: identifier[0] });
      offset += identifier[0].length;
    } else {
      throw new Error("Unsupported cleanup array argument");
    }
    skipWhitespace();
    if (source[offset] === ",") offset += 1;
    else if (source[offset] !== "]") throw new Error("Unsupported cleanup array expression");
  }
  skipWhitespace();
  if (offset !== source.length) throw new Error("Unexpected cleanup array suffix");
  return values;
}

function cleanupArrays(source) {
  return [...source.matchAll(/\[[^\[\]]*\]/gu)]
    .map(([array]) => array)
    .filter((array) => /(["'])rm\1\s*,\s*(["'])--force\2/u.test(array))
    .map((array) => `[${parseCleanupArray(array).map((value) =>
      "literal" in value ? JSON.stringify(value.literal) : value.identifier
    ).join(", ")}]`);
}

function resolveCleanupArguments(source, variables) {
  return parseCleanupArray(source).map((value) => {
    if ("literal" in value) return value.literal;
    if (!Object.hasOwn(variables, value.identifier) || typeof variables[value.identifier] !== "string") {
      throw new Error(`Missing cleanup identifier: ${value.identifier}`);
    }
    return variables[value.identifier];
  });
}

function main() {
  assert.notEqual(process.env.NODE_ENV, "production", "禁止在生产模式运行");
  const docker = process.platform === "win32" ? "docker.exe" : "docker";
  const localEndpoint = /^(?:unix:\/\/\/[^\r\n]+|npipe:\/{4}\.\/pipe\/[^/\r\n]+)$/u;
  if (process.env.DOCKER_HOST) assert.match(process.env.DOCKER_HOST, localEndpoint);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const key of ["DOCKER_CONTEXT", "DOCKER_HOST"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  function run(args) {
    return execFileSync(docker, args, {
      env, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  }
  const endpoint = JSON.parse(run(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]));
  assert.match(endpoint, localEndpoint);
  env.DOCKER_HOST = endpoint;
  delete env.DOCKER_CONTEXT;
  run(["image", "inspect", "--format", "{{.Id}}", "postgres:16"]);
  const before = run(["volume", "ls", "--format", "{{.Name}}" ]).split("\n").filter(Boolean);
  const suffix = randomUUID();
  const sentinel = `jgzg-cleanup-regression-keep-${suffix}`;
  run(["volume", "create", sentinel]);
  let checked = 0;
  try {
    for (const file of listPostgresRunners()) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      const commands = cleanupArrays(source);
      assert(commands.length > 0, `${file}: missing container cleanup`);
      for (const command of commands) {
        const name = `jgzg-cleanup-regression-${checked}-${suffix}`;
        const args = resolveCleanupArguments(command, {
          name, containerName: name, containerId: name, endpoint
        });
        assert.deepEqual(args.slice(-4), ["rm", "--force", "--volumes", name],
          `${file}: cleanup must target only this regression container`);
        const prefix = args.slice(0, -4);
        assert(prefix.length === 0 || (prefix.length === 2 && prefix[0] === "--host" && prefix[1] === endpoint),
          `${file}: cleanup must use the verified local endpoint`);
        let anonymous = [];
        try {
          run(["run", "--pull=never", "--detach", "--rm", "--network", "none",
            "--name", name, "--mount", `type=volume,source=${sentinel},target=/keep,readonly`,
            "postgres:16", "sleep", "120"]);
          const mounts = JSON.parse(run(["inspect", "--format", "{{json .Mounts}}", name]));
          anonymous = mounts.filter((mount) => mount.Type === "volume" && mount.Name !== sentinel)
            .map((mount) => mount.Name);
          assert.equal(anonymous.length, 1, "PostgreSQL image should allocate one anonymous volume");
          run(args); // Execute the deletion argv read from the actual runner call site.
          const remaining = new Set(run(["volume", "ls", "--format", "{{.Name}}"]).split("\n"));
          assert(anonymous.every((volume) => !remaining.has(volume)), `${file}: anonymous volume leaked`);
          assert(remaining.has(sentinel), `${file}: named volume was removed`);
          checked += 1;
          console.log(`PASS ${file}: anonymous volume removed; named volume retained`);
        } finally {
          try { run(["rm", "--force", "--volumes", name]); } catch (error) {
            if (!String(error.stderr).includes("No such container")) throw error;
          }
          const remaining = new Set(run(["volume", "ls", "--format", "{{.Name}}"]).split("\n"));
          for (const volume of anonymous.filter((value) => remaining.has(value))) run(["volume", "rm", volume]);
        }
      }
    }
    assert(checked > 0, "No runner cleanup paths tested");
  } finally {
    run(["volume", "rm", sentinel]);
  }
  const after = new Set(run(["volume", "ls", "--format", "{{.Name}}"]).split("\n"));
  assert(before.every((volume) => after.has(volume)), "A pre-existing volume is missing");
  console.log(JSON.stringify({ checked, preExistingVolumesPreserved: before.length, leakedVolumes: 0 }));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { cleanupArrays, listPostgresRunners, resolveCleanupArguments };

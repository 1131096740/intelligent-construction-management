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
    return source.includes('"postgres:16"') && source.includes('"--name"');
  });
}

function cleanupArrays(source) {
  return [...source.matchAll(/\[[^\[\]]*\]/gu)]
    .map(([array]) => array)
    .filter((array) => /"rm"\s*,\s*"--force"/u.test(array));
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
        const args = JSON.parse(command.replace(/\b(?:containerName|containerId|name)\b/gu, JSON.stringify(name)).replace(/\bendpoint\b/gu, JSON.stringify(endpoint)));
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

module.exports = { cleanupArrays, listPostgresRunners };

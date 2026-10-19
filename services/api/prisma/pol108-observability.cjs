"use strict";
const os = require("node:os");
const { readFile } = require("node:fs/promises");

async function collectEnvironment({
  platform = process.platform, arch = process.arch, cpus = os.cpus(),
  totalMemory = os.totalmem(), read = file => readFile(file, "utf8"), environment = process.env
} = {}) {
  const optional = async file => { try { return (await read(file)).trim(); } catch { return null; } };
  return {
    platform, arch, nodeVersion: process.version, cpuModel: cpus[0]?.model ?? null,
    logicalCpus: cpus.length, totalMemoryBytes: totalMemory,
    cpuQuota: platform === "linux" ? await optional("/sys/fs/cgroup/cpu.max") : null,
    githubActions: environment.GITHUB_ACTIONS === "true"
  };
}

// Aggregate counters only. No SQL text, parameters, users, database URLs or secrets.
const databaseSnapshotSql = `SELECT jsonb_build_object(
  'context', (SELECT to_jsonb(s) FROM (
    SELECT n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, n_live_tup, n_dead_tup
    FROM pg_stat_user_tables WHERE relname = 'OperatingLedgerWriteContext'
  ) s),
  'database', (SELECT to_jsonb(s) FROM (
    SELECT xact_commit, xact_rollback, blks_read, blks_hit, temp_bytes,
           deadlocks, blk_read_time, blk_write_time
    FROM pg_stat_database WHERE datname = current_database()
  ) s),
  'wal', (SELECT to_jsonb(s) FROM (
    SELECT wal_records, wal_fpi, wal_bytes, wal_buffers_full FROM pg_stat_wal
  ) s),
  'functions', (SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) FROM (
    SELECT funcname, calls, total_time, self_time FROM pg_stat_user_functions
    WHERE funcname IN ('crypt', 'authorizeOperatingLedgerWrite',
      'appendOperatingFactThroughService', 'appendOperatingImpactThroughService')
    ORDER BY funcname
  ) s),
  'waits', (SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) FROM (
    SELECT state, wait_event_type, wait_event, count(*) AS backends
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
    GROUP BY state, wait_event_type, wait_event
  ) s),
  'trackIoTiming', current_setting('track_io_timing')
)`;

async function collectContainerResources(command, docker, containerName) {
  const files = {
    cpu: "/sys/fs/cgroup/cpu.stat", quota: "/sys/fs/cgroup/cpu.max",
    memoryBytes: "/sys/fs/cgroup/memory.current", memoryEvents: "/sys/fs/cgroup/memory.events",
    io: "/sys/fs/cgroup/io.stat", cpuPressure: "/proc/pressure/cpu",
    ioPressure: "/proc/pressure/io", hostCpu: "/proc/stat", load: "/proc/loadavg"
  };
  const result = {};
  for (const [key, file] of Object.entries(files)) {
    try { result[key] = (await command(docker, ["exec", containerName, "cat", file], { timeoutMs: 10_000 })).stdout.trim(); }
    catch { result[key] = null; }
  }
  return result;
}

async function observeDatabase(command, docker, containerName, databaseName) {
  const result = await command(docker, ["exec", containerName, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", databaseName, "-Atc", databaseSnapshotSql], { timeoutMs: 10_000 });
  return JSON.parse(result.stdout.trim());
}

// Sequential sampling prevents overlapping probes. Stop awaits the in-flight read.
function startDatabaseSampling({ command, docker, containerName, databaseName, intervalMs = 5000 }) {
  const samples = [];
  const errors = [];
  const started = performance.now();
  let stopped = false;
  let timer;
  let active = Promise.resolve();
  const schedule = () => {
    timer = setTimeout(() => {
      active = observeDatabase(command, docker, containerName, databaseName)
        .then(value => samples.push({ elapsedMs: Math.round(performance.now() - started), ...value }))
        .catch(() => errors.push({ elapsedMs: Math.round(performance.now() - started), error: "observation unavailable" }))
        .finally(() => { if (!stopped) schedule(); });
    }, intervalMs);
    timer.unref();
  };
  schedule();
  return async () => { stopped = true; clearTimeout(timer); await active; return { intervalMs, samples, errors }; };
}

module.exports = { collectEnvironment, collectContainerResources, databaseSnapshotSql, observeDatabase, startDatabaseSampling };

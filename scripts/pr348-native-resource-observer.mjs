// Temporary PR348 metadata probe; never starts or signals a workload.
import { open, readdir, stat, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
const decimal = value => typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value);
const pidNumber = value => decimal(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
const invalid = () => { throw new Error("resource metadata invalid"); };

export function parseProcStat(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 8192) invalid();
  const open = text.indexOf(" ("), close = text.lastIndexOf(") ");
  const pid = text.slice(0, open), fields = text.slice(close + 2).trim().split(/\s+/);
  if (open < 1 || close < open || !pidNumber(pid) || fields.length < 22 ||
      !/^[RSDZTtWXxKPI]$/.test(fields[0]) || !decimal(fields[1]) || !Number.isSafeInteger(Number(fields[1])) ||
      ![11,12,19,21].every(index => decimal(fields[index]))) invalid();
  return { pid: Number(pid), ppid: Number(fields[1]), state: fields[0], starttimeTicks: fields[19],
    utimeTicks: fields[11], stimeTicks: fields[12], rssPages: fields[21] };
}

const IO_KEYS = ["rchar","wchar","syscr","syscw","read_bytes","write_bytes","cancelled_write_bytes"];
const CPU_KEYS = ["usage_usec","user_usec","system_usec","nr_periods","nr_throttled","throttled_usec"];
const MEMORY_KEYS = ["low","high","max","oom","oom_kill","oom_group_kill"];
const PHASES = new Set(["baseline","running","exit","tail"]);
const reason = error => ({ ENOENT: "not_found", ESRCH: "not_found", EACCES: "permission_denied", EPERM: "permission_denied", EOVERFLOW: "truncated", ENOTSUP: "unsupported" })[error?.code] || "parse_invalid";
const unknown = why => ({ status: "unknown", reason: why, values: null });
const same = (left, right) => left.pid === right.pid && left.starttimeTicks === right.starttimeTicks;
const hasUnknown = value => value && typeof value === "object" && (value.status === "unknown" || Object.values(value).some(hasUnknown));
function samplerDelta(before, after) {
  if (![before?.user,before?.system,after?.user,after?.system].every(value => Number.isSafeInteger(value) && value >= 0)) return unknown("parse_invalid");
  if (after.user < before.user || after.system < before.system) return unknown("counter_reset");
  return { status: "observed", unit: "microseconds", userCpuUs: after.user - before.user, systemCpuUs: after.system - before.system };
}
async function readBounded(file) {
  const fd = await open(file, "r");
  try {
    const bytes = Buffer.alloc(8193), result = await fd.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > 8192) throw Object.assign(new Error("metadata limit"), { code: "EOVERFLOW" });
    return bytes.subarray(0, result.bytesRead).toString("utf8");
  } finally { await fd.close(); }
}
function keyedCounters(text, keys, separator = /\s+/) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 8192) invalid();
  const values = {};
  for (const line of text.trim().split("\n")) {
    const [key, value] = line.trim().split(separator);
    if (!keys.includes(key)) continue;
    if (Object.hasOwn(values, key) || !decimal(value)) invalid();
    values[key] = value;
  }
  if (!Object.keys(values).length) invalid();
  return { status: "observed", values, missingKeys: keys.filter(key => !Object.hasOwn(values, key)) };
}
function pressure(text, resource) {
  const values = {};
  for (const line of text.trim().split("\n")) {
    const [kind, ...fields] = line.trim().split(/\s+/);
    if (!(kind === "some" || (kind === "full" && resource !== "cpu"))) continue;
    const total = fields.filter(field => field.startsWith("total="));
    if (Object.hasOwn(values, kind + "TotalUs") || total.length !== 1 || !decimal(total[0].slice(6))) invalid();
    values[kind + "TotalUs"] = total[0].slice(6);
  }
  if (!Object.hasOwn(values, "someTotalUs")) invalid();
  return { status: "observed", values };
}

export function createResourceObserver({ readText = readBounded,
  listTasks = pid => readdir(`/proc/${pid}/task`),
  cgroupIdentity = async directory => { const s = await stat(directory, { bigint: true }); return `${s.dev}:${s.ino}`; },
  now = () => performance.now(), usage = () => process.cpuUsage(), maxProcesses = 64, maxTasks = 128 } = {}) {
  if (!Number.isInteger(maxProcesses) || maxProcesses < 1 || maxProcesses > 64 || !Number.isInteger(maxTasks) || maxTasks < 1 || maxTasks > 128) invalid();
  const known = new Map();
  let rootPid = null, cgroupKey = null;
  const read = async (file, parser) => {
    try {
      const text = await readText(file);
      if (typeof text !== "string" || Buffer.byteLength(text) > 8192) invalid();
      return parser(text);
    } catch (error) { return unknown(reason(error)); }
  };
  const processStat = async pid => {
    const value = await read(`/proc/${pid}/stat`, parseProcStat);
    return value.pid === pid ? value : value.status === "unknown" ? value : unknown("identity_changed");
  };
  async function mixedCgroup() {
    const membership = await read("/proc/self/cgroup", text => {
      const entries = text.split("\n").filter(line => line.startsWith("0::"));
      if (entries.length !== 1) return unknown("unsupported");
      const relative = entries[0].slice(3);
      if (!relative.startsWith("/") || /[\0\r\n]/.test(relative) || relative.split("/").includes("..")) invalid();
      return { directory: path.posix.join("/sys/fs/cgroup", relative) };
    });
    if (!membership.directory) return { scope: "current-cgroup-mixed", ...membership };
    let identity;
    try { identity = await cgroupIdentity(membership.directory); if (!/^\d+:\d+$/.test(identity)) invalid(); }
    catch (error) { return { scope: "current-cgroup-mixed", ...unknown(reason(error)) }; }
    if (cgroupKey !== null && identity !== cgroupKey) return { scope: "current-cgroup-mixed", ...unknown("identity_changed") };
    cgroupKey = identity;
    const base = membership.directory;
    return { scope: "current-cgroup-mixed", identity, status: "observed",
      cpu: await read(base + "/cpu.stat", text => keyedCounters(text, CPU_KEYS)),
      memoryCurrent: await read(base + "/memory.current", text => { const value = text.trim(); if (!decimal(value)) invalid(); return { status: "observed", bytes: value }; }),
      memoryEvents: await read(base + "/memory.events", text => keyedCounters(text, MEMORY_KEYS)),
      psi: Object.fromEntries(await Promise.all(["cpu","memory","io"].map(async resource => [resource, await read(base + `/${resource}.pressure`, text => pressure(text, resource))]))) };
  }
  return {
    async snapshot({ pid = null, phase = "baseline", scheduledAtMs = now() } = {}) {
      if (!PHASES.has(phase) || !Number.isFinite(scheduledAtMs) || (pid !== null && !pidNumber(String(pid)))) invalid();
      if (rootPid !== null && pid !== null && pid !== rootPid) invalid();
      const readBeginMs = now(), cpuBefore = usage(), gaps = new Set(), processes = [];
      let rootIdentity = { status: "unknown", reason: "not_sampled" };
      if (pid !== null) {
        rootPid = pid;
        const value = await processStat(pid);
        if (value.pid) {
          if (!known.has(pid)) known.set(pid, { id: "p0", identity: value, parentId: null });
          rootIdentity = same(value, known.get(pid).identity) ? { status: "observed", id: "p0" } : unknown("identity_changed");
        } else rootIdentity = value;
      }
      for (const record of known.values()) {
        const identity = record.identity, first = await processStat(identity.pid);
        const item = { id: record.id, pid: identity.pid, starttimeTicks: identity.starttimeTicks, observedParentId: record.parentId };
        if (!first.pid || !same(first, identity)) {
          processes.push({ ...item, ...unknown(first.pid ? "identity_changed" : first.reason), cpu: null, io: null, rss: null });
          continue;
        }
        const io = await read(`/proc/${identity.pid}/io`, text => keyedCounters(text, IO_KEYS, /:\s*/));
        const second = await processStat(identity.pid);
        if (!second.pid || !same(second, identity)) {
          processes.push({ ...item, ...unknown(second.pid ? "identity_changed" : second.reason), cpu: null, io: null, rss: null });
          continue;
        }
        const zombie = ["Z","X","x"].includes(second.state);
        processes.push({ ...item, ppid: second.ppid, state: second.state, status: zombie ? "unknown" : "observed",
          ...(zombie ? { reason: "exited_observed" } : {}),
          cpu: zombie ? null : { status: "observed", unit: "clock_ticks", utimeTicks: first.utimeTicks, stimeTicks: first.stimeTicks },
          io: zombie ? null : io.status === "observed" ? { ...io, accounting: "process-and-waited-children-not-additive" } : io,
          rss: zombie ? null : { status: "observed", unit: "pages", pages: first.rssPages, semantics: "approximate-not-exclusive" } });
        if (zombie) continue;
        let tasks;
        const beforeListing = await processStat(identity.pid);
        if (!beforeListing.pid || !same(beforeListing, identity)) { gaps.add("identity_changed"); continue; }
        try { tasks = await listTasks(identity.pid); if (!Array.isArray(tasks)) invalid(); }
        catch (error) { gaps.add(reason(error)); continue; }
        const afterListing = await processStat(identity.pid);
        if (!afterListing.pid || !same(afterListing, identity)) { gaps.add("identity_changed"); continue; }
        if (tasks.length > maxTasks) gaps.add("truncated");
        for (const tid of tasks.slice(0, maxTasks)) {
          if (!pidNumber(String(tid))) { gaps.add("parse_invalid"); continue; }
          const children = await read(`/proc/${identity.pid}/task/${tid}/children`, text => {
            const values = text.trim() ? text.trim().split(/\s+/) : [];
            if (!values.every(pidNumber)) invalid(); return values.map(Number);
          });
          if (!Array.isArray(children)) { gaps.add(children.reason); continue; }
          for (const childPid of children) {
            if (known.has(childPid)) continue;
            if (known.size >= maxProcesses) { gaps.add("truncated"); continue; }
            const child = await processStat(childPid), parentAgain = await processStat(identity.pid);
            if (!child.pid || child.ppid !== identity.pid || !parentAgain.pid || !same(parentAgain, identity)) { gaps.add("ancestry_unverified"); continue; }
            known.set(childPid, { id: `p${known.size}`, identity: child, parentId: record.id });
          }
        }
      }
      const cgroup = await mixedCgroup(), readEndMs = now(), cpuAfter = usage();
      return { phase, scheduledAtMs, readBeginMs, readEndMs, lagMs: Math.max(0, readBeginMs - scheduledAtMs),
        scope: "owned-build-observed-set", rootIdentity, processes, cgroup,
        sampler: samplerDelta(cpuBefore, cpuAfter),
        observedKnownLiveCount: processes.filter(row => row.status === "observed").length,
        completeOwnedLiveCount: null, descendantDiscoveryComplete: false, gaps: [...gaps] };
    }
  };
}

async function writePrivate(outputPath, report) {
  if (!path.isAbsolute(outputPath)) invalid();
  const parent = path.dirname(outputPath), metadata = await lstat(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) || await realpath(parent) !== parent) invalid();
  const text = JSON.stringify(report) + "\n";
  if (Buffer.byteLength(text) > 262144) throw new Error("resource metadata output limit");
  const fd = await open(outputPath, "wx", 0o600);
  try { await fd.writeFile(text); } finally { await fd.close(); }
}

// The caller owns spawn/wait and must not await this tail before starting any next stage.
export async function observeOwnedBuild({ pid, exitPromise, observer = createResourceObserver(),
  now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), outputPath } = {}) {
  if (!pidNumber(String(pid)) || !exitPromise || typeof exitPromise.then !== "function") invalid();
  const startedAtMs = now(), snapshots = [];
  let exitObservedAtMs = null, exitNotificationState = "pending", runningSnapshotsOmitted = 0, snapshotCount = 0, releaseExit;
  const exitSignal = new Promise(resolve => { releaseExit = resolve; });
  const exited = state => { exitObservedAtMs = now(); exitNotificationState = state; releaseExit(); };
  Promise.resolve(exitPromise).then(() => exited("fulfilled"), () => exited("rejected"));
  await Promise.resolve();
  while (exitObservedAtMs === null) {
    const sample = await observer.snapshot({ pid, phase: "running", scheduledAtMs: now() });
    snapshots.push(sample); snapshotCount++;
    if (snapshots.length > 8) { snapshots.shift(); runningSnapshotsOmitted++; }
    if (exitObservedAtMs === null) await Promise.race([sleep(1000), exitSignal]);
  }
  const rootIdentityCaptured = snapshots.some(row => row.rootIdentity.status === "observed");
  for (const offsetMs of [0,250,1000]) {
    const scheduledAtMs = exitObservedAtMs + offsetMs, waitMs = scheduledAtMs - now();
    if (waitMs > 0) await sleep(waitMs);
    snapshots.push(await observer.snapshot({ pid: rootIdentityCaptured ? pid : null, phase: offsetMs === 0 ? "exit" : "tail", scheduledAtMs }));
    snapshotCount++;
  }
  const tailOverrunMs = Math.max(0, ...snapshots.map(row => row.readEndMs - exitObservedAtMs - 1000));
  const report = { schemaVersion: 1, status: "metadata-observation-only", startedAtMs, exitObservedAtMs, exitNotificationState,
    pollIntervalMs: 1000, plannedPostExitOffsetsMs: [0,250,1000], tailOverrunMs,
    samplingIncomplete: tailOverrunMs > 0 || snapshots.some(row => row.gaps.length > 0 || hasUnknown(row)),
    snapshotCount, runningSnapshotsOmitted, snapshots, descendantDiscoveryComplete: false, completeOwnedLiveCount: null,
    coverageLimitation: "one-second-polling-may-miss-short-lived-descendants-and-unseen-orphans",
    ioAggregation: "not-additive-across-waited-parents-and-children", cgroupScope: "current-cgroup-mixed",
    historicalRootCauseProven: false };
  if (outputPath !== undefined) await writePrivate(outputPath, report);
  return report;
}

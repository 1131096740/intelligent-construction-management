import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat as fileStat, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseProcStat, createResourceObserver, observeOwnedBuild } from "./pr348-native-resource-observer.mjs";

test("proc identity and own counters exclude comm and waited-child CPU", () => {
  const raw = "12 (PRIVATE ) nested comm) R 1 2 3 0 0 0 0 0 0 0 2 3 900 800 0 0 1 0 33 4096 7";
  const value = parseProcStat(raw);
  assert.deepEqual(value, { pid: 12, ppid: 1, state: "R", starttimeTicks: "33", utimeTicks: "2", stimeTicks: "3", rssPages: "7" });
  assert.equal(JSON.stringify(value).includes("PRIVATE"), false);
});

const stat = (pid, parent, start, cpu = "2", state = "R") => `${pid} (PRIVATE token ) comm) ${state} ${parent} 2 3 0 0 0 0 0 0 0 ${cpu} 3 900 800 0 0 1 0 ${start} 4096 7`;
function fixture() {
  const files = new Map([
    ["/proc/10/stat", stat(10, 1, "100")], ["/proc/11/stat", stat(11, 10, "110")],
    ["/proc/10/task/10/children", "11"], ["/proc/11/task/11/children", ""],
    ["/proc/10/io", "rchar: 20\nwchar: 30\nsyscr: 2\nsyscw: 3\nread_bytes: 0\nwrite_bytes: 4096\ncancelled_write_bytes: 0\nPRIVATE: hidden"],
    ["/proc/11/io", "rchar: 2\nwchar: 3\nsyscr: 1\nsyscw: 1\nread_bytes: 0\nwrite_bytes: 0\ncancelled_write_bytes: 0"],
    ["/proc/self/cgroup", "0::/job"],
    ["/sys/fs/cgroup/job/cpu.stat", "usage_usec 14\nuser_usec 10\nsystem_usec 4"],
    ["/sys/fs/cgroup/job/memory.current", "4096"],
    ["/sys/fs/cgroup/job/memory.events", "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0"],
    ...["cpu","memory","io"].map(name => [`/sys/fs/cgroup/job/${name}.pressure`, "some avg10=0.00 total=5\nfull avg10=0.00 total=1"])
  ]);
  const readText = async file => {
    if (!files.has(file)) throw Object.assign(new Error("PRIVATE path"), { code: "ENOENT" });
    const value = files.get(file);
    if (value instanceof Error) throw value;
    return value;
  };
  const options = { readText, listTasks: async pid => [String(pid)], cgroupIdentity: async () => "1:2", now: () => 100, usage: () => ({ user: 1, system: 2 }) };
  return { files, options };
}

test("owned snapshots preserve per-process counters and mixed cgroup scope without private text", async () => {
  const f = fixture(), observer = createResourceObserver(f.options), s = await observer.snapshot({ pid: 10, phase: "running" });
  assert.deepEqual(s.processes.map(x => x.pid), [10,11]);
  assert.equal(s.processes[0].cpu.utimeTicks, "2");
  assert.equal(s.processes[0].io.values.write_bytes, "4096");
  assert.equal(s.processes[1].io.values.write_bytes, "0");
  assert.equal(s.processes[0].rss.semantics, "approximate-not-exclusive");
  assert.equal(s.cgroup.scope, "current-cgroup-mixed");
  assert.equal(s.completeOwnedLiveCount, null);
  assert.equal(s.descendantDiscoveryComplete, false);
  assert.equal(JSON.stringify(s).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(s).includes("cutime"), false);
});

test("duplicate PSI counters are unknown rather than a silently overwritten measurement", async () => {
  const f = fixture();
  f.files.set("/sys/fs/cgroup/job/cpu.pressure", "some total=5\nsome total=99");
  const s = await createResourceObserver(f.options).snapshot();
  assert.deepEqual(s.cgroup.psi.cpu, { status: "unknown", reason: "parse_invalid", values: null });
});

test("counter units remain raw ticks and pages without inferring seconds or exclusive memory", async () => {
  const f = fixture(), s = await createResourceObserver(f.options).snapshot({ pid: 10 });
  assert.equal(s.processes[0].cpu.unit, "clock_ticks");
  assert.equal(s.processes[0].rss.unit, "pages");
  assert.equal(s.processes[0].io.accounting, "process-and-waited-children-not-additive");
});

test("known descendants remain owned after reparenting but recycled PIDs never inherit their counters", async () => {
  const f = fixture(), observer = createResourceObserver(f.options);
  await observer.snapshot({ pid: 10 });
  f.files.delete("/proc/10/stat"); f.files.set("/proc/11/stat", stat(11, 1, "110", "9"));
  const reparented = await observer.snapshot({ pid: 10, phase: "exit" });
  assert.equal(reparented.processes[0].status, "unknown");
  assert.equal(reparented.processes[0].cpu, null);
  assert.equal(reparented.processes[1].observedParentId, "p0");
  assert.equal(reparented.processes[1].cpu.utimeTicks, "9");
  f.files.set("/proc/11/stat", stat(11, 1, "999", "99"));
  const reused = await observer.snapshot({ pid: 10, phase: "tail" });
  assert.equal(reused.processes[1].reason, "identity_changed");
  assert.equal(reused.processes[1].cpu, null);
  assert.equal(reused.completeOwnedLiveCount, null);
});

test("permission errors and unsupported cgroups remain unknown without serializing private errors", async () => {
  const f = fixture();
  f.files.set("/proc/10/io", Object.assign(new Error("PRIVATE credential"), { code: "EACCES" }));
  f.files.set("/proc/self/cgroup", "2:cpu:/PRIVATE");
  const s = await createResourceObserver(f.options).snapshot({ pid: 10 });
  assert.deepEqual(s.processes[0].io, { status: "unknown", reason: "permission_denied", values: null });
  assert.equal(s.cgroup.reason, "unsupported");
  assert.equal(s.cgroup.values, null);
  assert.equal(JSON.stringify(s).includes("PRIVATE"), false);
});

test("task enumeration identity changes and discovery caps are explicit gaps", async () => {
  const f = fixture();
  const observer = createResourceObserver({ ...f.options, listTasks: async pid => {
    if (pid === 10) f.files.set("/proc/10/stat", stat(10, 1, "999"));
    return [String(pid)];
  } });
  const s = await observer.snapshot({ pid: 10 });
  assert.equal(s.processes.length, 1);
  assert.ok(s.gaps.includes("identity_changed"));
  const g = fixture(), limited = await createResourceObserver({ ...g.options, maxProcesses: 1 }).snapshot({ pid: 10 });
  assert.deepEqual(limited.gaps, ["truncated"]);
  assert.equal(limited.descendantDiscoveryComplete, false);
});

test("exit notifications schedule 0/250/1000ms samples without gating the caller handoff", async () => {
  let t = 0, resolveExit, exited = false, callerHandoff = null;
  const exitPromise = new Promise(resolve => { resolveExit = resolve; });
  exitPromise.then(() => { callerHandoff = t; });
  const f = fixture(), observer = createResourceObserver({ ...f.options, now: () => t });
  const sleep = async ms => {
    if (!exited && t + ms >= 500) { t = 500; exited = true; resolveExit(); }
    else t += ms;
  };
  const report = await observeOwnedBuild({ pid: 10, exitPromise, observer, now: () => t, sleep });
  assert.equal(report.exitObservedAtMs, 500);
  assert.equal(callerHandoff, 500);
  assert.deepEqual(report.snapshots.filter(x => x.phase !== "running").map(x => x.scheduledAtMs - 500), [0,250,1000]);
  assert.equal(report.pollIntervalMs, 1000);
  assert.equal(report.descendantDiscoveryComplete, false);
  assert.equal(report.historicalRootCauseProven, false);
});

test("an already-exited workload is never attached to a later recycled root PID", async () => {
  let t = 0;
  const f = fixture(), observer = createResourceObserver({ ...f.options, now: () => t });
  const report = await observeOwnedBuild({ pid: 10, exitPromise: Promise.resolve("PRIVATE"), observer,
    now: () => t, sleep: async ms => { t += ms; } });
  assert.ok(report.snapshots.every(row => row.processes.length === 0));
  assert.equal(report.samplingIncomplete, true);
  assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
});

test("unavailable metrics make report completeness conservative while keeping real zeros readable", async () => {
  let t = 0;
  const f = fixture(); f.files.set("/proc/self/cgroup", "2:cpu:/PRIVATE");
  const observer = createResourceObserver({ ...f.options, now: () => t });
  let finish;
  const exitPromise = new Promise(resolve => { finish = resolve; });
  const report = await observeOwnedBuild({ pid: 10, exitPromise, observer, now: () => t,
    sleep: async ms => { t += ms; finish(); } });
  assert.equal(report.samplingIncomplete, true);
  assert.equal(report.snapshots[0].processes[1].io.values.write_bytes, "0");
  assert.equal(report.snapshots[0].cgroup.values, null);
});

test("sampler counter resets are unknown instead of a manufactured zero delta", async () => {
  const f = fixture(); let first = true;
  const s = await createResourceObserver({ ...f.options, usage: () => {
    const value = first ? 10 : 5; first = false; return { user: value, system: value };
  } }).snapshot();
  assert.deepEqual(s.sampler, { status: "unknown", reason: "counter_reset", values: null });
});

test("baseline needs no workload PID and late tail reads are explicitly incomplete", async () => {
  const f = fixture(); let t = 0;
  const observer = createResourceObserver({ ...f.options, now: () => t, readText: async file => {
    if (file === "/proc/self/cgroup") t += 5;
    return f.options.readText(file);
  } });
  const baseline = await observer.snapshot({ phase: "baseline" });
  assert.deepEqual(baseline.processes, []);
  assert.equal(baseline.cgroup.scope, "current-cgroup-mixed");
  const report = await observeOwnedBuild({ pid: 10, exitPromise: Promise.resolve(), observer,
    now: () => t, sleep: async ms => { t += ms; } });
  assert.equal(report.tailOverrunMs, 5);
  assert.equal(report.samplingIncomplete, true);
});

test("private output is exclusive 0600 JSON and cannot overwrite a prior receipt", async () => {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "pr348-resource-pure-"));
  try {
    let t = 0;
    const f = fixture(), outputPath = path.join(directory, "safe.json");
    const observe = () => observeOwnedBuild({ pid: 10, exitPromise: Promise.resolve(), outputPath,
      observer: createResourceObserver({ ...f.options, now: () => t }), now: () => t, sleep: async ms => { t += ms; } });
    const report = await observe(), text = await readFile(outputPath, "utf8");
    assert.equal((await fileStat(outputPath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(text), report);
    assert.equal(text.includes("PRIVATE"), false);
    await assert.rejects(observe, error => error.code === "EEXIST");
    assert.equal(await readFile(outputPath, "utf8"), text);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unknown kernel process states are not accepted as observed metadata", () => {
  assert.throws(() => parseProcStat(stat(10, 1, "100", "2", "N")));
});

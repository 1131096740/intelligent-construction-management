import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const localRequire = createRequire(__filename);
const runtime = localRequire("../../prisma/money-bigint-runner-runtime.cjs");
const roots: string[] = [];
type Mode = "success" | "checks-failure" | "start-failure" | "cleanup-failure" | "signal" | "signal-start" | "fixture-signal" | "cleanup-signal" | "restore-failure" | "foreign" | "preflight-failure";

function fixture(mode: Mode = "success") {
  const artifacts = mkdtempSync(join(tmpdir(), "jg-cleanup-spec-"));
  roots.push(artifacts);
  let exists = false;
  let volumeExists = false;
  const passStates: { containerExists: boolean; volumeExists: boolean }[] = [];
  const exitStates: { code: number; sigintListeners: number; sigtermListeners: number }[] = [];
  const fakeProcess = Object.assign(new EventEmitter(), {
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    platform: process.platform, execPath: process.execPath, pid: 12345,
    stdout: { write: jest.fn((value: string) => {
      if (String(value).includes("ISOLATED CONTRACT FINANCE CHECK PASS")) {
        passStates.push({ containerExists: exists, volumeExists });
      }
    }) }, stderr: { write: jest.fn() }, exit: jest.fn()
  });
  fakeProcess.exit.mockImplementation((code: number) => exitStates.push({
    code,
    sigintListeners: fakeProcess.listenerCount("SIGINT"),
    sigtermListeners: fakeProcess.listenerCount("SIGTERM")
  }));
  const containerId = "a".repeat(64);
  const volumeName = "b".repeat(64);
  const calls: { bin: string; args: string[]; env?: Record<string, string> }[] = [];
  let labels: Record<string, string> = {};
  let finishHeld: (() => void) | undefined;
  function response(bin: string, args: string[], env?: Record<string, string>) {
    if (args[0] === "-e") {
      const input = JSON.parse(env?.JG_CONTRACT_BANK_FIXTURE_INPUT ?? "{}");
      return { status: 0, stdout: String(input.target).replace("://jiangkong:", "://contract_runtime:"), stderr: "" };
    }
    if (bin === "git") return { status: 0, stdout: "c".repeat(40), stderr: "" };
    if (args[0] === "context") return { status: 0, stdout: mode === "preflight-failure" ? "tcp://remote.invalid:2376" : "unix:///fixture/docker.sock", stderr: "" };
    if (args[0] === "info") return { status: 0, stdout: "fixture-daemon", stderr: "" };
    if (args[0] === "image") return { status: 0, stdout: "sha256:fixture", stderr: "" };
    if (args[0] === "run") {
      exists = true;
      volumeExists = true;
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--label") {
          const [key, ...value] = args[i + 1].split("=");
          labels[key] = value.join("=");
        }
      }
      if (mode === "foreign") labels = {};
      return { status: mode === "start-failure" ? 1 : 0, stdout: containerId, stderr: "injected start failure" };
    }
    if (args[0] === "inspect") return exists
      ? { status: 0, stdout: JSON.stringify({ id: containerId, labels, mounts: [{ Type: "volume", Name: volumeName }] }), stderr: "" }
      : { status: 1, stdout: "", stderr: "No such container" };
    if (args[0] === "volume") return volumeExists
      ? { status: 0, stdout: volumeName, stderr: "" }
      : { status: 1, stdout: "", stderr: "No such volume" };
    if (args[0] === "rm") {
      if (mode === "cleanup-failure") return { status: 1, stdout: "", stderr: "injected cleanup failure" };
      exists = false;
      if (args.includes("--volumes")) volumeExists = false;
    }
    if (args[0] === "port") return { status: 0, stdout: "127.0.0.1:12345", stderr: "" };
    if (args[0] === "cp") writeFileSync(args[2], "synthetic failed restore backup");
    if (args[0] === "exec" && args.includes("pg_restore") && mode === "restore-failure") {
      return { status: 1, stdout: "", stderr: "injected restore failure" };
    }
    if (args[0] === "exec" && args.includes("psql")) return { status: 0, stdout: "t\nt|f", stderr: "" };
    if (args.includes("jest") && mode === "checks-failure") return { status: 1, stdout: "", stderr: "injected test failure" };
    return { status: 0, stdout: "", stderr: "" };
  }
  const spawnCommand = (bin: string, args: string[], options: { env?: Record<string, string> }) => {
    calls.push({ bin, args, env: options.env });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null as number | null,
      kill: jest.fn(() => {
        child.exitCode = 143;
        queueMicrotask(() => child.emit("close", 143, "SIGTERM"));
        return true;
      })
    });
    const complete = () => {
      const result = response(bin, args, options.env);
      child.stdout.emit("data", result.stdout);
      child.stderr.emit("data", result.stderr);
      child.exitCode = result.status;
      child.emit("close", result.status, null);
    };
    if (mode === "cleanup-signal" && args[0] === "rm") finishHeld = complete;
    else if (!((mode === "signal" && args.includes("jest")) || (mode === "signal-start" && args[0] === "run") || (mode === "fixture-signal" && args[0] === "-e"))) queueMicrotask(complete);
    return child;
  };
  const filename = join(process.cwd(), "prisma/run-contract-classification-local.cjs");
  const moduleFixture = { exports: {} as { main?: () => Promise<unknown> } };
  const requireFixture = (name: string) => {
    if (name === "node:child_process") return {
      spawnSync: (bin: string, args: string[], options: { env?: Record<string, string> } = {}) => {
        calls.push({ bin, args, env: options.env });
        return response(bin, args, options.env);
      }
    };
    if (name === "node:fs") return { ...localRequire("node:fs"), mkdtempSync: () => artifacts };
    if (name === "./money-bigint-runner-runtime.cjs") return {
      ...runtime,
      createCommandRuntime: (options: object) => runtime.createCommandRuntime({ ...options, spawnCommand })
    };
    if (name === "./contract-bank-runtime-fixture.cjs") return { prepareContractBankRuntime: ({ target }: { target: string }) => target };
    return createRequire(filename)(name);
  };
  runInNewContext(readFileSync(filename, "utf8"), {
    module: moduleFixture, __dirname: join(process.cwd(), "prisma"), __filename: filename,
    require: requireFixture, process: fakeProcess, console: { log: fakeProcess.stdout.write },
    URL, performance, setTimeout, clearTimeout, Atomics, Int32Array, SharedArrayBuffer
  });
  return {
    main: async () => moduleFixture.exports.main?.(), artifacts, calls, fakeProcess,
    manifest: () => JSON.parse(readFileSync(join(artifacts, "resource-manifest.json"), "utf8")),
    failureSummary: () => JSON.parse(readFileSync(join(artifacts, "failure-summary.json"), "utf8")),
    volumeExists: () => volumeExists, containerExists: () => exists,
    finishHeld: () => { if (!finishHeld) throw Error("No held command"); finishHeld(); },
    passStates, exitStates, containerId, volumeName
  };
}

async function waitForCall(f: ReturnType<typeof fixture>, predicate: (call: typeof f.calls[number]) => boolean) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (f.calls.some(predicate)) return;
    await Promise.resolve();
  }
  throw new Error("Expected lifecycle command was not reached");
}

function expectNoPass(f: ReturnType<typeof fixture>) {
  expect(f.passStates).toEqual([]);
}

function expectNoSecrets(f: ReturnType<typeof fixture>, value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/postgres(?:ql)?:\/\/|POSTGRES_PASSWORD|DATABASE_URL|password/iu);
  const passwords = new Set(f.calls.flatMap(({ env }) => env?.POSTGRES_PASSWORD ? [env.POSTGRES_PASSWORD] : []));
  for (const password of passwords) expect(serialized).not.toContain(password);
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("contract classification disposable resource lifecycle", () => {
  it("removes its anonymous volume before reporting success and retains ownership evidence", async () => {
    const f = fixture();
    await f.main();
    expect(f.calls.find(({ args }) => args[0] === "rm")?.args).toContain("--volumes");
    expect(f.volumeExists()).toBe(false);
    expect(f.containerExists()).toBe(false);
    expect(f.passStates).toEqual([{ containerExists: false, volumeExists: false }]);
    expect(f.manifest()).toMatchObject({ status: "passed", cleanup: { status: "completed" }, container: { id: f.containerId, anonymousVolumeNames: [f.volumeName] } });
    expectNoSecrets(f, f.manifest());
    expect(f.fakeProcess.listenerCount("SIGINT")).toBe(0);
    expect(f.fakeProcess.listenerCount("SIGTERM")).toBe(0);
  });

  it("cleans a partially created owned container after docker run fails", async () => {
    const f = fixture("start-failure");
    await expect(f.main()).rejects.toThrow(/start failure/u);
    expect(f.calls.filter(({ args }) => args[0] === "rm").map(({ args }) => args)).toEqual([
      ["rm", "--force", "--volumes", f.containerId]
    ]);
    expect(f.volumeExists()).toBe(false);
    expect(f.manifest()).toMatchObject({ status: "failed", phase: "starting", cleanup: { status: "completed" } });
    expect(f.calls.some(({ args }) => args.includes("jest"))).toBe(false);
    expectNoPass(f);
  });

  it("retains a useful redacted failure summary when business Jest fails", async () => {
    const f = fixture("checks-failure");
    await expect(f.main()).rejects.toThrow(/test failure/u);
    expect(f.volumeExists()).toBe(false);
    expect(f.manifest()).toMatchObject({ status: "failed", phase: "checks", cleanup: { status: "completed" } });
    const summary = f.failureSummary();
    expect(summary).toMatchObject({
      phase: "checks", reason: "Error",
      lastCommand: {
        program: "pnpm", action: "exec",
        testFiles: ["src/database/project-affiliate-company-contract-db.spec.ts"]
      }
    });
    expectNoSecrets(f, summary);
    expectNoSecrets(f, f.manifest());
    expectNoPass(f);
  });

  it("records cleanup_failed and never reports PASS if owned cleanup fails", async () => {
    const f = fixture("cleanup-failure");
    await expect(f.main()).rejects.toThrow(/清理失败|cleanup/iu);
    expect(f.calls.filter(({ args }) => args[0] === "rm")).toHaveLength(1);
    expect(f.manifest()).toMatchObject({ status: "cleanup_failed", cleanup: { status: "failed" } });
    expect(f.volumeExists()).toBe(true);
    expectNoPass(f);
  });

  it("rejects a remote preflight without running or removing a container", async () => {
    const f = fixture("preflight-failure");
    await expect(f.main()).rejects.toThrow(/Local Docker socket/u);
    expect(f.calls.filter(({ args }) => ["run", "rm"].includes(args[0]))).toEqual([]);
    expect(f.manifest()).toMatchObject({ status: "failed", phase: "preflight" });
    expectNoPass(f);
  });

  it("never removes a container whose ownership labels do not match", async () => {
    const f = fixture("foreign");
    await expect(f.main()).rejects.toThrow(/归属|清理失败/u);
    expect(f.calls.filter(({ args }) => args[0] === "rm")).toEqual([]);
    expect(f.containerExists()).toBe(true);
    expect(f.volumeExists()).toBe(true);
    expect(f.manifest()).toMatchObject({ status: "cleanup_failed", cleanup: { status: "failed" } });
    expectNoPass(f);
  });

  it("preserves this run's backup before removing a failed restore container", async () => {
    const f = fixture("restore-failure");
    await expect(f.main()).rejects.toThrow(/restore failure/u);
    const copyIndex = f.calls.findIndex(({ args }) => args[0] === "cp");
    const removeIndex = f.calls.findIndex(({ args }) => args[0] === "rm");
    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(copyIndex).toBeLessThan(removeIndex);
    expect(f.calls[copyIndex].args).toEqual([
      "cp", `${f.containerId}:/tmp/contract-backup.dump`, join(f.artifacts, "failed-contract-backup.dump")
    ]);
    expect(existsSync(join(f.artifacts, "failed-contract-backup.dump"))).toBe(true);
    expect(f.failureSummary()).toMatchObject({ phase: "checks", reason: "Error" });
    expect(f.volumeExists()).toBe(false);
    expectNoPass(f);
  });

  it.each([["SIGINT", 130], ["SIGTERM", 143]] as const)(
    "cleans once and releases listeners before exiting on repeated %s", async (signal, exitCode) => {
      const f = fixture("signal");
      const pending = f.main();
      const rejected = expect(pending).rejects.toThrow(/failed|中断/iu);
      await waitForCall(f, ({ args }) => args.includes("jest"));
      f.fakeProcess.emit(signal);
      f.fakeProcess.emit(signal);
      await rejected;
      await Promise.resolve();
      expect(f.calls.filter(({ args }) => args[0] === "rm")).toHaveLength(1);
      expect(f.volumeExists()).toBe(false);
      expect(f.fakeProcess.exit).toHaveBeenCalledTimes(1);
      expect(f.exitStates).toEqual([{ code: exitCode, sigintListeners: 0, sigtermListeners: 0 }]);
      expect(f.fakeProcess.listenerCount("SIGINT")).toBe(0);
      expect(f.fakeProcess.listenerCount("SIGTERM")).toBe(0);
      expect(f.manifest()).toMatchObject({ status: "interrupted", cleanup: { status: "completed" } });
      expectNoPass(f);
    }
  );

  it("tracks and stops the bank fixture child before cleaning its container on SIGTERM", async () => {
    const f = fixture("fixture-signal");
    const pending = f.main();
    const rejected = expect(pending).rejects.toThrow(/failed|中断/iu);
    await waitForCall(f, ({ args }) => args[0] === "-e");
    expect(f.calls.some(({ env }) => Boolean(env?.JG_CONTRACT_BANK_FIXTURE_INPUT))).toBe(true);
    f.fakeProcess.emit("SIGTERM");
    await rejected;
    await Promise.resolve();
    expect(f.volumeExists()).toBe(false);
    expect(f.calls.filter(({ args }) => args[0] === "rm")).toHaveLength(1);
    expect(f.exitStates).toEqual([{ code: 143, sigintListeners: 0, sigtermListeners: 0 }]);
    expect(f.manifest()).toMatchObject({ status: "interrupted", cleanup: { status: "completed" } });
    expectNoSecrets(f, f.manifest());
    expectNoPass(f);
  });

  it("never reports PASS when a signal arrives during successful cleanup", async () => {
    const f = fixture("cleanup-signal");
    const pending = f.main();
    const rejected = expect(pending).rejects.toThrow(/中断|failed/iu);
    await waitForCall(f, ({ args }) => args[0] === "rm");
    f.fakeProcess.emit("SIGINT");
    f.fakeProcess.emit("SIGINT");
    f.finishHeld();
    await rejected;
    await Promise.resolve();
    expect(f.volumeExists()).toBe(false);
    expect(f.calls.filter(({ args }) => args[0] === "rm")).toHaveLength(1);
    expect(f.manifest()).toMatchObject({ status: "interrupted", cleanup: { status: "completed" } });
    expect(f.exitStates).toEqual([{ code: 130, sigintListeners: 0, sigtermListeners: 0 }]);
    expectNoPass(f);
  });

  it("does not claim complete cleanup when interrupted startup has no confirmed container identity", async () => {
    const f = fixture("signal-start");
    const pending = f.main();
    const rejected = expect(pending).rejects.toThrow(/failed|中断|清理/iu);
    await waitForCall(f, ({ args }) => args[0] === "run");
    f.fakeProcess.emit("SIGTERM");
    f.fakeProcess.emit("SIGTERM");
    await rejected;
    await Promise.resolve();
    expect(f.calls.filter(({ args }) => args[0] === "rm")).toEqual([]);
    expect(f.manifest()).toMatchObject({ status: "cleanup_failed", cleanup: { status: "failed" }, container: { id: null } });
    expect(f.fakeProcess.exit).toHaveBeenCalledTimes(1);
    expect(f.fakeProcess.exit).toHaveBeenCalledWith(143);
    expectNoPass(f);
  });
});

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const localRequire = createRequire(__filename);
const runtime = localRequire("../../prisma/money-bigint-runner-runtime.cjs");

function loadRunner(file: string, mode: "start-failure" | "cleanup-failure" | "signal" | "success" | "preflight-failure") {
  const fakeProcess = Object.assign(new EventEmitter(), {
    env: {
      PATH: "/fixture/bin", HOME: "/fixture/home",
      CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH: "/fixture/evidence.json",
      LOCAL_PG16_DYNAMIC_GATE: "LOCAL_PG16_DYNAMIC_GATE",
      DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: "a".repeat(40),
      DOCKER_HOST: "unix:///fixture/docker.sock"
    },
    platform: process.platform, pid: 12345, argv: ["node", "fixture"],
    stdout: { write: jest.fn() }, stderr: { write: jest.fn() }, exit: jest.fn()
  });
  let interruptRun: ((error: Error) => void) | undefined;
  const command = jest.fn(async (_command: string, args: string[]) => {
    if (args[0] === "rev-parse") return { stdout: "a".repeat(40), stderr: "" };
    if (args[0] === "context") return {
      stdout: mode === "preflight-failure" ? "tcp://remote.invalid:2376" : "unix:///fixture/docker.sock",
      stderr: ""
    };
    if (args[0] === "exec" && args.includes("psql")) {
      const baseline = localRequire("../../prisma/migration-baseline.cjs")
        .loadCanonicalMigrationBaseline({ migrationsRoot: join(process.cwd(), "prisma/migrations") });
      return { stdout: `${baseline.expectedDirectoryCount}|1|${baseline.terminalMigrationChecksum}`, stderr: "" };
    }
    if (args[0] === "image") return { stdout: "sha256:fixture", stderr: "" };
    if (args[0] === "run") {
      if (mode === "start-failure") throw new Error("injected start failure");
      if (mode === "signal") await new Promise((_, reject) => { interruptRun = reject; });
    }
    if (args[0] === "rm" && mode === "cleanup-failure") throw new Error("injected cleanup failure");
    return { stdout: "", stderr: "" };
  });
  const stopAll = jest.fn(async () => { interruptRun?.(new Error("interrupted run")); });
  const removeRoot = jest.fn().mockResolvedValue(undefined);
  const fakeNet = { createServer: () => {
    const server = {
      unref: () => undefined, once: () => server, on: () => server,
      listen: (_port: number, _host: string, callback: () => void) => callback(),
      address: () => ({ port: 12345 }), close: (callback: () => void) => callback()
    };
    return server;
  } };
  const filename = join(process.cwd(), "prisma", file);
  const moduleFixture = { exports: {} as { main: () => Promise<unknown> } };
  runInNewContext(readFileSync(filename, "utf8"), {
    module: moduleFixture, __dirname: join(process.cwd(), "prisma"),
    process: fakeProcess, console, URL, performance, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === "./money-bigint-runner-runtime.cjs") return {
        ...runtime, createCommandRuntime: () => ({ command, stopAll })
      };
      if (name === "node:net") return fakeNet;
      if (name === "node:fs/promises") return {
        mkdtemp: async () => "/fixture/temporary-root", rm: removeRoot
      };
      return createRequire(filename)(name);
    }
  });
  return {
    main: () => file === "run-database-dynamic-remaining-local.cjs"
      ? (moduleFixture.exports.main as (...args: unknown[]) => Promise<unknown>)(fakeProcess.env, ["--group", "project_funding_availability"])
      : moduleFixture.exports.main(),
    command, stopAll, removeRoot, fakeProcess
  };
}

describe.each([
  "run-contract-settlement-v2-local.cjs",
  "run-database-dynamic-remaining-local.cjs"
])("%s cleanup lifecycle", (file) => {
  it("cleans a partially created container when docker run fails", async () => {
    const fixture = loadRunner(file, "start-failure");
    await expect(fixture.main()).rejects.toThrow("injected start failure");
    const deletion = fixture.command.mock.calls.find(([, args]) => args[0] === "rm");
    expect(deletion?.[1]).toEqual([
      "rm", "--force", "--volumes", expect.stringMatching(/^jiangkong-/u)
    ]);
    expect(fixture.stopAll).toHaveBeenCalledTimes(1);
    expect(fixture.removeRoot).toHaveBeenCalledTimes(1);
    expect(fixture.fakeProcess.listenerCount("SIGINT")).toBe(0);
    expect(fixture.fakeProcess.listenerCount("SIGTERM")).toBe(0);
  });

  it("reports cleanup failures while still removing temporary files", async () => {
    const fixture = loadRunner(file, "cleanup-failure");
    await expect(fixture.main()).rejects.toThrow(/清理失败/u);
    expect(fixture.removeRoot).toHaveBeenCalledTimes(1);
    expect(fixture.fakeProcess.stdout.write.mock.calls.flat().join("")).not.toContain('"status":"passed"');
    expect(fixture.fakeProcess.stdout.write.mock.calls.flat().join("")).not.toContain('"mode":"isolated_contract_settlement_v2"');
  });

  it("does not delete a container when local Docker preflight was rejected", async () => {
    const fixture = loadRunner(file, "preflight-failure");
    await expect(fixture.main()).rejects.toThrow(/远程/u);
    expect(fixture.command.mock.calls.some(([, args]) => args[0] === "rm")).toBe(false);
    expect(fixture.removeRoot).toHaveBeenCalledTimes(1);
  });

  it("finishes cleanup before reporting a successful test run", async () => {
    const fixture = loadRunner(file, "success");
    await fixture.main();
    expect(fixture.command.mock.calls.filter(([, args]) => args[0] === "rm")).toHaveLength(1);
    expect(fixture.removeRoot).toHaveBeenCalledTimes(1);
    const writes = fixture.fakeProcess.stdout.write.mock.calls;
    const receipt = writes.findIndex(([value]) => String(value).includes('"mode":'));
    expect(receipt).toBeGreaterThanOrEqual(0);
    expect(fixture.removeRoot.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.fakeProcess.stdout.write.mock.invocationCallOrder[receipt]
    );
  });

  it.each([["SIGINT", 130], ["SIGTERM", 143]] as const)(
    "cleans once on repeated %s during container startup", async (signal, exitCode) => {
      const fixture = loadRunner(file, "signal");
      const pending = fixture.main();
      const rejected = expect(pending).rejects.toThrow("interrupted run");
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (fixture.command.mock.calls.some(([, args]) => args[0] === "run")) break;
        await Promise.resolve();
      }
      expect(fixture.command.mock.calls.some(([, args]) => args[0] === "run")).toBe(true);
      fixture.fakeProcess.emit(signal);
      fixture.fakeProcess.emit(signal);
      await rejected;
      expect(fixture.command.mock.calls.filter(([, args]) => args[0] === "rm")).toHaveLength(1);
      expect(fixture.removeRoot).toHaveBeenCalledTimes(1);
      expect(fixture.fakeProcess.exit).toHaveBeenCalledWith(exitCode);
    }
  );
});

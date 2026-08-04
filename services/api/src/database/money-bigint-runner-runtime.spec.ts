import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

const localRequire = createRequire(__filename);
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption,
  withLocalPostgresHost
} = localRequire("../../prisma/money-bigint-runner-runtime.cjs") as {
  createCommandRuntime: (options: Record<string, unknown>) => {
    command: (commandName: string, args: string[], options?: Record<string, unknown>) => Promise<unknown>;
    activeCount: () => number;
  };
  createRunnerCleanup: (options: {
    stopChildren: () => Promise<void>;
    removeContainer: () => Promise<void>;
    removeTemporaryRoot: () => Promise<void>;
    onComplete?: () => void;
  }) => () => Promise<void>;
  runInterruption: (options: {
    signal: "SIGINT" | "SIGTERM";
    cleanup: () => Promise<void>;
    reportError: (message: string) => void;
    exit: (code: number) => void;
  }) => Promise<void>;
  withLocalPostgresHost: (args: string[]) => string[];
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  kill = jest.fn((signal: NodeJS.Signals) => {
    if (signal === "SIGKILL") {
      this.exitCode = 137;
      queueMicrotask(() => this.emit("close", null, "SIGKILL"));
    }
    return true;
  });
}

describe("money bigint runner runtime", () => {
  it("pins disposable PostgreSQL client commands to the container TCP loopback", () => {
    expect(
      withLocalPostgresHost([
        "exec",
        "container",
        "createdb",
        "-U",
        "jiangkong",
        "database"
      ])
    ).toEqual([
      "exec",
      "container",
      "createdb",
      "-h",
      "127.0.0.1",
      "-U",
      "jiangkong",
      "database"
    ]);
    expect(
      withLocalPostgresHost([
        "exec",
        "container",
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        "jiangkong"
      ])
    ).toEqual([
      "exec",
      "container",
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "jiangkong"
    ]);
  });

  it("tracks command children immediately and removes them on close or error", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const spawnCommand = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const runtime = createCommandRuntime({ spawnCommand, defaultTimeoutMs: 60_000 });

    const firstCommand = runtime.command("first", []);
    expect(runtime.activeCount()).toBe(1);
    first.exitCode = 0;
    first.emit("close", 0, null);
    await expect(firstCommand).resolves.toEqual({ stdout: "", stderr: "" });
    expect(runtime.activeCount()).toBe(0);

    const secondCommand = runtime.command("second", []);
    expect(runtime.activeCount()).toBe(1);
    second.emit("error", new Error("spawn failed"));
    await expect(secondCommand).rejects.toThrow("spawn failed");
    expect(runtime.activeCount()).toBe(0);
  });

  it("times out commands with SIGTERM then SIGKILL and reports the timeout", async () => {
    jest.useFakeTimers();
    try {
      const child = new FakeChild();
      const runtime = createCommandRuntime({
        spawnCommand: jest.fn().mockReturnValue(child),
        defaultTimeoutMs: 100,
        terminationGraceMs: 20
      });

      const pending = runtime.command("slow-command", []);
      await jest.advanceTimersByTimeAsync(100);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      await jest.advanceTimersByTimeAsync(20);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      await expect(pending).rejects.toThrow("slow-command 执行超时");
      expect(runtime.activeCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("attempts every cleanup step and preserves all cleanup failures", async () => {
    const processFailure = new Error("process cleanup failed");
    const containerFailure = new Error("container cleanup failed");
    const stopChildren = jest.fn().mockRejectedValue(processFailure);
    const removeContainer = jest.fn().mockRejectedValue(containerFailure);
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const cleanup = createRunnerCleanup({
      stopChildren,
      removeContainer,
      removeTemporaryRoot
    });

    const error = await cleanup().catch((caught: unknown) => caught);

    expect(stopChildren).toHaveBeenCalledTimes(1);
    expect(removeContainer).toHaveBeenCalledTimes(1);
    expect(removeTemporaryRoot).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([processFailure, containerFailure]);
    expect((error as Error).message).toBe("本地金额验收清理失败：活动进程、临时容器");
  });

  it("awaits single-flight cleanup on interruption and still attempts container and temp removal", async () => {
    const stopChildren = jest.fn().mockRejectedValue(new Error("process cleanup failed"));
    const removeContainer = jest.fn().mockResolvedValue(undefined);
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const cleanup = createRunnerCleanup({
      stopChildren,
      removeContainer,
      removeTemporaryRoot
    });
    const reportError = jest.fn();
    const exit = jest.fn();

    await runInterruption({ signal: "SIGINT", cleanup, reportError, exit });
    await cleanup().catch(() => undefined);

    expect(stopChildren).toHaveBeenCalledTimes(1);
    expect(removeContainer).toHaveBeenCalledTimes(1);
    expect(removeTemporaryRoot).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith("中断清理失败：本地金额验收清理失败：活动进程");
    expect(exit).toHaveBeenCalledWith(130);
  });
});

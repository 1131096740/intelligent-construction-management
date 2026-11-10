const { spawn } = require("node:child_process");
const path = require("node:path");

const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TERMINATION_GRACE_MS = 5 * 1000;

function resolveCorepackHome(sourceEnv, fallbackHome) {
  const configured = sourceEnv.COREPACK_HOME?.trim();
  if (configured) return configured;

  const baseHome = sourceEnv.HOME ?? fallbackHome;
  const cacheRoot =
    sourceEnv.XDG_CACHE_HOME?.trim() ||
    (baseHome ? path.join(baseHome, ".cache") : undefined);
  return cacheRoot ? path.join(cacheRoot, "node", "corepack") : undefined;
}

function withLocalPostgresHost(args) {
  const clientIndex = args.findIndex((argument) =>
    ["pg_isready", "createdb", "psql"].includes(argument)
  );
  if (clientIndex < 0 || args[clientIndex + 1] === "-h") return args;
  return [
    ...args.slice(0, clientIndex + 1),
    "-h",
    "127.0.0.1",
    ...args.slice(clientIndex + 1)
  ];
}

function createCommandRuntime(options = {}) {
  const spawnCommand = options.spawnCommand ?? spawn;
  const defaultCwd = options.defaultCwd;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const terminationGraceMs =
    options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const activeChildren = new Set();
  const inputClosers = new WeakMap();

  function track(child) {
    activeChildren.add(child);
    const release = () => activeChildren.delete(child);
    child.once("close", release);
    child.once("error", release);
    return child;
  }

  function command(commandName, args, commandOptions = {}) {
    return new Promise((resolve, reject) => {
      const hasInput = Object.hasOwn(commandOptions, "stdinText");
      let input;
      if (hasInput) {
        const value = commandOptions.stdinText;
        if (typeof value !== "string" || value.includes("\0") ||
          Buffer.byteLength(value, "utf8") > 16 * 1024 * 1024 ||
          Buffer.from(value, "utf8").toString("utf8") !== value || commandOptions.stdio !== undefined) {
          reject(new Error("LOCAL_TAIL_STDIN_INPUT")); return;
        }
        input = Buffer.from(value, "utf8");
      }
      const child = track(
        spawnCommand(commandName, args, {
          cwd: commandOptions.cwd ?? defaultCwd,
          env: commandOptions.env,
          stdio: commandOptions.stdio ?? [hasInput ? "pipe" : "ignore", "pipe", "pipe"]
        })
      );
      const timeoutMs = commandOptions.timeoutMs ?? defaultTimeoutMs;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let outputExceeded = false;
      let outputBytes = 0;
      const maxOutputBytes = commandOptions.maxOutputBytes ?? Infinity;
      let settled = false;
      let timeoutTimer;
      let forceKillTimer;
      let hardTimeoutTimer;
      let inputOffset = 0, inputStopped = false, inputError = false, inputStopping = false;
      const stopInput = () => {
        if (!hasInput || inputStopped) return;
        inputStopped = true;
        child.stdin?.removeListener("drain", writeInput);
        child.stdin?.destroy();
      };
      function writeInput() {
        if (inputStopped || settled) return;
        try {
          while (inputOffset < input.length) {
            const chunk = input.subarray(inputOffset, Math.min(inputOffset + 64 * 1024, input.length));
            inputOffset += chunk.length;
            if (!child.stdin.write(chunk)) { child.stdin.once("drain", writeInput); return; }
          }
          child.stdin.end();
        } catch { inputError = true; stopInput(); stopCommand(); }
      }

      if (hasInput) inputClosers.set(child, stopInput);

      const timeoutError = () =>
        new Error(`${commandName} 执行超时（${timeoutMs}ms）`);

      const stoppedError = () => outputExceeded
        ? new Error("子进程输出超过允许字节数")
        : timeoutError();

      const clearTimers = () => {
        if (timeoutTimer) clearTimer(timeoutTimer);
        if (forceKillTimer) clearTimer(forceKillTimer);
        if (hardTimeoutTimer) clearTimer(hardTimeoutTimer);
      };
      const settle = (callback) => {
        if (settled) return;
        settled = true;
        stopInput();
        clearTimers();
        callback();
      };

      const stopCommand = () => {
        if (hasInput) { if (inputStopping || settled) return; inputStopping = true; }
        stopInput();
        if (child.exitCode === null) child.kill("SIGTERM");
        forceKillTimer = setTimer(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          hardTimeoutTimer = setTimer(
            () => settle(() => reject(stoppedError())),
            terminationGraceMs
          );
        }, terminationGraceMs);
      };
      const acceptOutput = (chunk) => {
        if (outputExceeded) return false;
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes <= maxOutputBytes) return true;
        outputExceeded = true;
        clearTimers();
        stopCommand();
        return false;
      };

      child.stdout?.on("data", (chunk) => {
        if (!acceptOutput(chunk)) return;
        stdout += chunk;
        if (commandOptions.forwardOutput) process.stdout.write(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        if (!acceptOutput(chunk)) return;
        stderr += chunk;
        if (commandOptions.forwardOutput) process.stderr.write(chunk);
      });
      child.once("error", (error) =>
        settle(() => reject(timedOut || outputExceeded ? stoppedError() : error))
      );
      child.once("close", (code, signal) => {
        settle(() => {
          if (timedOut || outputExceeded) {
            reject(stoppedError());
            return;
          }
          if (hasInput && (inputError || inputOffset !== input.length || !child.stdin.writableFinished)) {
            reject(new Error("LOCAL_TAIL_STDIN_INCOMPLETE")); return;
          }
          if (code === 0) {
            resolve({ stdout, stderr });
            return;
          }
          reject(
            new Error(
              `${commandName} ${args.join(" ")} failed (${signal ?? code})\n${
                stderr || stdout
              }`
            )
          );
        });
      });

      if (hasInput) {
        if (!child.stdin) { inputError = true; stopCommand(); }
        else {
          child.stdin.on("error", () => { inputError = true; stopInput(); if (!settled) stopCommand(); });
          writeInput();
        }
      }

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutTimer = setTimer(() => {
          timedOut = true;
          stopCommand();
        }, timeoutMs);
      }
    });
  }

  async function waitForEnd(child, timeoutMs) {
    if (child.exitCode !== null) return true;
    return new Promise((resolve) => {
      let timer;
      const finish = (ended) => {
        if (timer) clearTimer(timer);
        child.removeListener("close", onClose);
        child.removeListener("error", onError);
        resolve(ended);
      };
      const onClose = () => finish(true);
      const onError = () => finish(true);
      child.once("close", onClose);
      child.once("error", onError);
      if (child.exitCode !== null) {
        finish(true);
        return;
      }
      timer = setTimer(() => finish(false), timeoutMs);
    });
  }

  async function stopChild(child) {
    inputClosers.get(child)?.();
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    if (await waitForEnd(child, terminationGraceMs)) return;
    child.kill("SIGKILL");
    if (!(await waitForEnd(child, terminationGraceMs))) {
      throw new Error("子进程在强制终止后仍未退出");
    }
  }

  async function stopAll() {
    const results = await Promise.allSettled(
      Array.from(activeChildren, (child) => stopChild(child))
    );
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "活动进程清理失败");
    }
  }

  return {
    command,
    track,
    stopAll,
    activeCount: () => activeChildren.size
  };
}

function createRunnerCleanup(options) {
  let cleanupPromise;
  return function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const failures = [];
      for (const [label, step] of [
        ["活动进程", options.stopChildren],
        ["临时容器", options.removeContainer],
        ["临时目录", options.removeTemporaryRoot]
      ]) {
        try {
          await step();
        } catch (error) {
          failures.push({ label, error });
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure) => failure.error),
          `本地金额验收清理失败：${failures.map((failure) => failure.label).join("、")}`
        );
      }
      options.onComplete?.();
    })();
    return cleanupPromise;
  };
}

async function runInterruption(options) {
  try {
    await options.cleanup();
  } catch (error) {
    options.reportError(`中断清理失败：${error instanceof Error ? error.message : "未知错误"}`);
  } finally {
    options.exit(options.signal === "SIGINT" ? 130 : 143);
  }
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_TERMINATION_GRACE_MS,
  createCommandRuntime,
  createRunnerCleanup,
  resolveCorepackHome,
  runInterruption,
  withLocalPostgresHost
};

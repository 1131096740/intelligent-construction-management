"use strict";
// Shared production child lifecycle; protocol tests stay at public run.
const { spawn } = require("node:child_process");
const fault = code => Object.assign(new Error(code), { code });
const nativeProcess = {
  spawn,
  groupSignal: (pid, signal) => process.kill(-pid, signal),
  groupExists: pid => { try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } },
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer)
};
function nativeCommand(executable, args, control, boundary = nativeProcess) {
  return new Promise((resolve, reject) => {
    if (control.signal.aborted) { reject(fault("TASK16_MIGRATE_ABORTED")); return; }
    const child = boundary.spawn(executable, args, { cwd: control.cwd, env: control.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let failure, bytes = 0, settled = false, closed = false, exitCode, killTimer, hardTimer, pollTimer, timer;
    const stdout = [], stderr = [];
    const hasGroup = Number.isInteger(child.pid) && child.pid > 0;
    const alive = () => { if (!hasGroup) return false; try { return boundary.groupExists(child.pid) !== false; } catch { return true; } };
    const kill = signal => { if (hasGroup) { try { boundary.groupSignal(child.pid, signal); } catch { /* absence probe/deadline decides */ } } };
    const abort = () => stop("TASK16_MIGRATE_ABORTED");
    const release = () => { for (const handle of [timer, killTimer, hardTimer, pollTimer]) boundary.clearTimer(handle); control.signal.removeEventListener("abort", abort); };
    const finish = () => {
      if (settled || !closed || alive()) return false;
      settled = true; release();
      if (failure) reject(fault(failure));
      else resolve({ code: exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), actualSettled: true });
      return true;
    };
    const poll = () => { if (!settled && !finish()) pollTimer = boundary.setTimer(poll, 50); };
    const stop = code => {
      if (failure || settled) return; failure = code; kill("SIGTERM");
      killTimer = boundary.setTimer(() => { if (alive()) kill("SIGKILL"); }, 1000);
      hardTimer = boundary.setTimer(() => {
        if (settled || finish()) return;
        settled = true; release();
        child.stdout?.destroy?.(); child.stderr?.destroy?.(); child.unref?.();
        reject(fault("TASK16_MIGRATE_PROCESS_REMAINS"));
      }, 5000);
      poll();
    };
    // Attach lifecycle listeners before touching stdio: spawn failures can have
    // neither PID nor pipes, and emit error asynchronously on the next tick.
    child.once("error", () => stop("TASK16_MIGRATE_SPAWN_FAILED"));
    child.once("close", code => {
      closed = true; exitCode = code;
      if (!hasGroup && !failure) stop("TASK16_MIGRATE_SPAWN_FAILED");
      if (!finish() && !failure) stop("TASK16_MIGRATE_PROCESS_REMAINS");
    });
    timer = boundary.setTimer(() => stop("TASK16_MIGRATE_TIMEOUT"), control.timeoutMs);
    control.signal.addEventListener("abort", abort, { once: true }); if (control.signal.aborted) abort();
    for (const [stream, target] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      if (!stream || typeof stream.on !== "function") { stop("TASK16_MIGRATE_SPAWN_FAILED"); continue; }
      stream.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > control.maxOutputBytes) stop("TASK16_MIGRATE_OUTPUT_LIMIT"); else if (!failure) target.push(Buffer.from(chunk));
      });
    }
  });
}

module.exports = { runTask16BoundedCommand: nativeCommand };

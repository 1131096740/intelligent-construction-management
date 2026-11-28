export function isPol115Owned334(url: URL, scope: "pol115-main" | "notification" | "spot"): boolean {
  const runId = process.env.JG_POL115_334_RUN_ID;
  return process.env.NODE_ENV === "test" && process.env.JG_POL115_334_SCOPE === scope
    && /^[a-f0-9]{32}$/u.test(runId ?? "")
    && url.protocol === "postgresql:" && url.hostname === "127.0.0.1"
    && url.username === "jg_task01_owner" && url.pathname === "/jg_task01_" + runId
    && url.searchParams.getAll("sslmode").join(",") === "require"
    && url.searchParams.getAll("sslaccept").join(",") === "strict"
    && /^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(url.searchParams.getAll("sslcert").join(","));
}

const spawnCodes = ["ENOENT", "EACCES", "EPERM", "EAGAIN", "ENOMEM"];
const exitSignals = ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGINT"];

export function pol115BrowserSpawnError(error: NodeJS.ErrnoException): Error {
  return new Error("POL115_BROWSER_FAILURE " + JSON.stringify({
    phase: "spawn",
    exitCode: null,
    signal: null,
    spawnCode: error.code && spawnCodes.includes(error.code) ? error.code : "OTHER"
  }));
}

export function pol115BrowserExitError(code: number | null, signal: NodeJS.Signals | null): Error {
  return new Error("POL115_BROWSER_FAILURE " + JSON.stringify({
    phase: "exit",
    exitCode: code !== null && Number.isInteger(code) && code >= 0 && code <= 255 ? code : null,
    signal: signal === null || exitSignals.includes(signal) ? signal : "OTHER",
    spawnCode: null
  }));
}

export function isPol115Owned334(url: URL, scope: "pol115" | "spot"): boolean {
  const runId = process.env.JG_POL115_334_RUN_ID;
  return process.env.NODE_ENV === "test" && process.env.JG_POL115_334_SCOPE === scope
    && /^[a-f0-9]{32}$/u.test(runId ?? "")
    && url.protocol === "postgresql:" && url.hostname === "127.0.0.1"
    && url.username === "jg_task01_owner" && url.pathname === "/jg_task01_" + runId
    && url.searchParams.getAll("sslmode").join(",") === "require"
    && url.searchParams.getAll("sslaccept").join(",") === "strict"
    && /^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(url.searchParams.getAll("sslcert").join(","));
}

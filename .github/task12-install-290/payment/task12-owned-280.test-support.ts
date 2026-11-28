export function isOwned280ContractDatabase(url: URL): boolean {
  const runId = process.env.JG_TASK12_OWNED_280_RUN_ID ?? "";
  const port = Number(url.port);
  return process.env.NODE_ENV === "test" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId) &&
    url.protocol === "postgresql:" &&
    url.pathname === "/jg_task01_" + runId.replaceAll("-", "") &&
    url.hostname === "127.0.0.1" && port > 1024 && port !== 5432 &&
    url.username === "jg_task01_owner" && Boolean(url.password) && !url.hash &&
    url.searchParams.getAll("sslmode").length === 1 &&
    url.searchParams.getAll("sslaccept").length === 1 &&
    url.searchParams.getAll("sslcert").length === 1 &&
    url.searchParams.get("sslmode") === "require" &&
    url.searchParams.get("sslaccept") === "strict" &&
    /^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(url.searchParams.get("sslcert") ?? "");
}

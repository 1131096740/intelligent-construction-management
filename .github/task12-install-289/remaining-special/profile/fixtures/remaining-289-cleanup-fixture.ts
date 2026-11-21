export function admitsOriginalCleanupOwnedUrl(url: URL, legacy: boolean): boolean {
  const runId = process.env[legacy ? "JG_REMAINING_289_LEGACY_ID" : "JG_REMAINING_289_PRIMARY_ID"] ?? "";
  const cert = process.env.JG_REMAINING_289_CA_FILE ?? "";
  const port = process.env.JG_REMAINING_289_PG_PORT ?? "";
  return process.env.NODE_ENV === "test" &&
    /^[a-f0-9]{32}$/u.test(runId) &&
    /^\/tmp\/jg394-[A-Za-z0-9]+\/ca\.crt$/u.test(cert) &&
    /^\d{4,5}$/u.test(port) && Number(port) > 1024 && Number(port) <= 65535 && port !== "5432" &&
    url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.port === port &&
    url.username === "jg_task01_owner" && Boolean(url.password) && !url.hash &&
    url.pathname === "/jg_task01_" + runId &&
    url.searchParams.getAll("sslmode").length === 1 && url.searchParams.get("sslmode") === "require" &&
    url.searchParams.getAll("sslaccept").length === 1 && url.searchParams.get("sslaccept") === "strict" &&
    url.searchParams.getAll("sslcert").length === 1 && url.searchParams.get("sslcert") === cert;
}

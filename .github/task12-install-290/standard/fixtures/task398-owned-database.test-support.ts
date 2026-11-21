export function validTask398Database(url: URL, runId: string): boolean {
  if (process.env.TASK398_OWNED_280 !== "1") {
    return url.pathname === "/jiangkong_payment_execution_concurrency";
  }
  return /^[a-f0-9]{32}$/u.test(runId) &&
    url.pathname === `/jg_task01_${runId}` &&
    url.searchParams.get("sslmode") === "require" &&
    url.searchParams.get("sslaccept") === "strict" &&
    Boolean(url.searchParams.get("sslcert"));
}

import { join } from "node:path";

export function assertOrderedIssue333Database(raw: string): string {
  const database = process.env.JG_ORDERED_ISSUE333_DATABASE ?? "";
  const workDir = process.env.TMPDIR;
  const target = new URL(raw);
  if (
    process.env.NODE_ENV !== "test" ||
    raw !== process.env.DATABASE_URL ||
    !/^jg_task01_[a-f0-9]{32}$/.test(database) ||
    target.protocol !== "postgresql:" ||
    target.hostname !== "127.0.0.1" ||
    target.username !== "jg_task01_owner" ||
    !target.port ||
    target.pathname !== "/" + database ||
    target.searchParams.get("sslmode") !== "require" ||
    target.searchParams.get("sslaccept") !== "strict" ||
    !workDir ||
    target.searchParams.get("sslcert") !== join(workDir, "ca.crt")
  ) {
    throw new Error("ISSUE333_ISOLATED_FIXTURE_DATABASE_REQUIRED");
  }
  return raw;
}

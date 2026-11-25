import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { isOwned280ContractDatabase } from "./task12-owned-280.test-support";

type Scope = "affiliate" | "core" | "payment";
const ledgerSha256 = "be6d9aed22658af5e273010a2e1e839544fa27e74e998701fb3d9e9248f88cfc";

export function ownedContractFinanceScope(scope: Scope): boolean {
  const configured = process.env.JG_CONTRACT_FINANCE_SCOPE;
  if (configured === undefined) return false;
  if (configured !== scope) throw new Error("CONTRACT_FINANCE_SCOPE_MISMATCH");
  return true;
}

export function isOwnedContractFinanceDatabase(url: URL, scope: Scope): boolean {
  if (!ownedContractFinanceScope(scope)) return false;
  if (scope === "affiliate" && url.username === "contract_runtime") {
    const owner = new URL(process.env.DATABASE_URL ?? "");
    return isOwned280ContractDatabase(owner) && url.protocol === owner.protocol && url.host === owner.host &&
      url.pathname === owner.pathname && url.search === owner.search && !url.hash && Boolean(url.password);
  }
  return isOwned280ContractDatabase(url);
}

export async function assertOwnedContractFinanceLedger(client: PrismaClient, scope: Scope): Promise<boolean> {
  if (!ownedContractFinanceScope(scope)) return false;
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!isOwnedContractFinanceDatabase(url, scope) || url.username !== "jg_task01_owner") {
    throw new Error("CONTRACT_FINANCE_OWNED_BOOTSTRAP_REQUIRED");
  }
  const [observed] = await client.$queryRaw<Array<{ admitted: boolean; ledger: Array<{ name: string; sha256: string; finished: boolean; rolledBack: boolean }> }>>`
    SELECT current_database() = ${url.pathname.slice(1)} AND current_user = 'jg_task01_owner'
      AND session_user = current_user AND current_user::regrole::oid = 10
      AND EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = current_database() AND datdba = 10)
      AND inet_client_addr() = '127.0.0.1'::inet AND inet_server_addr() = '127.0.0.1'::inet
      AND inet_server_port() = ${Number(url.port)}::int
      AND EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) AS admitted,
      (SELECT jsonb_agg(jsonb_build_object('name', migration_name, 'sha256', checksum,
          'finished', finished_at IS NOT NULL, 'rolledBack', rolled_back_at IS NOT NULL) ORDER BY migration_name)
        FROM public._prisma_migrations) AS ledger
  `;
  const ledger = observed?.ledger.map(({ name, sha256, finished, rolledBack }) => ({ name, sha256, finished, rolledBack }));
  const configured = process.env.JG_CONTRACT_FINANCE_LEDGER;
  if (configured !== undefined && configured !== "329" && configured !== "330") {
    throw new Error("CONTRACT_FINANCE_LEDGER_MODE");
  }
  const count = Number(configured ?? 295);
  if (!observed?.admitted || ledger?.length !== count ||
      createHash("sha256").update(JSON.stringify(ledger.slice(0,282))).digest("hex") !== ledgerSha256 ||
      createHash("sha256").update(JSON.stringify(ledger.slice(0,292))).digest("hex") !==
        "739451e0ff81740db53707acc013709436a746a2b019f99059c6375a5039a775" ||
      createHash("sha256").update(JSON.stringify(ledger.slice(0,294))).digest("hex") !==
        "1b66e6c98907b9c06d64ad2294e203a877157fcb0ca463b4989657ea1d86396d" ||
      createHash("sha256").update(JSON.stringify(ledger.slice(0,295))).digest("hex") !==
        "b0d398a46c4c6a3209e1448ddd415938ea95425c3d823f1f8a77d81dde396f2d" ||
      (count >= 329 && createHash("sha256").update(JSON.stringify(ledger.slice(0,329))).digest("hex") !==
        "3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2") ||
      (count === 330 && createHash("sha256").update(JSON.stringify(ledger)).digest("hex") !==
        "12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f")) {
    throw new Error("CONTRACT_FINANCE_OWNED_LEDGER_MISMATCH");
  }
  return true;
}

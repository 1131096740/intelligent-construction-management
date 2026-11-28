import { Prisma } from "@prisma/client";
import { hasDirectSigningInput } from "./contract-direct-pending-source";

type SourceVersion = { id: string; contractId: string; draftData?: unknown };
export async function directPendingNumbers(client: Pick<Prisma.TransactionClient, "$queryRaw">, versions: readonly SourceVersion[]) {
  const selected = versions.filter(version => hasDirectSigningInput(version.draftData));
  const result = new Map<string, string | null | undefined>(selected.map(version => [version.id, undefined]));
  for (let offset = 0; offset < selected.length; offset += 30) {
    const chunk = selected.slice(offset,offset+30);
    try {
      const rows = await client.$queryRaw<unknown[]>(Prisma.sql`SELECT "id", "contractId", "originalSignedNumber" FROM public."ContractVersion" WHERE ("id", "contractId") IN (${Prisma.join(chunk.map(version => Prisma.sql`(${version.id},${version.contractId})`))})`);
      const checked = new Map<string,string|null>();
      if (!Array.isArray(rows) || rows.length !== chunk.length) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "contractId,id,originalSignedNumber" || !("id" in row) || !("contractId" in row) || !("originalSignedNumber" in row)
          || typeof row.id !== "string" || checked.has(row.id) || !chunk.some(version => version.id === row.id && version.contractId === row.contractId)
          || (row.originalSignedNumber !== null && (typeof row.originalSignedNumber !== "string" || row.originalSignedNumber === ""))) break;
        checked.set(row.id,row.originalSignedNumber);
      }
      if (checked.size === chunk.length) for (const [id,number] of checked) result.set(id,number);
    } catch { /* Unreadable columns are unknown, never a temporary/technical number. */ }
  }
  return result;
}
export function directPendingNumberLabel(value: string | null | undefined) { return value === undefined ? "原合同编号待核对" : value === null ? "未注明编号" : value; }

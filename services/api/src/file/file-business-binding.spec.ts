import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { NON_RECEIPT_FILE_BINDINGS, nonReceiptBusinessFileBindingIds } from "./file-business-binding";

describe("non-receipt file binding registry", () => {
  it("covers business FileId fields outside receipt photos and the dedicated review retention guard", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8"
    );
    const schemaBindings: string[] = [];
    const modelPattern =
      /^model\s+([A-Za-z][A-Za-z0-9]*)\s+\{([\s\S]*?)^\}/gmu;
    for (const match of schema.matchAll(modelPattern)) {
      const [, model, body] = match;
      if (model === "SpotProcurementReceiptPhoto") continue;
      const fieldPattern =
        /^\s+(fileId|[A-Za-z][A-Za-z0-9]*(?:FileId|FileIdSnapshot))\s+String\??(?:\s|$)/gmu;
      for (const fieldMatch of body.matchAll(fieldPattern)) {
        // This field references the parent ContractArchiveFile identity, not a FileObject.
        if (model === "ContractArchiveEvidenceFile" && fieldMatch[1] === "archiveFileId") continue;
        // The review keeps the original file's binding and uses a dedicated physical retention guard.
        if (model === "ContractEconomicReviewFileReference" && fieldMatch[1] === "fileId") continue;
        schemaBindings.push(`${model}.${fieldMatch[1]}`);
      }
    }

    const registered = NON_RECEIPT_FILE_BINDINGS.flatMap(
      ({ table, columns }) =>
        columns.map((column) => `${table}.${column}`)
    );
    expect(registered).toHaveLength(100);
    expect(registered).toContain("GeneralProcurement.archiveFileId");
    expect(registered).toContain("ContractArchiveEvidenceFile.fileId");
    expect(registered).toContain(
      "InvoiceEvidenceRepairResolution.replacementFileId"
    );
    expect([...registered].sort()).toEqual(
      schemaBindings.sort()
    );
  });

  it.each(["absent", "installed"] as const)("keeps regular file bindings readable with the voucher capability %s", async state => {
    const query = jest.fn(async (sql: Prisma.Sql) => {
      if (sql.text.includes("registered_payment_voucher_catalog")) return [{ state }];
      if (!sql.text.includes("receipt_non_receipt_file_binding")) throw new Error("Unexpected binding query");
      if (sql.text.includes('FROM public."RegisteredPaymentVoucher"') !== (state === "installed")) {
        throw new Error("Voucher relation does not match the catalog");
      }
      return [{ fileId: "existing-binding" }];
    });
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    await expect(nonReceiptBusinessFileBindingIds(tx, ["existing-binding"])).resolves.toEqual(["existing-binding"]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("stops before looking up bindings when the voucher installation is incomplete", async () => {
    const query = jest.fn().mockResolvedValue([{ state: "unavailable" }]);
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    await expect(nonReceiptBusinessFileBindingIds(tx, ["existing-binding"])).rejects.toMatchObject({ status: 503 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

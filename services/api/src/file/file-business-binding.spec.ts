import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NON_RECEIPT_FILE_BINDINGS } from "./file-business-binding";

describe("non-receipt file binding registry", () => {
  it("covers every current Prisma business FileId field except receipt photo files", () => {
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
        schemaBindings.push(`${model}.${fieldMatch[1]}`);
      }
    }

    const registered = NON_RECEIPT_FILE_BINDINGS.flatMap(
      ({ table, columns }) =>
        columns.map((column) => `${table}.${column}`)
    );
    expect(registered).toHaveLength(86);
    expect([...registered].sort()).toEqual(
      schemaBindings.sort()
    );
  });
});

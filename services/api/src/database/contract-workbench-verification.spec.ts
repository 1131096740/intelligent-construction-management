import { readFileSync } from "fs";

describe("contract workbench verification script", () => {
  const script = readFileSync(
    `${process.cwd()}/prisma/verify-contract-workbench.cjs`,
    "utf8"
  );

  it("covers the phase-1 workbench path", () => {
    for (const expected of [
      "/auth/login",
      "/contract-templates",
      "/contract-templates?contractTypeKey=material_purchase",
      "equipment_rental",
      "labor_subcontract",
      "/contracts",
      "/contract-workbench/${contractVersionId}",
      "/checkpoints",
      "/rows",
      "/excel-template",
      "/files",
      "/excel-imports",
      "/contract-bill-imports/${preview.importId}/apply",
      "queueDocument",
      "pollDocumentSuccess",
      "/approval-submission"
    ]) {
      expect(script).toContain(expected);
    }
  });

  it("fails clearly when LibreOffice is unavailable", () => {
    expect(script).toContain(
      "DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path."
    );
    expect(script).toContain("console.error(error.message)");
  });
});

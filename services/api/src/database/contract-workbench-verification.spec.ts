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
      "material_purchase",
      "/contract-templates?contractTypeKey=equipment_rental",
      "/contract-templates?contractTypeKey=labor_subcontract",
      "/contract-templates?contractTypeKey=generic_contract",
      "equipment_rental",
      "labor_subcontract",
      "generic_contract",
      "/contract-workbench/${contractVersionId}/offline-revisions",
      "Live线下修订稿",
      "verify-contract-workbench smoke",
      "material-purchase-real-v1.docx",
      "equipment-rental-real-v1.docx",
      "labor-subcontract-real-v1.docx",
      "generic-contract-v1.docx",
      "/contracts",
      "LIVE_GENERATION_CASES",
      "generateLiveDraftDocument",
      "saveLiveGenerationDraft",
      "addBillRowFromData",
      "label: \"generic_contract\"",
      "label: \"equipment_rental\"",
      "label: \"labor_subcontract\"",
      "live draft document",
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
    expect(script).not.toContain("offline-revisions upload stays in service/API tests");
  });

  it("fails clearly when LibreOffice is unavailable", () => {
    expect(script).toContain(
      "DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path."
    );
    expect(script).toContain("console.error(error.message)");
  });
});

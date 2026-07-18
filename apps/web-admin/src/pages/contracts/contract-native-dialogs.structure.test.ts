import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return readFileSync(resolve(__dirname, fileName), "utf8");
}

describe("contract pages sensitive confirmations", () => {
  it.each(["ContractWorkbenchPage.vue", "ContractTakeoverPage.vue"])(
    "does not use browser-native confirm or prompt in %s",
    (fileName) => {
      const page = source(fileName);
      expect(page).not.toContain("window.confirm");
      expect(page).not.toContain("window.prompt");
      expect(page).not.toContain("globalThis.confirm");
      expect(page).not.toContain("globalThis.prompt");
      expect(page).not.toContain("confirmSensitiveAction");
      expect(page).toContain("<SensitiveActionDialog");
    }
  );

  it("uses governed upload and password confirmation for historical entity corrections", () => {
    const page = source("ContractTakeoverPage.vue");
    expect(page).toContain('v-model="companyEntityCorrectionFiles"');
    expect(page).toContain('v-model="companyEntityCorrectionReviewVisible"');
    expect(page).toContain("require-password");
    expect(page).not.toContain('ref="companyEntityCorrectionInputRef"');
  });
});

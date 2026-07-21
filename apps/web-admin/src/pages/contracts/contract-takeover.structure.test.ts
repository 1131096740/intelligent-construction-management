import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./ContractTakeoverPage.vue", import.meta.url), "utf8");
const taxPanel = readFileSync(
  new URL("./components/ContractTaxFactReviewPanel.vue", import.meta.url),
  "utf8"
);

describe("historical takeover unsaved-change governance", () => {
  it("protects route, project, record and form-close transitions", () => {
    expect(page).toContain("useUnsavedChangesGuard");
    expect(page).toContain("takeoverLeaveGuard.requestClose()");
    expect(page).toContain('@change="changeProject"');
    expect(page).toContain("async function cancelEdit()");
    expect(page).toContain("放弃未保存的接管修改？");
  });

  it("includes unsaved tax-revision edits in the parent page guard", () => {
    expect(page).toContain('@dirty-change="taxFactDirty = $event"');
    expect(taxPanel).toContain('"dirty-change": [dirty: boolean]');
    expect(taxPanel).toContain('watch(isDirty, (dirty) => emit("dirty-change", dirty)');
    expect(taxPanel).toContain("已保留当前填写内容");
  });
});

describe("historical takeover review recovery", () => {
  it("keeps confirmation failures inside the dialog and offers a supplement return", () => {
    expect(page).toContain('v-if="confirmError"');
    expect(page).toContain('v-model="supplementReturnVisible"');
    expect(page).toContain("returnContractTakeoverForSupplement");
    expect(page).toContain("退回补充");
  });

  it("defaults new takeover responsibility to the signed-in initiator", () => {
    expect(page).toContain("takeoverResponsibleUserOptions");
    expect(page).toContain('responsibleUserId: auth.user?.id ?? ""');
  });
});

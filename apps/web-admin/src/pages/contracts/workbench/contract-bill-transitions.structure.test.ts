import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("./ContractBillTransitionsSection.vue", import.meta.url),
  "utf8"
);
const workbench = readFileSync(
  new URL("../ContractWorkbenchPage.vue", import.meta.url),
  "utf8"
);

describe("contract bill transition workbench panel", () => {
  it("shows the mapping panel only for a contract change and refreshes the authoritative workbench after mutation", () => {
    expect(workbench).toContain("ContractBillTransitionsSection");
    expect(workbench).toContain('v-if="isChangeVersion"');
    expect(workbench).toContain('@changed="reloadCurrent"');
  });

  it("keeps the required source, target, allocation and conversion facts visible", () => {
    expect(component).toContain("旧版已结算行");
    expect(component).toContain("新版目标行");
    expect(component).toContain("来源已结数量");
    expect(component).toContain("目标期初数量");
    expect(component).toContain("历史金额（分）");
    expect(component).toContain("单位变化时填写换算依据");
  });

  it("uses server-recalculated historic facts, the current revision and explicit save-discard-confirm actions", () => {
    expect(component).toContain("source.historicalQuantity");
    expect(component).toContain("source.historicalAmountCents");
    expect(component).toContain("expectedTargetVersionRevision: props.revision");
    expect(component).toContain("saveContractBillTransitions");
    expect(component).toContain("discardContractBillTransitions");
    expect(component).toContain("confirmContractBillTransitions");
    expect(component).toContain("await load()");
    expect(component).toContain('emit("changed")');
  });

  it("states the confirmation gate and has a responsive mapping-row layout", () => {
    expect(component).toContain("确认前不能提交变更合同");
    expect(component).toContain("合同部主任确认");
    expect(component).toContain("@media (max-width:1100px)");
    expect(component).toContain("@media (max-width:767px)");
  });
});

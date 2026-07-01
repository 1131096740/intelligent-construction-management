import { describe, expect, it } from "vitest";
import {
  contractTypeLabel,
  contractVersionStatusLabel,
  templateStatusLabel
} from "./contract-labels";

describe("contract labels", () => {
  it("maps backend keys to user-facing Chinese labels and preserves unknowns", () => {
    expect(contractTypeLabel("generic_contract")).toBe("通用合同");
    expect(contractTypeLabel("material_purchase")).toBe("材料采购合同");
    expect(contractTypeLabel("custom_type")).toBe("custom_type");
    expect(contractVersionStatusLabel("in_approval")).toBe("审批中");
    expect(templateStatusLabel("succeeded")).toBe("已完成");
  });
});

import { describe, expect, it } from "vitest";
import {
  CONTRACT_WORKBENCH_SECTIONS,
  contractWorkbenchSectionAnchorId,
  selectActiveContractWorkbenchSection
} from "./contract-workbench-sections";

describe("contract workbench vertical sections", () => {
  it("locks the ten business sections in their approved order", () => {
    expect(CONTRACT_WORKBENCH_SECTIONS).toEqual([
      { id: "inspection", label: "资料检查" },
      { id: "basic", label: "基础信息" },
      { id: "parties", label: "合同主体" },
      { id: "professional", label: "专业信息" },
      { id: "bill_tax", label: "清单与税务" },
      { id: "settlement_payment", label: "结算与付款" },
      { id: "clauses", label: "合同条款" },
      { id: "attachments", label: "附件资料" },
      { id: "negotiation_documents", label: "协商与文档" },
      { id: "flow_history", label: "流程记录" }
    ]);
  });

  it("builds stable and unique DOM anchors", () => {
    const anchors = CONTRACT_WORKBENCH_SECTIONS.map((section) =>
      contractWorkbenchSectionAnchorId(section.id)
    );

    expect(new Set(anchors).size).toBe(10);
    expect(anchors).toEqual([
      "contract-workbench-section-inspection",
      "contract-workbench-section-basic",
      "contract-workbench-section-parties",
      "contract-workbench-section-professional",
      "contract-workbench-section-bill_tax",
      "contract-workbench-section-settlement_payment",
      "contract-workbench-section-clauses",
      "contract-workbench-section-attachments",
      "contract-workbench-section-negotiation_documents",
      "contract-workbench-section-flow_history"
    ]);
  });

  it("tracks the visible section nearest the protected sticky offset", () => {
    expect(selectActiveContractWorkbenchSection([
      { id: "basic", isIntersecting: true, top: 72 },
      { id: "parties", isIntersecting: true, top: 340 }
    ], "inspection")).toBe("basic");

    expect(selectActiveContractWorkbenchSection([
      { id: "basic", isIntersecting: true, top: -160 },
      { id: "parties", isIntersecting: true, top: 84 }
    ], "basic")).toBe("parties");
  });

  it("keeps the current section when the observer has no visible candidate", () => {
    expect(selectActiveContractWorkbenchSection([
      { id: "basic", isIntersecting: false, top: -500 }
    ], "professional")).toBe("professional");
  });
});

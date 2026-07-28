import { describe, expect, it, vi } from "vitest";
import {
  createContractWorkbenchIssueLocator,
  normalizeContractReadinessIssue,
  type ContractWorkbenchReadinessIssue
} from "./contract-workbench-issue-location";

describe("contract workbench readiness issue location", () => {
  it("preserves an authoritative field location from the API", () => {
    expect(normalizeContractReadinessIssue({
      key: "tax.default_rate",
      section: "tax",
      message: "请填写合同约定的税率",
      location: {
        sectionId: "bill_tax",
        fieldKey: "defaultTaxRatePercent"
      }
    })).toEqual({
      key: "tax.default_rate",
      level: "blocking",
      message: "请填写合同约定的税率",
      location: {
        sectionId: "bill_tax",
        fieldKey: "defaultTaxRatePercent"
      }
    });
  });

  it("maps an unknown historical issue to a section without inventing a field", () => {
    expect(normalizeContractReadinessIssue({
      key: "legacy.unknown",
      section: "documents",
      message: "历史文档问题"
    })).toEqual({
      key: "legacy.unknown",
      level: "blocking",
      message: "历史文档问题",
      location: {
        sectionId: "negotiation_documents"
      }
    });
  });

  it("activates, scrolls, and then focuses a known field", async () => {
    const calls: string[] = [];
    const locator = createContractWorkbenchIssueLocator({
      activateSection: (id) => calls.push(`activate:${id}`),
      scrollSection: async (id) => {
        calls.push(`scroll:${id}`);
        return true;
      },
      focusField: async (location) => {
        calls.push(`field:${location.fieldKey}`);
        return true;
      },
      focusBillRow: vi.fn()
    });

    await expect(locator.locate(issue({
      sectionId: "parties",
      fieldKey: "counterparty"
    }))).resolves.toEqual({
      focused: true,
      message: "已定位到具体问题"
    });
    expect(calls).toEqual([
      "activate:parties",
      "scroll:parties",
      "field:counterparty"
    ]);
  });

  it("opens the exact bill row before selecting its error cell", async () => {
    const focusBillRow = vi.fn().mockResolvedValue(true);
    const locator = createContractWorkbenchIssueLocator({
      activateSection: vi.fn(),
      scrollSection: vi.fn().mockResolvedValue(true),
      focusField: vi.fn(),
      focusBillRow
    });
    const target = issue({
      sectionId: "bill_tax",
      fieldKey: "quantity",
      billKey: "main_bill",
      rowKey: "row-23"
    });

    await expect(locator.locate(target)).resolves.toEqual({
      focused: true,
      message: "已定位到具体问题"
    });
    expect(focusBillRow).toHaveBeenCalledWith(target.location);
  });

  it("keeps the section active and reports section-only fallback when focus fails", async () => {
    const locator = createContractWorkbenchIssueLocator({
      activateSection: vi.fn(),
      scrollSection: vi.fn().mockResolvedValue(true),
      focusField: vi.fn().mockResolvedValue(false),
      focusBillRow: vi.fn()
    });

    await expect(locator.locate(issue({
      sectionId: "professional",
      fieldKey: "unknownField"
    }))).resolves.toEqual({
      focused: false,
      message: "已定位到相关章节"
    });
  });
});

function issue(
  location: ContractWorkbenchReadinessIssue["location"]
): ContractWorkbenchReadinessIssue {
  return {
    key: "issue-1",
    level: "blocking",
    message: "待处理问题",
    location
  };
}

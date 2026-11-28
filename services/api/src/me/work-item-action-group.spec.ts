import {
  WORK_ITEM_ACTION_GROUPS,
  groupWorkItems,
  workItemActionGroup,
  type WorkItemActionGroupInput
} from "./work-item-action-group";

function item(overrides: Partial<WorkItemActionGroupInput>): WorkItemActionGroupInput {
  return {
    id: "item-1",
    type: "approval",
    title: "审批待办",
    currentNode: "当前节点",
    nextAction: "去办理",
    ...overrides
  };
}

describe("work item action group projection", () => {
  it("把现有待办生产者映射到动作分组，不落进「其他」", () => {
    const cases: Array<[string, WorkItemActionGroupInput, string]> = [
      ["审批实例", item({ id: "approval:1", type: "approval", businessType: "contract_version" }), "approval"],
      ["付款实付", item({ id: "payment-execution:1", type: "payment_execution", businessType: "payment_request" }), "payment"],
      ["零星采购", item({ id: "spot-procurement-purchase:1", type: "procurement", businessType: "spot_procurement" }), "procurement"],
      ["综合采购任务", item({ id: "general-procurement:1", type: "procurement", businessType: "general_procurement" }), "procurement"],
      ["收货复核", item({ id: "spot-receipt-review:1", type: "procurement", businessType: "receipt_review" }), "review"],
      ["履约复核", item({ id: "contract_economic_review:1", type: "approval", businessType: "contract_economic_review" }), "review"],
      ["银行核验", item({ id: "contract_bank_verification:1", type: "approval", businessType: "contract_bank_verification" }), "review"],
      ["用章同意", item({ type: "archive", currentNode: "待同意用章" }), "approval"],
      ["合同归档确认", item({ type: "archive", currentNode: "确认合同归档" }), "review"],
      ["盖章件上传", item({ type: "archive", currentNode: "上传盖章合同" }), "supplement"],
      ["接管复核", item({ type: "contract_takeover", title: "复核历史合同接管" }), "review"],
      ["接管补录", item({ type: "contract_takeover", title: "补录历史合同" }), "supplement"],
      ["未来新增审批类型", item({ type: "approval", businessType: "future_unknown_type" }), "approval"]
    ];
    for (const [label, input, expected] of cases) {
      expect([label, workItemActionGroup(input)]).toEqual([label, expected]);
    }
  });

  it("草稿与阻塞事项不属于首页动作分组", () => {
    expect(workItemActionGroup(item({ type: "draft" }))).toBe("other");
    expect(workItemActionGroup(item({ type: "blocker" }))).toBe("other");
  });

  it("分组计数取全量、摘要最多三条、顺序稳定且省略空分组", () => {
    const items = [
      item({ id: "approval:1" }),
      item({ id: "approval:2", title: "第二个审批" }),
      item({ id: "approval:3", title: "第三个审批" }),
      item({ id: "approval:4", title: "第四个审批" }),
      item({ id: "payment-execution:1", type: "payment_execution", businessType: "payment_request" })
    ];
    const groups = groupWorkItems(items);
    expect(groups.map((group) => group.key)).toEqual(["approval", "payment"]);
    expect(groups[0]).toMatchObject({
      key: "approval",
      title: "待审批",
      count: 4,
      targetPath: "/审批中心?view=pendingApproval"
    });
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].items.map((entry) => entry.id)).toEqual(["approval:1", "approval:2", "approval:3"]);
    expect(groups[1]).toMatchObject({ key: "payment", count: 1, title: "待付款" });
    expect(groups[1].targetPath).toBe("/付款管理");
  });

  it("每个分组都有中文标题、描述与直达路径", () => {
    for (const group of WORK_ITEM_ACTION_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.description.length).toBeGreaterThan(5);
      expect(group.targetPath.startsWith("/")).toBe(true);
    }
    expect(WORK_ITEM_ACTION_GROUPS.map((group) => group.key)).toEqual([
      "approval",
      "review",
      "procurement",
      "payment",
      "supplement"
    ]);
  });
});

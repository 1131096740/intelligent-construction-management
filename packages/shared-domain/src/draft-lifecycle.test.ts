import { describe, expect, it } from "vitest";

import {
  DRAFT_LEDGER_VIEWS,
  DRAFT_LEDGER_VIEW_LABELS,
  DRAFT_LIFECYCLE_ACTIONS,
  DRAFT_LIFECYCLE_ACTION_LABELS,
  DRAFT_LIFECYCLE_KINDS,
  DRAFT_LIFECYCLE_KIND_LABELS,
  draftLedgerViewLabel,
  draftLifecycleActionLabel,
  draftLifecycleKindLabel
} from "./draft-lifecycle";

describe("draft lifecycle presentation contract", () => {
  it("keeps the five lifecycle kinds stable", () => {
    expect(DRAFT_LIFECYCLE_KINDS).toEqual([
      "local_unsaved",
      "pristine_draft",
      "approval_draft",
      "formal_record",
      "technical_temporary"
    ]);
    expect(DRAFT_LIFECYCLE_KIND_LABELS).toEqual({
      local_unsaved: "未保存填写",
      pristine_draft: "纯净草稿",
      approval_draft: "审批型草稿",
      formal_record: "正式业务记录",
      technical_temporary: "技术临时数据"
    });
  });

  it("keeps the four ledger views stable", () => {
    expect(DRAFT_LEDGER_VIEWS).toEqual([
      "formal_ledger",
      "my_drafts",
      "returned_for_revision",
      "ended"
    ]);
    expect(DRAFT_LEDGER_VIEW_LABELS).toEqual({
      formal_ledger: "正式台账",
      my_drafts: "我的草稿",
      returned_for_revision: "退回待修改",
      ended: "已结束"
    });
  });

  it("keeps lifecycle actions distinct instead of deriving them from status", () => {
    expect(DRAFT_LIFECYCLE_ACTIONS).toEqual([
      "discard_local",
      "delete_pristine_draft",
      "abandon_application",
      "withdraw",
      "void",
      "terminate",
      "discard_version"
    ]);
    expect(DRAFT_LIFECYCLE_ACTION_LABELS).toEqual({
      discard_local: "放弃填写",
      delete_pristine_draft: "删除草稿",
      abandon_application: "放弃申请",
      withdraw: "撤回申请",
      void: "作废",
      terminate: "异常终止",
      discard_version: "废弃版本"
    });
  });

  it("returns stable labels without exporting a status-only deletion rule", () => {
    expect(draftLifecycleKindLabel("approval_draft")).toBe("审批型草稿");
    expect(draftLedgerViewLabel("returned_for_revision")).toBe("退回待修改");
    expect(draftLifecycleActionLabel("delete_pristine_draft")).toBe("删除草稿");
  });
});

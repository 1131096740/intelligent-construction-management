import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  businessDraftActionConfig,
  toBusinessDraftActionItems
} from "./business-draft-action.config";

describe("business draft action configuration", () => {
  it("fixes the seven lifecycle labels, danger treatment and reason policy", () => {
    expect(businessDraftActionConfig).toEqual({
      discard_local: expect.objectContaining({ label: "放弃填写", danger: true, requireReason: false }),
      delete_pristine_draft: expect.objectContaining({ label: "删除草稿", danger: true, requireReason: false }),
      abandon_application: expect.objectContaining({ label: "放弃申请", danger: true, requireReason: true }),
      withdraw: expect.objectContaining({ label: "撤回申请", danger: true, requireReason: false }),
      void: expect.objectContaining({ label: "作废", danger: true, requireReason: false }),
      terminate: expect.objectContaining({ label: "异常终止", danger: true, requireReason: false }),
      discard_version: expect.objectContaining({ label: "废弃版本", danger: true, requireReason: false })
    });
  });

  it("only projects recognized server actions and never renders discard_local", () => {
    const actions: DetailActionReadModel[] = [
      action({ key: "delete_pristine_draft", label: "删除合同草稿" }),
      action({ key: "discard_local", label: "不应由服务端提供" }),
      action({ key: "edit_draft", label: "继续编辑" })
    ];

    expect(toBusinessDraftActionItems(actions)).toEqual([
      expect.objectContaining({ key: "delete_pristine_draft", label: "删除合同草稿" })
    ]);
  });

  it("keeps exact server disabled reasons and follows per-action reason requirements", () => {
    const items = toBusinessDraftActionItems([
      action({
        key: "withdraw",
        label: "撤回付款申请",
        enabled: false,
        disabledReason: "已有实际付款，不能撤回",
        requiresComment: true
      }),
      action({ key: "abandon_application", label: "放弃付款申请" })
    ]);

    expect(items[0]).toMatchObject({
      enabled: false,
      disabledReason: "已有实际付款，不能撤回",
      requireReason: true
    });
    expect(items[1]).toMatchObject({ requireReason: true });
  });
});

function action(overrides: Partial<DetailActionReadModel>): DetailActionReadModel {
  return {
    key: "withdraw",
    label: "撤回申请",
    kind: "danger",
    enabled: true,
    disabledReason: null,
    ...overrides
  };
}

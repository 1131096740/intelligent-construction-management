import { describe, expect, it } from "vitest";
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import { countEnabledActions, toBusinessActionPanelItems } from "./business-action-panel.config";

describe("business action panel helpers", () => {
  it("turns backend action metadata into readable action states", () => {
    const actions: DetailActionReadModel[] = [
      action({
        key: "confirm_archive",
        label: "确认归档",
        kind: "primary",
        enabled: true,
        requiresPassword: true
      }),
      action({
        key: "record_execution",
        label: "登记实付",
        kind: "danger",
        enabled: false,
        disabledReason: "付款尚未审批通过。",
        requiresComment: true,
        requiresFile: true
      })
    ];

    expect(countEnabledActions(actions)).toBe(1);
    expect(toBusinessActionPanelItems(actions)).toEqual([
      {
        key: "confirm_archive",
        label: "确认归档",
        statusText: "可操作",
        statusTheme: "primary",
        reason: "",
        requirementText: "需当前密码"
      },
      {
        key: "record_execution",
        label: "登记实付",
        statusText: "暂不可操作",
        statusTheme: "warning",
        reason: "付款尚未审批通过。",
        requirementText: "需填写意见 / 需选择文件"
      }
    ]);
  });
});

function action(overrides: Partial<DetailActionReadModel>): DetailActionReadModel {
  return {
    key: "action",
    label: "动作",
    kind: "normal",
    enabled: true,
    disabledReason: null,
    ...overrides
  };
}

import type { DetailActionReadModel } from "@jiangkong/shared-domain";

export type BusinessActionPanelTheme = "default" | "primary" | "warning" | "danger";

export interface BusinessActionPanelItem {
  key: string;
  label: string;
  statusText: string;
  statusTheme: BusinessActionPanelTheme;
  reason: string;
  requirementText: string;
}

const enabledThemeByKind: Record<DetailActionReadModel["kind"], BusinessActionPanelTheme> = {
  primary: "primary",
  normal: "default",
  danger: "danger"
};

export function toBusinessActionPanelItems(
  actions: DetailActionReadModel[]
): BusinessActionPanelItem[] {
  return actions.filter((action) => action.enabled).map((action) => ({
    key: action.key,
    label: action.label,
    statusText: "可办理",
    statusTheme: enabledThemeByKind[action.kind],
    reason: "",
    requirementText: actionRequirements(action)
  }));
}

export function countEnabledActions(actions: DetailActionReadModel[]) {
  return actions.filter((action) => action.enabled).length;
}

function actionRequirements(action: DetailActionReadModel) {
  const requirements = [
    action.requiresSelfReviewConfirmation ? "需填写自审原因" : "",
    action.requiresSelfReviewConfirmation ? "需当前密码" : "",
    action.requiresPassword ? "需当前密码" : "",
    action.requiresComment ? "需填写意见" : "",
    action.requiresFile ? "需选择文件" : ""
  ].filter(Boolean);

  return requirements.join(" / ");
}

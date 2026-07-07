import {
  canPerform,
  type BusinessAction,
  type DetailActionReadModel,
  type RoleKey
} from "@jiangkong/shared-domain";

interface DetailActionInput {
  key: string;
  label: string;
  kind: DetailActionReadModel["kind"];
  roleKeys: RoleKey[];
  enabled: boolean;
  disabledReason?: string;
  requiredAction?: BusinessAction;
  skipRoleCheck?: boolean;
  requiresPassword?: boolean;
  requiresComment?: boolean;
  requiresFile?: boolean;
}

export function detailAction(input: DetailActionInput): DetailActionReadModel {
  const roleAllowed = input.skipRoleCheck
    ? true
    : input.requiredAction
      ? canPerform(input.requiredAction, input.roleKeys)
      : true;
  const enabled = input.enabled && roleAllowed;

  return {
    key: input.key,
    label: input.label,
    kind: input.kind,
    enabled,
    disabledReason: enabled
      ? null
      : roleAllowed
        ? input.disabledReason ?? "当前状态不可执行"
        : "当前岗位无权执行此动作",
    requiredAction: input.requiredAction,
    requiresPassword: input.requiresPassword,
    requiresComment: input.requiresComment,
    requiresFile: input.requiresFile
  };
}

export function primaryActionKey(actions: DetailActionReadModel[]): string | null {
  return actions.find((action) => action.enabled && action.kind === "primary")?.key ?? null;
}

export function disabledActionReasons(actions: DetailActionReadModel[]): string[] {
  return actions
    .filter((action) => action.kind === "primary" && !action.enabled && action.disabledReason)
    .map((action) => `${action.label}：${action.disabledReason}`);
}

import { applyPersonnelChange, applyProjectRosterChange, fetchOrganizationManagementCapabilities, fetchProjectRosterManagementOptions,
  previewPersonnelChange, previewProjectRosterChange, type PersonnelCommand, type ProjectRosterChange } from "../../api/organization.api";

export async function previewPersonnelWithCapability(body: PersonnelCommand, signal: AbortSignal) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageUsers;
  if (!operationAllowed) throw new Error("当前账号没有人事办理权限");
  const personAllowed = capability.manageableUserIds.includes(body.userId);
  if (!personAllowed) throw new Error("当前账号不能办理该人员，请刷新维护范围");
  const cancelled = signal.aborted;
  if (cancelled) throw new Error("已取消等待，尚未提交新的办理");
  return previewPersonnelChange(body);
}
export async function applyPersonnelWithCapability(body: Parameters<typeof applyPersonnelChange>[0], signal: AbortSignal, state: { phase: { value: "idle" | "reading" | "submitting" }; submitted: boolean }) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageUsers;
  if (!operationAllowed) throw new Error("当前账号没有人事办理权限");
  const personAllowed = capability.manageableUserIds.includes(body.userId);
  if (!personAllowed) throw new Error("当前账号不能办理该人员，请刷新维护范围");
  const cancelled = signal.aborted;
  if (cancelled) throw new Error("已取消等待，尚未提交新的办理");
  state.phase.value = "submitting";
  state.submitted = true;
  return applyPersonnelChange(body);
}
export async function previewRosterWithCapability(body: ProjectRosterChange, signal: AbortSignal) {
  const capability = await fetchProjectRosterManagementOptions();
  const operationAllowed = capability.canManageRoster;
  if (!operationAllowed) throw new Error("当前账号不能调整项目人员");
  const personAllowed = capability.users.some((user) => user.id === body.userId && user.canManage);
  if (!personAllowed) throw new Error("当前账号不能调整该人员，请刷新维护范围");
  const cancelled = signal.aborted;
  if (cancelled) throw new Error("已取消等待，尚未提交新的办理");
  return previewProjectRosterChange(body);
}
export async function applyRosterWithCapability(body: Parameters<typeof applyProjectRosterChange>[0], signal: AbortSignal, state: { phase: { value: "idle" | "reading" | "submitting" }; submitted: boolean }) {
  const capability = await fetchProjectRosterManagementOptions();
  const operationAllowed = capability.canManageRoster;
  if (!operationAllowed) throw new Error("当前账号不能调整项目人员");
  const personAllowed = capability.users.some((user) => user.id === body.userId && user.canManage);
  if (!personAllowed) throw new Error("当前账号不能调整该人员，请刷新维护范围");
  const cancelled = signal.aborted;
  if (cancelled) throw new Error("已取消等待，尚未提交新的办理");
  state.phase.value = "submitting";
  state.submitted = true;
  return applyProjectRosterChange(body);
}

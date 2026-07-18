import type { RoleKey } from "@jiangkong/shared-domain";
import {
  GLOBAL_ORGANIZATION_ROLE_KEYS,
  type CreateOrganizationUserPayload
} from "../../api/organization.api";

export interface OrganizationUserCreationForm {
  phone: string;
  departmentId: string;
  initialRoleKey: RoleKey | "";
  projectId: string;
  confirmationPassword: string;
  passwordRecorded: boolean;
}

export function emptyOrganizationUserCreationForm(): OrganizationUserCreationForm {
  return {
    phone: "",
    departmentId: "",
    initialRoleKey: "",
    projectId: "",
    confirmationPassword: "",
    passwordRecorded: false
  };
}

export function buildOrganizationUserCreatePayload(
  form: OrganizationUserCreationForm
): CreateOrganizationUserPayload {
  const phone = form.phone.trim();
  if (!/^1[3-9]\d{9}$/u.test(phone)) throw new Error("手机号格式不正确");
  const departmentId = form.departmentId.trim();
  if (!departmentId) throw new Error("请选择启用部门");
  if (!form.initialRoleKey) throw new Error("请选择初始岗位");
  const projectId = form.projectId.trim();
  const globalRole = GLOBAL_ORGANIZATION_ROLE_KEYS.includes(form.initialRoleKey);
  if (!globalRole && !projectId) throw new Error("项目岗位必须选择项目");
  if (globalRole && projectId) throw new Error("全局岗位不需要安排项目");
  if (!form.confirmationPassword.trim()) throw new Error("请输入当前登录密码");
  if ([...form.confirmationPassword].length > 256) {
    throw new Error("当前登录密码不能超过 256 个字符");
  }
  if (!form.passwordRecorded) {
    throw new Error("请先确认已通过线下安全渠道告知公司统一初始密码");
  }
  return {
    phone,
    departmentId,
    initialRoleKey: form.initialRoleKey,
    ...(projectId ? { projectId } : {}),
    confirmationPassword: form.confirmationPassword
  };
}

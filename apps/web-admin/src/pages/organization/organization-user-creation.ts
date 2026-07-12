import type { RoleKey } from "@jiangkong/shared-domain";
import {
  GLOBAL_ORGANIZATION_ROLE_KEYS,
  type CreateOrganizationUserPayload
} from "../../api/organization.api";

const TEMPORARY_PASSWORD_LENGTH = 24;
const PASSWORD_GROUPS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "!@#$%&*+-_"
] as const;
const PASSWORD_ALPHABET = PASSWORD_GROUPS.join("");

export interface OrganizationUserCreationForm {
  phone: string;
  departmentId: string;
  initialRoleKey: RoleKey | "";
  projectId: string;
  temporaryPassword: string;
  confirmationPassword: string;
  passwordRecorded: boolean;
}

export function emptyOrganizationUserCreationForm(): OrganizationUserCreationForm {
  return {
    phone: "",
    departmentId: "",
    initialRoleKey: "",
    projectId: "",
    temporaryPassword: "",
    confirmationPassword: "",
    passwordRecorded: false
  };
}

export function generateTemporaryPassword(
  cryptoSource: Pick<Crypto, "getRandomValues"> | null | undefined = globalThis.crypto
) {
  if (!cryptoSource?.getRandomValues) {
    throw new Error("当前浏览器无法安全生成临时密码，请更换浏览器后重试");
  }
  const characters = PASSWORD_GROUPS.map((group) => secureCharacter(group, cryptoSource));
  while (characters.length < TEMPORARY_PASSWORD_LENGTH) {
    characters.push(secureCharacter(PASSWORD_ALPHABET, cryptoSource));
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = secureIndex(index + 1, cryptoSource);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join("");
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
  if (form.temporaryPassword.length < 8) throw new Error("临时密码至少需要 8 个字符");
  if (!/\S/u.test(form.temporaryPassword)) throw new Error("临时密码不能全为空白字符");
  if ([...form.temporaryPassword].length > 256) throw new Error("临时密码不能超过 256 个字符");
  if (!form.confirmationPassword.trim()) throw new Error("请输入当前登录密码");
  if ([...form.confirmationPassword].length > 256) {
    throw new Error("当前登录密码不能超过 256 个字符");
  }
  if (!form.passwordRecorded) throw new Error("请先通过线下安全渠道记录临时密码");
  return {
    phone,
    departmentId,
    initialRoleKey: form.initialRoleKey,
    ...(projectId ? { projectId } : {}),
    temporaryPassword: form.temporaryPassword,
    confirmationPassword: form.confirmationPassword
  };
}

function secureCharacter(
  alphabet: string,
  cryptoSource: Pick<Crypto, "getRandomValues">
) {
  return alphabet[secureIndex(alphabet.length, cryptoSource)];
}

function secureIndex(limit: number, cryptoSource: Pick<Crypto, "getRandomValues">) {
  const bytes = new Uint8Array(1);
  const maximum = 256 - (256 % limit);
  do {
    cryptoSource.getRandomValues(bytes);
  } while (bytes[0] >= maximum);
  return bytes[0] % limit;
}

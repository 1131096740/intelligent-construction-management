import type { CreateOrganizationUserPayload } from "../../api/organization.api";

const TEMPORARY_PASSWORD_LENGTH = 24;
const PASSWORD_GROUPS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "!@#$%&*+-_"
] as const;
const PASSWORD_ALPHABET = PASSWORD_GROUPS.join("");

export interface OrganizationUserCreationForm {
  name: string;
  phone: string;
  departmentId: string;
  temporaryPassword: string;
  confirmationPassword: string;
  passwordRecorded: boolean;
}

export function emptyOrganizationUserCreationForm(): OrganizationUserCreationForm {
  return {
    name: "",
    phone: "",
    departmentId: "",
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
  const name = form.name.trim();
  if (!name) throw new Error("请填写人员姓名");
  if ([...name].length > 100) throw new Error("人员姓名不能超过 100 个字符");
  const phone = form.phone.trim();
  if (!/^1[3-9]\d{9}$/u.test(phone)) throw new Error("手机号格式不正确");
  const departmentId = form.departmentId.trim();
  if (!departmentId) throw new Error("请选择启用部门");
  if (form.temporaryPassword.length < 8) throw new Error("临时密码至少需要 8 个字符");
  if (!/\S/u.test(form.temporaryPassword)) throw new Error("临时密码不能全为空白字符");
  if ([...form.temporaryPassword].length > 256) throw new Error("临时密码不能超过 256 个字符");
  if (!form.confirmationPassword.trim()) throw new Error("请输入当前登录密码");
  if ([...form.confirmationPassword].length > 256) {
    throw new Error("当前登录密码不能超过 256 个字符");
  }
  if (!form.passwordRecorded) throw new Error("请先通过线下安全渠道记录临时密码");
  return {
    name,
    phone,
    departmentId,
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

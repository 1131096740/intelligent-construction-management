import { ServiceUnavailableException } from "@nestjs/common";

export const INITIAL_USER_TEMPORARY_PASSWORD_ENV = "INITIAL_USER_TEMPORARY_PASSWORD";

export function configuredInitialUserTemporaryPassword(
  environment: NodeJS.ProcessEnv = process.env
) {
  const password = environment[INITIAL_USER_TEMPORARY_PASSWORD_ENV]?.trim();
  if (!password) {
    throw new ServiceUnavailableException("账号初始密码策略未配置，请联系技术管理员");
  }
  if (password.length < 8 || !/\S/u.test(password)) {
    throw new ServiceUnavailableException("账号初始密码策略配置无效，请联系技术管理员");
  }
  return password;
}

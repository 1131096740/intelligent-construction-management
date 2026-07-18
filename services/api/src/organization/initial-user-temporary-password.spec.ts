import { ServiceUnavailableException } from "@nestjs/common";
import {
  configuredInitialUserTemporaryPassword,
  INITIAL_USER_TEMPORARY_PASSWORD_ENV
} from "./initial-user-temporary-password";

describe("configuredInitialUserTemporaryPassword", () => {
  it("只从服务端环境读取并去除配置两侧空白", () => {
    expect(
      configuredInitialUserTemporaryPassword({
        [INITIAL_USER_TEMPORARY_PASSWORD_ENV]: "  configured-password  "
      })
    ).toBe("configured-password");
  });

  it.each([undefined, "", "       ", "1234567"])("缺失或不合规配置时拒绝开户: %p", (value) => {
    expect(() =>
      configuredInitialUserTemporaryPassword({
        ...(value === undefined ? {} : { [INITIAL_USER_TEMPORARY_PASSWORD_ENV]: value })
      })
    ).toThrow(ServiceUnavailableException);
  });
});

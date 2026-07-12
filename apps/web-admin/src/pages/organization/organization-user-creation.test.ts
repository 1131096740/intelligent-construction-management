import { describe, expect, it } from "vitest";
import {
  buildOrganizationUserCreatePayload,
  emptyOrganizationUserCreationForm,
  generateTemporaryPassword,
  type OrganizationUserCreationForm
} from "./organization-user-creation";

function deterministicCrypto() {
  let cursor = 0;
  return {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!array || !(array instanceof Uint8Array)) throw new Error("expected bytes");
      for (let index = 0; index < array.length; index += 1) {
        array[index] = (cursor * 17 + 11) % 200;
        cursor += 1;
      }
      return array;
    }
  } as Pick<Crypto, "getRandomValues">;
}

describe("organization user creation", () => {
  it("generates a high-entropy-shaped temporary password with Web Crypto", () => {
    const password = generateTemporaryPassword(deterministicCrypto());
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[A-Z]/u);
    expect(password).toMatch(/[a-z]/u);
    expect(password).toMatch(/[2-9]/u);
    expect(password).toMatch(/[!@#$%&*+\-_]/u);
  });

  it("fails closed without Web Crypto", () => {
    expect(() => generateTemporaryPassword(null)).toThrow(
      "当前浏览器无法安全生成临时密码"
    );
  });

  it("builds the initial project-role payload while preserving both passwords", () => {
    expect(
      buildOrganizationUserCreatePayload({
        phone: " 13800000001 ",
        departmentId: " department-1 ",
        initialRoleKey: "contract_staff",
        projectId: " project-1 ",
        temporaryPassword: " temporary-password ",
        confirmationPassword: " current-password ",
        passwordRecorded: true
      })
    ).toEqual({
      phone: "13800000001",
      departmentId: "department-1",
      initialRoleKey: "contract_staff",
      projectId: "project-1",
      temporaryPassword: " temporary-password ",
      confirmationPassword: " current-password "
    });
  });

  it.each([
    [{ phone: "12800000001" }, "手机号格式不正确"],
    [{ departmentId: "" }, "请选择启用部门"],
    [{ initialRoleKey: "" }, "请选择初始岗位"],
    [{ projectId: "" }, "项目岗位必须选择项目"],
    [{ temporaryPassword: "1234567" }, "临时密码至少需要 8 个字符"],
    [{ temporaryPassword: "        " }, "临时密码不能全为空白字符"],
    [{ confirmationPassword: "   " }, "请输入当前登录密码"],
    [{ passwordRecorded: false }, "请先通过线下安全渠道记录临时密码"]
  ])("rejects unsafe create input %#", (override, message) => {
    expect(() =>
      buildOrganizationUserCreatePayload({
        phone: "13800000001",
        departmentId: "department-1",
        initialRoleKey: "contract_staff",
        projectId: "project-1",
        temporaryPassword: "temporary-password",
        confirmationPassword: "current-password",
        passwordRecorded: true,
        ...(override as Partial<OrganizationUserCreationForm>)
      })
    ).toThrow(message);
  });

  it("returns a fresh form with no retained secrets", () => {
    expect(emptyOrganizationUserCreationForm()).toEqual({
      phone: "",
      departmentId: "",
      initialRoleKey: "",
      projectId: "",
      temporaryPassword: "",
      confirmationPassword: "",
      passwordRecorded: false
    });
  });
});

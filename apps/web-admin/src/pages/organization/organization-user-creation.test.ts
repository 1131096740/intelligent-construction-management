import { describe, expect, it } from "vitest";
import {
  buildOrganizationUserCreatePayload,
  emptyOrganizationUserCreationForm,
  type OrganizationUserCreationForm
} from "./organization-user-creation";

describe("organization user creation", () => {
  it("keeps a finance initial assignment within the explicitly selected project", () => {
    expect(buildOrganizationUserCreatePayload({
      phone: "13900000001", departmentId: "department-1", initialRoleKey: "finance_staff",
      initialRoleScope: "project", projectId: "project-1", confirmationPassword: "Synthetic-Current-01", passwordRecorded: true
    } as OrganizationUserCreationForm)).toEqual({
      phone: "13900000001", departmentId: "department-1", initialRoleKey: "finance_staff",
      initialRoleScope: "project", projectId: "project-1", confirmationPassword: "Synthetic-Current-01"
    });
  });
  it("builds the company-wide contract staff payload without a project or initial password", () => {
    expect(
      buildOrganizationUserCreatePayload({
        phone: " 13800000001 ",
        departmentId: " department-1 ",
        initialRoleKey: "contract_staff",
        initialRoleScope: "global",
        projectId: "",
        confirmationPassword: " current-password ",
        passwordRecorded: true
      })
    ).toEqual({
      phone: "13800000001",
      departmentId: "department-1",
      initialRoleKey: "contract_staff",
      initialRoleScope: "global",
      confirmationPassword: " current-password "
    });
  });

  it.each([
    [{ phone: "12800000001" }, "手机号格式不正确"],
    [{ departmentId: "" }, "请选择启用部门"],
    [{ initialRoleKey: "" }, "请选择初始岗位"],
    [{ projectId: "project-1" }, "全局岗位不需要安排项目"],
    [{ confirmationPassword: "   " }, "请输入当前登录密码"],
    [{ passwordRecorded: false }, "请先确认已通过线下安全渠道告知公司统一初始密码"]
  ])("rejects unsafe create input %#", (override, message) => {
    expect(() =>
      buildOrganizationUserCreatePayload({
        phone: "13800000001",
        departmentId: "department-1",
        initialRoleKey: "contract_staff",
        initialRoleScope: "global",
        projectId: "",
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
      initialRoleScope: "",
      projectId: "",
      confirmationPassword: "",
      passwordRecorded: false
    });
  });
});

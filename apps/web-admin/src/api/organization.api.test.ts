import { ROLE_KEYS } from "@jiangkong/shared-domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOrganizationRoleAddition,
  applyOrganizationRoleRemoval,
  createOrganizationDepartment,
  fetchOrganizationDirectory,
  fetchPermissionIntegrity,
  ORGANIZATION_ROLE_KEYS,
  OrganizationApiError,
  previewOrganizationRoleAddition,
  previewOrganizationRoleRemoval,
  updateOrganizationDepartment,
  updateOrganizationUser
} from "./organization.api";

vi.mock("./api-fetch", () => ({
  apiFetch: vi.fn()
}));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  );
}

describe("organization API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the browser-safe organization role list aligned with the shared domain", () => {
    expect(ORGANIZATION_ROLE_KEYS).toEqual(ROLE_KEYS);
  });

  it("reads the organization directory", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ departments: [], users: [], positions: [] }));

    await fetchOrganizationDirectory();

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/directory", { method: "GET" });
  });

  it("reads permission integrity through the read-only endpoint", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ issues: [] }));

    await fetchPermissionIntegrity();

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/permission-integrity", {
      method: "GET"
    });
  });

  it("uses a Chinese fallback when permission integrity cannot be read", async () => {
    mockApiFetch.mockReturnValue(Promise.resolve(new Response("upstream unavailable", { status: 502 })));

    await expect(fetchPermissionIntegrity()).rejects.toThrow("读取权限完整性预检失败：502");
  });

  it("previews one role removal without sending password, hash or unknown fields", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ snapshotHash: "sha256:abc", canApply: false }));

    await previewOrganizationRoleRemoval({
      operation: "remove",
      userId: "user-1",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager",
      confirmationPassword: "must-not-be-sent",
      snapshotHash: "must-not-be-sent"
    } as never);

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/role-changes/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "remove",
        userId: "user-1",
        scope: "project",
        projectId: "project-1",
        roleKey: "project_manager"
      })
    });
  });

  it("applies one role removal with the server hash and password preserved exactly", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ assignmentId: "assignment-1" }));
    const snapshotHash = `sha256:${"a".repeat(64)}`;

    await applyOrganizationRoleRemoval({
      operation: "remove",
      userId: "user-1",
      scope: "global",
      roleKey: "finance_director",
      snapshotHash,
      confirmationPassword: "  current password  ",
      assignmentId: "must-not-be-sent"
    } as never);

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/role-changes/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "remove",
        userId: "user-1",
        scope: "global",
        roleKey: "finance_director",
        snapshotHash,
        confirmationPassword: "  current password  "
      })
    });
  });

  it("fails closed instead of silently correcting role scope project identifiers", () => {
    expect(() =>
      previewOrganizationRoleRemoval({
        operation: "remove",
        userId: "user-1",
        scope: "global",
        projectId: "project-1",
        roleKey: "finance_director"
      })
    ).toThrow("全局岗位不得提交项目标识");
    expect(() =>
      previewOrganizationRoleRemoval({
        operation: "remove",
        userId: "user-1",
        scope: "project",
        roleKey: "project_manager"
      })
    ).toThrow("项目岗位缺少项目标识");
    expect(() =>
      applyOrganizationRoleRemoval({
        operation: "remove",
        userId: "user-1",
        scope: "project",
        projectId: "   ",
        roleKey: "project_manager",
        snapshotHash: `sha256:${"c".repeat(64)}`,
        confirmationPassword: "secret"
      })
    ).toThrow("项目岗位缺少项目标识");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("fails closed before fetch for unsupported role operations and scopes", () => {
    expect(() =>
      previewOrganizationRoleRemoval({
        operation: "add",
        userId: "user-1",
        scope: "global",
        roleKey: "finance_director"
      } as never)
    ).toThrow("岗位变更操作不正确");
    expect(() =>
      applyOrganizationRoleRemoval({
        operation: "remove",
        userId: "user-1",
        scope: "tenant",
        roleKey: "finance_director",
        snapshotHash: `sha256:${"d".repeat(64)}`,
        confirmationPassword: "secret"
      } as never)
    ).toThrow("岗位范围不正确");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("preserves the HTTP status on organization API errors", async () => {
    mockApiFetch.mockReturnValue(
      jsonResponse({ message: "组织或审批数据已变化，请重新预览后再试" }, 409)
    );

    const error = await applyOrganizationRoleRemoval({
      operation: "remove",
      userId: "user-1",
      scope: "global",
      roleKey: "finance_director",
      snapshotHash: `sha256:${"b".repeat(64)}`,
      confirmationPassword: "secret"
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrganizationApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "组织或审批数据已变化，请重新预览后再试"
    });
  });

  it("previews one role addition without sending password, hash or unknown fields", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ snapshotHash: "sha256:abc", canApply: false }));

    await previewOrganizationRoleAddition({
      operation: "add",
      userId: "user-1",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager",
      confirmationPassword: "must-not-be-sent",
      snapshotHash: "must-not-be-sent",
      assignmentId: "must-not-be-sent"
    } as never);

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/role-additions/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "add",
        userId: "user-1",
        scope: "project",
        projectId: "project-1",
        roleKey: "project_manager"
      })
    });
  });

  it("applies one role addition with the server hash and password preserved exactly", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ assignmentId: "assignment-1" }));
    const snapshotHash = `sha256:${"e".repeat(64)}`;

    await applyOrganizationRoleAddition({
      operation: "add",
      userId: "user-1",
      scope: "global",
      roleKey: "finance_director",
      snapshotHash,
      confirmationPassword: "  current password  ",
      assignmentId: "must-not-be-sent"
    } as never);

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/role-additions/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "add",
        userId: "user-1",
        scope: "global",
        roleKey: "finance_director",
        snapshotHash,
        confirmationPassword: "  current password  "
      })
    });
  });

  it("fails closed for unsupported addition operations, scopes and project super-admin", () => {
    expect(() =>
      previewOrganizationRoleAddition({
        operation: "remove",
        userId: "user-1",
        scope: "global",
        roleKey: "finance_director"
      } as never)
    ).toThrow("岗位变更操作不正确");
    expect(() =>
      previewOrganizationRoleAddition({
        operation: "add",
        userId: "user-1",
        scope: "tenant",
        roleKey: "finance_director"
      } as never)
    ).toThrow("岗位范围不正确");
    expect(() =>
      previewOrganizationRoleAddition({
        operation: "add",
        userId: "user-1",
        scope: "global",
        projectId: "project-1",
        roleKey: "finance_director"
      })
    ).toThrow("全局岗位不得提交项目标识");
    expect(() =>
      applyOrganizationRoleAddition({
        operation: "add",
        userId: "user-1",
        scope: "project",
        projectId: "project-1",
        roleKey: "super_admin",
        snapshotHash: `sha256:${"f".repeat(64)}`,
        confirmationPassword: "secret"
      })
    ).toThrow("项目岗位不得新增系统管理员");
    expect(() =>
      previewOrganizationRoleAddition({
        operation: "add",
        userId: "user-1",
        scope: "global",
        roleKey: "root"
      } as never)
    ).toThrow("岗位键不正确");
    expect(() =>
      previewOrganizationRoleAddition({
        operation: "add",
        userId: "user-1",
        scope: "global",
        roleKey: ""
      } as never)
    ).toThrow("岗位键不正确");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("creates a department with only the allowed fields and preserves the password", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ id: "department-1" }));

    const payload = {
      name: "合同部",
      parentId: null,
      confirmationPassword: "  current password  ",
      unexpected: "must-not-be-sent"
    };

    await createOrganizationDepartment(payload);

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "合同部",
        parentId: null,
        confirmationPassword: "  current password  "
      })
    });
  });

  it("updates a department through an encoded path and sends the minimal patch", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ id: "部门/1" }));

    await updateOrganizationDepartment("部门/1", {
      isActive: false,
      confirmationPassword: "secret"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/departments/%E9%83%A8%E9%97%A8%2F1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false, confirmationPassword: "secret" })
    });
  });

  it("updates a user through an encoded path and preserves an explicit null department", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ id: "user/1" }));

    await updateOrganizationUser("user/1", {
      departmentId: null,
      confirmationPassword: "secret"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/organization/users/user%2F1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId: null, confirmationPassword: "secret" })
    });
  });

  it("surfaces the backend Chinese business error", async () => {
    mockApiFetch.mockReturnValue(jsonResponse({ message: ["该部门仍有启用人员，不能停用"] }, 400));

    await expect(
      updateOrganizationDepartment("department-1", {
        isActive: false,
        confirmationPassword: "secret"
      })
    ).rejects.toThrow("该部门仍有启用人员，不能停用");
  });
});

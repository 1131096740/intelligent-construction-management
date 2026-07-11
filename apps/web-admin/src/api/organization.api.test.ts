import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrganizationDepartment,
  fetchOrganizationDirectory,
  fetchPermissionIntegrity,
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

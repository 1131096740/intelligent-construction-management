import { ForbiddenException } from "@nestjs/common";
import { OrganizationService } from "./organization.service";

function harness(role: string, active = true) {
  const prisma = {
    department: { findMany: jest.fn().mockResolvedValue([
      { id: "finance", name: "财务部", parentId: null, isActive: true },
      { id: "child", name: "财务下属", parentId: "finance", isActive: true },
      { id: "other", name: "工程部", parentId: null, isActive: true }
    ]) },
    user: { findMany: jest.fn().mockResolvedValue([
      { id: "actor", name: "主管", phone: "13800000001", departmentId: "finance", isActive: active },
      { id: "staff", name: "同事", phone: "13800000002", departmentId: "child", isActive: false },
      { id: "outside", name: "其他部门", phone: "13800000003", departmentId: "other", isActive: true }
    ]) },
    position: { findMany: jest.fn().mockResolvedValue([{ id: "role", key: role, name: "管理岗位" }]) },
    userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "actor", positionId: "role", projectId: null }]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    projectRosterMember: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([]) }
  };
  return new OrganizationService(prisma as never, {} as never, {} as never);
}

describe("组织管理可操作范围", () => {
  it("董事长能管理部门和其他人员，包括重新启用停用人员", async () => {
    const result = await harness("chairman").getManagementCapabilities("actor");
    expect(result.canManageDepartments).toBe(true);
    expect(result.canCreateUser).toBe(true);
    expect(result.manageableUserIds.sort()).toEqual(["outside", "staff"]);
    expect(result.manageableRoleKeys).toContain("engineering_department_director");
    expect(result.manageableRoleKeys).not.toContain("super_admin");
  });

  it("财务主管不再管理人员账号与岗位，由董事长统一审核财务人员", async () => {
    const result = await harness("finance_director").getManagementCapabilities("actor");
    expect(result.canManageDepartments).toBe(false);
    expect(result.manageableDepartmentIds.sort()).toEqual(["child", "finance"]);
    expect(result.manageableUserIds).toEqual([]);
    expect(result.manageableRoleKeys).toEqual([]);
    expect(result.canManageUsers).toBe(false);
    expect(result.canReviewApplications).toBe(false);
  });

  it("停用管理者和普通员工不能读取管理能力", async () => {
    await expect(harness("chairman", false).getManagementCapabilities("actor")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(harness("employee").getManagementCapabilities("actor")).rejects.toBeInstanceOf(ForbiddenException);
  });
});

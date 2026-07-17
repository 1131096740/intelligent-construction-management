import { ForbiddenException } from "@nestjs/common";
import {
  COMPANY_ENTITY_MAINTAINER_ROLES,
  COMPANY_ENTITY_READER_ROLES,
  CompanyEntityAccess
} from "./company-entity-access";

type AccessFixture = {
  assignmentIds?: string[];
  roleKeys?: string[];
};

function buildClient({
  assignmentIds = ["position-1"],
  roleKeys = []
}: AccessFixture = {}) {
  return {
    userPosition: {
      findMany: jest.fn().mockResolvedValue(
        assignmentIds.map((positionId) => ({ positionId }))
      )
    },
    position: {
      findMany: jest.fn().mockResolvedValue(
        assignmentIds.map((id, index) => ({
          id,
          key: roleKeys[index]
        }))
      )
    }
  };
}

describe("CompanyEntityAccess", () => {
  it.each(COMPANY_ENTITY_MAINTAINER_ROLES)(
    "allows company-level maintainer role %s",
    async (roleKey) => {
      const prisma = buildClient({ roleKeys: [roleKey] });
      const access = new CompanyEntityAccess(prisma as never);

      await expect(access.assertCanMaintain("maintainer-1")).resolves.toBe(roleKey);
      expect(prisma.userPosition.findMany).toHaveBeenCalledWith({
        where: { userId: "maintainer-1", projectId: null },
        select: { positionId: true }
      });
      expect(prisma.position.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["position-1"] } },
        select: { key: true }
      });
    }
  );

  it.each(COMPANY_ENTITY_READER_ROLES)(
    "allows company-level reader role %s",
    async (roleKey) => {
      const prisma = buildClient({ roleKeys: [roleKey] });
      const access = new CompanyEntityAccess(prisma as never);

      await expect(access.assertCanRead("reader-1")).resolves.toBe(roleKey);
    }
  );

  it("rejects a project-scoped role with the same key", async () => {
    const prisma = buildClient({ assignmentIds: [], roleKeys: ["contract_staff"] });
    const access = new CompanyEntityAccess(prisma as never);

    await expect(access.assertCanMaintain("project-contract-user")).rejects.toThrow(
      "公司级全局岗位"
    );
    expect(prisma.userPosition.findMany).toHaveBeenCalledWith({
      where: { userId: "project-contract-user", projectId: null },
      select: { positionId: true }
    });
  });

  it.each(["super_admin", "budget_director", "project_manager"])(
    "rejects unrelated company-level role %s",
    async (roleKey) => {
      const access = new CompanyEntityAccess(
        buildClient({ roleKeys: [roleKey] }) as never
      );

      await expect(access.assertCanMaintain("unrelated-user")).rejects.toBeInstanceOf(
        ForbiddenException
      );
      await expect(access.assertCanRead("unrelated-user")).rejects.toThrow(
        "公司级全局岗位"
      );
    }
  );

  it("rejects a user without a company-level position", async () => {
    const access = new CompanyEntityAccess(
      buildClient({ assignmentIds: [], roleKeys: [] }) as never
    );

    await expect(access.assertCanMaintain("no-role-user")).rejects.toThrow(
      "当前账号没有公司级全局岗位，不能维护我方公司主体"
    );
    await expect(access.assertCanRead("no-role-user")).rejects.toThrow(
      "当前账号没有公司级全局岗位，不能查看我方公司主体管理信息"
    );
  });

  it("selects the matching role by the shared policy order", async () => {
    const prisma = buildClient({
      assignmentIds: ["position-1", "position-2", "position-3"],
      roleKeys: ["chairman", "contract_director", "contract_staff"]
    });
    const access = new CompanyEntityAccess(prisma as never);

    await expect(access.assertCanMaintain("multi-role-user")).resolves.toBe(
      "contract_staff"
    );
    await expect(access.assertCanRead("multi-role-user")).resolves.toBe(
      "contract_staff"
    );
  });

  it("uses the supplied transaction client for an in-transaction recheck", async () => {
    const prisma = buildClient({ assignmentIds: [], roleKeys: [] });
    const tx = buildClient({ roleKeys: ["contract_director"] });
    const access = new CompanyEntityAccess(prisma as never);

    await expect(access.assertCanMaintain("contract-user", tx as never)).resolves.toBe(
      "contract_director"
    );
    expect(tx.userPosition.findMany).toHaveBeenCalled();
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });
});

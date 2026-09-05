import { CompanyRoleResolverService, COMPANY_ROLE_RESOLUTION_ERROR } from "./company-role-resolver.service";
import type { PrismaService } from "../database/prisma.service";

describe("CompanyRoleResolverService", () => {
  it("can resolve roles entirely through the caller transaction client", async () => {
    const rootPrisma = {
      user: { findUnique: jest.fn(() => { throw new Error("root client must not be used"); }) }
    } as unknown as PrismaService;
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-finance" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "position-finance", key: "finance_director" }]) }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(rootPrisma);

    await expect(resolver.resolveActiveRoleScopesInTransaction(tx, "finance-user")).resolves.toEqual([
      "finance_director"
    ]);
    expect(rootPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: "finance-user" },
      select: { isActive: true }
    });
  });

  it("rejects a missing user instead of returning active company roles", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      userPosition: { findMany: jest.fn() }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("missing-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
  });

  it("rejects an inactive user before reading position rows", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: false }) },
      userPosition: { findMany: jest.fn() }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("inactive-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when the user query fails", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockRejectedValue(new Error("database unavailable")) },
      userPosition: { findMany: jest.fn() }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("query-error-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });

  it("reads company assignments with a null project scope and returns stable unique keys", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { positionId: "position-b" },
      { positionId: "position-a" },
      { positionId: "position-b" }
    ]);
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-b", key: "contract_staff" },
          { id: "position-a", key: "chairman" }
        ])
      }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("company-user")).resolves.toEqual([
      "chairman",
      "contract_staff"
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "company-user", projectId: null },
      select: { positionId: true }
    });
  });

  it("fails closed when the position query fails", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }])
      },
      position: {
        findMany: jest.fn().mockRejectedValue(new Error("database unavailable"))
      }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("position-query-error-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
  });

  it("fails closed when an assignment points to a missing position", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([
          { positionId: "position-present" },
          { positionId: "position-orphan" }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-present", key: "contract_staff" }
        ])
      }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("orphan-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
  });

  it("fails closed when no assignment exists for the requested scope", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn() }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("empty-scope-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
    expect(prisma.position.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when a position key is not a supported role", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-unknown" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-unknown", key: "unknown_role" }
        ])
      }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("unknown-role-user")).rejects.toThrow(
      COMPANY_ROLE_RESOLUTION_ERROR
    );
  });

  it("keeps company and exact-project scopes independent", async () => {
    const findMany = jest.fn().mockImplementation(
      async ({ where }: { where: { projectId: string | null } }) =>
        where.projectId === null
          ? [{ positionId: "company-position" }]
          : where.projectId === "project-1"
            ? [{ positionId: "project-position" }]
            : []
    );
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany },
      position: {
        findMany: jest.fn().mockImplementation(
          async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.includes("company-position")
              ? [{ id: "company-position", key: "contract_staff" }]
              : [{ id: "project-position", key: "project_manager" }]
        )
      }
    } as unknown as PrismaService;
    const resolver = new CompanyRoleResolverService(prisma);

    await expect(resolver.resolveActiveRoleScopes("scoped-user")).resolves.toEqual([
      "contract_staff"
    ]);
    await expect(
      resolver.resolveActiveRoleScopes("scoped-user", "project-1")
    ).resolves.toEqual(["project_manager"]);
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { userId: "scoped-user", projectId: null },
      select: { positionId: true }
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: "scoped-user", projectId: "project-1" },
      select: { positionId: true }
    });
  });
});

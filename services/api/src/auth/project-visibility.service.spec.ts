import { ProjectVisibilityService } from "./project-visibility.service";

describe("ProjectVisibilityService", () => {
  it("limits project-only users to their active project memberships", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ projectId: "project-1", positionId: "pos-finance" }])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-2" }])
      },
      projectRosterMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }, { id: "project-3" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "pos-finance", key: "finance_staff" }])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.visibleProjectIds("user-1")).resolves.toEqual(["project-1", "project-2"]);
  });

  it("allows global business roles to see all active projects", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-chairman" }])
          .mockResolvedValueOnce([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectRosterMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "pos-chairman", key: "chairman" }])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.visibleProjectIds("user-1")).resolves.toEqual(["project-1", "project-2"]);
  });

  it("does not expand visibility for project-only roles stored globally", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-engineering-member" }])
          .mockResolvedValueOnce([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1" }])
      },
      projectRosterMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "pos-engineering-member", key: "engineering_department_member" }
        ])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.visibleProjectIds("user-1")).resolves.toEqual(["project-1"]);
  });

  it("grants project visibility through roster assignment without requiring a project position", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectRosterMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-2" }])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.visibleProjectIds("user-1")).resolves.toEqual(["project-2"]);
  });

  it("returns effective role keys for one project", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-employee" }])
          .mockResolvedValueOnce([{ projectId: "project-1", positionId: "pos-finance" }])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "contract_staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "pos-employee", key: "employee" },
          { id: "pos-finance", key: "finance_staff" }
        ])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.effectiveRoleKeys("user-1", "project-1")).resolves.toEqual([
      "finance_staff",
      "contract_staff"
    ]);
    expect((prisma as Record<string, unknown>)["projectRosterMember"]).toBeUndefined();
  });
});

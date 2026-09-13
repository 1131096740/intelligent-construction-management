import {
  ProjectVisibilityBudgetExceededError,
  ProjectVisibilityService
} from "./project-visibility.service";

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

  it("pages active project metadata instead of materializing an unbounded database result", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      id: `project-${String(index).padStart(4, "0")}`
    }));
    const finalPage = [{ id: "project-1000" }];
    const projectFindMany = jest.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage);
    const prisma = {
      userPosition: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-chairman" }])
          .mockResolvedValueOnce([])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      projectRosterMember: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: projectFindMany },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "pos-chairman", key: "chairman" }
        ])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.visibleProjectIds("user-1")).resolves.toHaveLength(1_001);
    expect(projectFindMany).toHaveBeenCalledTimes(2);
    expect(projectFindMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      cursor: { id: firstPage.at(-1)!.id },
      skip: 1,
      take: 1_000
    }));
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

  it("does not expand all-project visibility for company-wide contract staff", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-contract-staff" }])
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
          { id: "pos-contract-staff", key: "contract_staff" }
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

  it("checks an explicit project set without enumerating every active project", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-employee" }])
          .mockResolvedValueOnce([{ projectId: "project-1", positionId: "pos-finance" }])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      projectRosterMember: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([
        { id: "pos-employee", key: "employee" },
        { id: "pos-finance", key: "finance_staff" }
      ]) }
    };
    const service = new ProjectVisibilityService({} as never);

    await expect(service.visibleRequestedProjectIdsInTransaction(
      tx as never,
      "user-1",
      ["project-1"]
    )).resolves.toEqual(["project-1"]);
    expect(tx.project.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["project-1"] }, isActive: true },
      select: { id: true }
    });
  });

  it("stops global visibility enumeration at the configured project budget", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-chairman" }])
          .mockResolvedValueOnce([])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      projectRosterMember: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 201 }, (_, index) => ({ id: `project-${index}` }))
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([
        { id: "pos-chairman", key: "chairman" }
      ]) }
    };
    const service = new ProjectVisibilityService({} as never);

    await expect(service.visibleProjectIdsWithinBudgetInTransaction(
      tx as never,
      "user-1",
      200
    )).rejects.toBeInstanceOf(ProjectVisibilityBudgetExceededError);
    expect(tx.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 201 }));
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

  it("batch-resolves effective roles without one role query per project", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-employee" }])
          .mockResolvedValueOnce([
            { projectId: "project-1", positionId: "pos-contract" },
            { projectId: "project-2", positionId: "pos-budget" }
          ])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-2", positionKey: "finance_staff" }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "pos-employee", key: "employee" },
          { id: "pos-contract", key: "contract_staff" },
          { id: "pos-budget", key: "budget_staff" }
        ])
      }
    };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(
      service.effectiveRoleKeysByProject("user-1", ["project-1", "project-2"])
    ).resolves.toEqual(new Map([
      ["project-1", ["contract_staff"]],
      ["project-2", ["budget_staff", "finance_staff"]]
    ]));
    expect(prisma.userPosition.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.projectMember.findMany).toHaveBeenCalledTimes(1);
  });

  it("uses the supplied snapshot client without changing effective-role semantics", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ projectId: null, positionId: "pos-employee" }])
          .mockResolvedValueOnce([{ projectId: "project-1", positionId: "pos-finance" }])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "pos-employee", key: "employee" },
          { id: "pos-finance", key: "finance_director" }
        ])
      }
    };
    const prisma = { userPosition: { findMany: jest.fn() } };
    const service = new ProjectVisibilityService(prisma as never);

    await expect(service.effectiveRoleKeysByProjectInTransaction(
      tx as never,
      "user-1",
      ["project-1"]
    )).resolves.toEqual(new Map([
      ["project-1", ["finance_director"]]
    ]));
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });
});

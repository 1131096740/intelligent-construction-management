import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";

describe("resolveGovernedFinalArchiveAccess", () => {
  const directorPosition = { id: "position-contract-director" };

  function client(options: {
    globalDirector?: boolean;
    projectContractStaff?: boolean;
    active?: boolean;
  }) {
    return {
      position: { findUnique: jest.fn().mockResolvedValue(directorPosition) },
      userPosition: {
        findFirst: jest.fn().mockResolvedValue(
          options.globalDirector ? { id: "global-director-role" } : null
        )
      },
      projectMember: {
        findFirst: jest.fn().mockResolvedValue(
          options.projectContractStaff ? { id: "project-contract-staff" } : null
        )
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ isActive: options.active ?? true })
      }
    };
  }

  it.each([
    ["current global director handler", { globalDirector: true }, {
      canUpload: true, canConfirm: true, canSelfConfirm: true, actingRoleKey: "contract_director"
    }],
    ["current contract staff handler", { projectContractStaff: true }, {
      canUpload: true, canConfirm: false, canSelfConfirm: false, actingRoleKey: "contract_staff"
    }],
    ["project-scoped director handler", {}, {
      canUpload: false, canConfirm: false, canSelfConfirm: false, actingRoleKey: null
    }],
    ["inactive global director handler", { globalDirector: true, active: false }, {
      canUpload: false, canConfirm: false, canSelfConfirm: false, actingRoleKey: null
    }]
  ])("allows final archive capability only for %s", async (
    _label,
    options,
    expected
  ) => {
    await expect(resolveGovernedFinalArchiveAccess(client(options) as never, {
      actorUserId: "handler-1",
      projectId: "project-1",
      handlerUserId: "handler-1",
      uploadedByUserId: "handler-1"
    })).resolves.toEqual(expected);
  });

  it("recognizes the same handler after a project-to-global contract-director transfer", async () => {
    const globalAssignments = new Set<string>();
    const accessClient = client({});
    accessClient.userPosition.findFirst.mockImplementation(({ where }: {
      where: { userId: string; projectId: null; positionId: string };
    }) => Promise.resolve(globalAssignments.has(where.userId) ? { id: "global-director-role" } : null));

    await expect(resolveGovernedFinalArchiveAccess(accessClient as never, {
      actorUserId: "handler-1",
      projectId: "project-1",
      handlerUserId: "handler-1",
      uploadedByUserId: "handler-1"
    })).resolves.toMatchObject({ canUpload: false, canConfirm: false, canSelfConfirm: false });

    globalAssignments.add("handler-1");

    await expect(resolveGovernedFinalArchiveAccess(accessClient as never, {
      actorUserId: "handler-1",
      projectId: "project-1",
      handlerUserId: "handler-1",
      uploadedByUserId: "handler-1"
    })).resolves.toMatchObject({
      canUpload: true,
      canConfirm: true,
      canSelfConfirm: true,
      actingRoleKey: "contract_director"
    });
  });
});

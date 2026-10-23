import { EmployeeOnboardingService } from "./employee-onboarding.service";
import type { EmployeeRoleDto } from "./dto/employee-registration.dto";

jest.mock("../approval/independent-approval-evidence", () => ({ recordIndependentApproval: jest.fn() }));

function harness(actorRole = "chairman", existingDirector = false) {
  const assignments: Array<{ userId: string; positionId: string; projectId: string | null }> = [
    { userId: "actor", positionId: `position-${actorRole}`, projectId: null }
  ];
  if (existingDirector) assignments.push({ userId: "existing-director",
    positionId: "position-engineering_department_director", projectId: null });
  const members: Array<{ userId: string; projectId: string; positionKey: string }> = [];
  const applications = { id: "application", name: "合成申请人", phone: "13910009901", passwordHash: "hash",
    status: "pending", revision: 1, mustChangePassword: false, credentialVersion: 0 };
  const tx = {
    personnelChange: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "personnel-fact" }) },
    employmentPeriod: { create: jest.fn().mockResolvedValue({ id: "employment" }) },
    $queryRaw: jest.fn().mockResolvedValue([]), $executeRaw: jest.fn().mockResolvedValue(0),
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => where.id === "actor" ? { id: "actor", isActive: true } : null),
      findFirst: jest.fn(async () => existingDirector ? { id: "existing-director" } : null),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: "new-user", ...data }))
    },
    userPosition: {
      findMany: jest.fn(async () => assignments),
      create: jest.fn(async ({ data }: { data: typeof assignments[number] }) => { assignments.push(data); return data; })
    },
    position: {
      findMany: jest.fn(async () => [{ id: `position-${actorRole}`, key: actorRole }]),
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => ({ id: `position-${where.key}`, key: where.key })),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { key: string } }) => ({ id: `position-${where.key}`, key: where.key }))
    },
    department: { findFirst: jest.fn().mockResolvedValue({ id: "department", isActive: true }) },
    project: { findFirst: jest.fn().mockResolvedValue({ id: "project", isActive: true }) },
    projectMember: { create: jest.fn(async ({ data }: { data: typeof members[number] }) => { members.push(data); return data; }) },
    projectRosterMember: { upsert: jest.fn().mockResolvedValue({}) },
    employeeRegistration: {
      findUnique: jest.fn().mockResolvedValue(applications),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...applications, ...data }))
    }
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const service = new EmployeeOnboardingService(prisma as never,
    { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) } as never, {} as never,
    { record: jest.fn() } as never, {} as never);
  const review = (roles: EmployeeRoleDto[]) => service.review("application", "actor", {
    revision: 1, decision: "approve", departmentId: "department", roles,
    identityVerified: true, confirmationPassword: "confirmation"
  });
  return { review, tx, assignments, members };
}

describe("员工批准的岗位安排公开服务", () => {
  it.each(["contract_staff", "finance_staff"] as const)("批准 %s 的明确项目范围，不生成公司岗位", async roleKey => {
    const { review, assignments, members } = harness();
    await expect(review([{ roleKey, scope: "project", projectId: "project" }])).resolves.toMatchObject({ status: "approved" });
    expect(members).toEqual([{ userId: "new-user", projectId: "project", positionKey: roleKey }]);
    expect(assignments.filter(row => row.userId === "new-user")).toEqual([]);
  });

  it("批准部长前已有启用部长时拒绝，不能经入职绕过唯一性", async () => {
    const { review, tx } = harness("chairman", true);
    await expect(review([{ roleKey: "engineering_department_director" }])).rejects.toThrow("已有启用的公司工程技术部主管");
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});

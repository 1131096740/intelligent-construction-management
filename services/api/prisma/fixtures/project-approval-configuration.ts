import type { Prisma } from "@prisma/client";

export function mockConfiguredApprovalAssignments(tx: { $queryRaw: jest.Mock }) {
  const original = tx.$queryRaw;
  tx.$queryRaw = jest.fn((query: Prisma.Sql) => {
    if (query.sql.includes("WITH members AS MATERIALIZED")) {
      return Promise.resolve([{ projectId: "project-1", userId: "manager-1", roleKey: "project_manager", userIsActive: true }]);
    }
    if (query.sql.includes('SELECT p."key" AS "roleKey" FROM "UserPosition" up')) {
      return Promise.resolve(["comprehensive_director", "material_director", "finance_director", "chairman"].map((roleKey) => ({ roleKey })));
    }
    return original(query);
  });
}

import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";
import { PermissionGuard } from "../auth/guards/permission.guard";

it("审计读取岗位不等于业务审批：财务主管可读，普通人员与总经理无审计授权", async () => {
  let role = "finance_director";
  const db = {
    userPosition: { findMany: async () => [{ positionId: "position" }] },
    projectMember: { findMany: async () => [] },
    position: { findMany: async () => [{ id: "position", key: role }] },
    auditLog: { findMany: async () => [] }
  };
  const module = await Test.createTestingModule({ controllers: [AuditController], providers: [{ provide: AuditService, useValue: new AuditService(db as never) }] }).compile();
  const app = module.createNestApplication();
  app.use((req: { user: unknown }, _res: unknown, next: () => void) => { req.user = { id: "reader" }; next(); });
  app.useGlobalGuards(new PermissionGuard(new Reflector(), db as never));
  await app.listen(0, "127.0.0.1");
  try {
    for (const [key, expected] of [["finance_director", 200], ["employee", 403], ["general_manager", 403], ["chairman", 200], ["super_admin", 200]] as const) {
      role = key;
      expect((await fetch(`${await app.getUrl()}/audit-logs`)).status).toBe(expected);
    }
  } finally { await app.close(); }
});

import { Test } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { PaymentRequestService } from "../payment/payment-request.service";
import { FileService } from "../file/file.service";
import { Task16RevocationApplicationModule } from "./task16-revocation-application.module";

it("mounts the real project list in the revocation app and reflects scoped membership changes", async () => {
  const actor = { id: "synthetic-manager", name: "合成经理", phone: null, isActive: true, mustChangePassword: false, sessionVersion: 0 };
  const projects = [{ id: "project-a", code: "A", name: "目标项目" }, { id: "project-b", code: "B", name: "其他项目" }];
  let memberIds = ["project-a", "project-b"];
  const prisma = {
    user: { findUnique: async () => actor },
    userPosition: { findMany: async () => [] },
    position: { findMany: async () => [] },
    projectMember: { findMany: async () => memberIds.map((projectId) => ({ userId: actor.id, projectId, positionKey: "project_manager" })) },
    projectRosterMember: { groupBy: async () => [] },
    project: { findMany: async (input: { where?: { id?: { in?: string[] } } }) => projects.filter((p) => !input.where?.id?.in || input.where.id.in.includes(p.id)) }
  };
  const module = await Test.createTestingModule({ imports: [Task16RevocationApplicationModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
  const app = module.createNestApplication({ logger: false });
  // The production runner owns the fixed CommonJS ingress fence.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fence = require("../../prisma/run-task16-native-competition-follow-up-once.cjs") as { nativeTask16RevocationInboundAllowed(method: string, url: string, ids: object): boolean };
  const ids = { file: "00000000-0000-4000-8000-000000000001", execution: "00000000-0000-4000-8000-000000000002" };
  app.use((req: { method: string; originalUrl: string }, res: { status(code: number): { end(): void } }, next: () => void) => {
    if (!fence.nativeTask16RevocationInboundAllowed(req.method, req.originalUrl, ids)) return res.status(404).end();
    return next();
  });
  try {
    await app.listen(0, "127.0.0.1");
    const payment = app.get(PaymentRequestService) as unknown as { prisma: unknown; files: unknown };
    const files = app.get(FileService) as unknown as { prisma: unknown };
    expect(payment.prisma).toBe(prisma); expect(payment.files).toBe(files); expect(files.prisma).toBe(prisma);
    const token = app.get(JwtTokenService).signAccessToken(actor);
    const url = await app.getUrl();
    const get = () => fetch(`${url}/projects`, { headers: { authorization: `Bearer ${token}` } });
    expect((await fetch(`${url}/projects`)).status).toBe(401);
    expect((await fetch(`${url}/projects/management`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await fetch(`${url}/payment-executions/${ids.execution}/registrations`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    const before = await get(); expect(before.status).toBe(200); expect((await before.json()).map((p: { id: string }) => p.id)).toEqual(["project-a", "project-b"]);
    memberIds = ["project-b"];
    const after = await get(); expect(after.status).toBe(200); expect((await after.json()).map((p: { id: string }) => p.id)).toEqual(["project-b"]);
  } finally { await app.close(); }
});

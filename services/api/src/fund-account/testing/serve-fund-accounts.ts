import { MeController } from "../../me/me.controller";
import { MeService } from "../../me/me.service";
import { FileService } from "../../file/file.service";
import { ApprovalDelegationController } from "../../approval/approval-delegation.controller";
import { ApprovalDelegationService } from "../../approval/approval-delegation.service";
import { AuditController } from "../../audit/audit.controller";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FundAccountController } from "../fund-account.controller";
import { FundAccountService } from "../fund-account.service";
import { createFundAccountSyntheticDb } from "./fund-account.synthetic-db";
import { PrismaService } from "../../database/prisma.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../../auth/guards/permission.guard";
import { RetiredWriteEntryGuard } from "../../retired-write-entry/retired-write-entry.guard";
import { JwtTokenService } from "../../auth/jwt-token.service";
import { AuthService } from "../../auth/auth.service";
import { AuditService } from "../../audit/audit.service";
import { createApiValidationPipe } from "../../validation/api-validation";

// Deliberately not imported by production modules. Synthetic identity and
// persistence only; no PrismaClient instance, PG resource or external gateway.
async function serve() {
  const database = createFundAccountSyntheticDb();
  const { prisma } = database;
  const module = await Test.createTestingModule({ controllers: [FundAccountController, ApprovalDelegationController, AuditController, MeController], providers: [MeService, { provide: FileService, useValue: {} }, ApprovalDelegationService,FundAccountService, AuthService, JwtTokenService, AuditService, { provide: PrismaService, useValue: prisma }] }).compile();
  const app = module.createNestApplication({ logger: false });
  const controlFile = process.env.FUND_ACCOUNT_SYNTHETIC_CONTROL_FILE;
  if (controlFile) app.use((_request: unknown, _response: unknown, next: () => void) => {
    if (existsSync(controlFile)) {
      const roles = JSON.parse(readFileSync(controlFile, "utf8")) as Record<string, string>;
      for (const [actor, role] of Object.entries(roles)) {
        if (!["director", "other_director"].includes(actor) || !["employee", "finance_director"].includes(role)) throw new Error("Unsupported synthetic role fact");
        database.setRole(actor, role);
      }
    }
    next();
  });
  const reflector = new Reflector();
  const tokens = app.get(JwtTokenService);
  let droppedDelegateResponse = false;
  if (process.env.FUND_ACCOUNT_SYNTHETIC_DROP_FIRST_DELEGATE_CONFIRM === "1") app.use((request: {headers:{authorization?:string};method?:string;path:string}, response: {send:(body?:unknown)=>unknown;statusCode:number;destroy:()=>unknown}, next:()=>void) => {
    const send = response.send.bind(response);
    response.send = (body?: unknown) => {
      let actor: string | undefined;
      try { actor = tokens.verifyAccessToken(String(request.headers.authorization ?? "").replace(/^Bearer /, "")).sub; } catch { /* Auth guard owns invalid identities. */ }
      if (!droppedDelegateResponse && actor === "delegate" && request.method === "POST" && /^\/fund-accounts\/registrations\/[^/]+\/confirm$/.test(request.path) && response.statusCode === 201) {
        droppedDelegateResponse = true;
        process.stdout.write("SYNTHETIC_DELEGATE_RESPONSE_DROPPED_AFTER_CONTROLLER_SUCCESS\n");
        response.destroy(); return response;
      }
      return send(body);
    };
    next();
  });
  app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, prisma as never), new RetiredWriteEntryGuard(), new PermissionGuard(reflector, prisma as never));
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(Number(process.env.FUND_ACCOUNT_SYNTHETIC_PORT ?? 0), "127.0.0.1");
  const sessions = Object.fromEntries([["keeper", "comprehensive_director"], ["finance", "finance_staff"], ["director", "finance_director"], ["delegate", "employee"], ["other_director", "finance_director"]].map(([id, role]) => [id, { accessToken: tokens.signAccessToken({ id, name: "合成验收人员", phone: null, sessionVersion: 0 }), refreshToken: "synthetic-unused", user: { id, name: "合成验收人员", phone: null, mustChangePassword: false, roleKeys: [role], globalRoleKeys: [role] } }]));
  writeFileSync(process.env.FUND_ACCOUNT_SYNTHETIC_RECEIPT ?? "/private/tmp/jg-task15-synthetic-server.json", JSON.stringify({ url: await app.getUrl(), pid: process.pid, sessions, controlFile: controlFile ?? null }));
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void app.close().then(() => process.exit(0)));
}
if (require.main === module) void serve();

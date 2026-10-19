import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { acceptContractChain } from "./company-transfer-contract-acceptance";
import { AppModule } from "../app.module";
import { PrismaService } from "./prisma.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { createCompanyTransferFixture } from "./company-transfer-fixture";
const run = process.env.RUN_COMPANY_TRANSFER_HTTP === "1" ? describe : describe.skip;
run("合同及互转四岗位真实API与浏览器验收", () => {
  jest.setTimeout(240000); let app: INestApplication, base: string, db: PrismaService; let f: Awaited<ReturnType<typeof createCompanyTransferFixture>>, b: typeof f;
  const password = "Local-Transfer-UAT-01", sessions: Record<string, unknown> = {}, actors: Record<string, { id: string; token: string; phone: string }> = {};
  async function call(path: string, role: string, body?: unknown, method?: string) { const response = await fetch(`${base}${path}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", authorization: `Bearer ${actors[role].token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const value = await response.json(); if (!response.ok) throw new Error(`${role} ${path}: ${response.status} ${JSON.stringify(value)}`); return value; }
  async function upload(role: string, signature = false) { const form = new FormData(); form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成验收依据.png"); const response = await fetch(`${base}${signature ? "/me/signature/canvas" : "/files"}`, { method: "POST", headers: { authorization: `Bearer ${actors[role].token}` }, body: form }); const value = await response.json(); if (!response.ok) throw new Error(`upload ${response.status} ${JSON.stringify(value)}`); return value.id as string; }
  async function person(role: string, projectId: string | null = null, positionKey = role) {
const user = await db.user.create({ data: { name: `验收${role}`, phone: `139${String(Object.keys(actors).length + 1).padStart(8, "0")}`, passwordHash: await hash(password, 4), mustChangePassword: false } }); const p = await db.position.upsert({ where: { key: positionKey }, create: { key: positionKey, name: `验收${positionKey}` }, update: {} }); await db.userPosition.create({ data: { userId: user.id, positionId: p.id, projectId } }); if (["contract_staff", "contract_director"].includes(role)) { const bp = await db.position.upsert({ where: { key: "budget_staff" }, create: { key: "budget_staff", name: "预算办理" }, update: {} }); await db.userPosition.create({ data: { userId: user.id, positionId: bp.id, projectId: f.projectId } }); }
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password }) }); expect(response.status).toBe(201); const s = await response.json(); sessions[role] = s; actors[role] = { id: user.id, phone: user.phone!, token: s.tokens.accessToken }; await upload(role, true);
}
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!); if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol114" || !process.env.COMPANY_TRANSFER_CORE_RECEIPT) throw new Error("只允许本机合成验收库");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication({ logger: false }); app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer); app.useGlobalPipes(createApiValidationPipe()); await app.listen(0, "127.0.0.1"); base = await app.getUrl(); db = app.get(PrismaService);
    const core = JSON.parse(await readFile(process.env.COMPANY_TRANSFER_CORE_RECEIPT!, "utf8")); const company = await db.companyEntity.findUniqueOrThrow({ where: { id: core.companyId } }), version = await db.companyEntityVersion.findFirstOrThrow({ where: { companyEntityId: company.id }, orderBy: { versionNo: "desc" } }), assignment = await db.projectAffiliateAssignment.findFirstOrThrow({ where: { projectId: core.projectId } });
    f = { projectId: core.projectId, companyId: company.id, companyVersionId: version.id, companyCreditCode: company.unifiedSocialCreditCode!, assignmentId: assignment.id, partyVersionId: assignment.businessPartyVersionId, affiliateCreditCode: assignment.affiliateCreditCodeSnapshot!, recorderId: assignment.assignedByUserId, directorId: assignment.assignedByUserId, contractFileId: "", signatureFileId: "", signatureVersionId: "" };
    await db.companyEntity.update({ where: { id: f.companyId }, data: { name: "验收第一建设公司" } });
    b = await createCompanyTransferFixture(db, "验收第二建设公司"); await db.project.update({ where: { id: f.projectId }, data: { name: "同项目四岗位合同互转验收" } });
    for (const c of [b]) await db.projectParticipatingCompany.create({ data: { projectId: f.projectId, companyEntityId: c.companyId, companyEntityVersionId: c.companyVersionId, companyNameSnapshot: c === f ? "验收第一建设公司" : "验收第二建设公司", companyCreditCodeSnapshot: c.companyCreditCode, effectiveFrom: new Date("2026-07-01"), changeReason: "合成验收", addedByUserId: f.recorderId } });

    for (const role of ["contract_staff", "contract_director", "finance_staff", "finance_director", "chairman", "general_manager", "comprehensive_director", "material_staff", "material_director"]) await person(role); await person("project_manager", f.projectId); await person("finance_reconciler", null, "finance_director");
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET!; await db.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,crypt(${secret},gen_salt('bf'))) ON CONFLICT("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
    await db.projectReceipt.create({ data: { projectId: f.projectId, receivedAt: new Date("2026-08-01"), amountCents: 1000000n, payerName: "隔离合成期初资金", sourceType: "other", voucherFileId: await upload("finance_staff"), recordedByUserId: actors.finance_staff.id } });
  });
  afterAll(async () => { await app?.close(); });
  it("真实登录与文件上传后，互转审批、两侧资金核对及各岗位余额回读", async () => {
    const bank = async (companyEntityId: string, direction: "inflow" | "outflow", amountCents: string) => { const accountNumber = companyEntityId === f.companyId ? "6222000011111111" : "6222000022222222"; const r = await call("/contract-bank-verifications", "finance_staff", { projectId: f.projectId, companyEntityId, accountNumber, bankReference: randomUUID(), direction, amountCents, occurredAt: "2026-08-20", evidenceFileId: await upload("finance_staff"), reason: "四岗位银行依据核验", idempotencyKey: randomUUID(), confirmationPassword: password }); await call(`/contract-bank-verifications/${r.id}/decision`, "finance_director", { decision: "confirm", accountNumber, holderEvidenceFileId: await upload("finance_director"), confirmationPassword: password }); return (await db.contractBankVerificationRequest.findUniqueOrThrow({ where: { id: r.id } })).observationId!; };
    await acceptContractChain({ db, f, password, actors, call, upload, bank });
    for (const amount of ["10000", "20000"]) { await bank(f.companyId, "outflow", amount); await bank(b.companyId, "inflow", amount); }
    for (const amount of ["3000", "6000"]) { await bank(b.companyId, "outflow", amount); await bank(f.companyId, "inflow", amount); }
    await new Promise<void>((done, reject) => { const env: NodeJS.ProcessEnv = { ...process.env, COMPANY_TRANSFER_API: base, COMPANY_TRANSFER_FIXTURE: JSON.stringify({ projectId: f.projectId, sourceCompanyId: f.companyId, destinationCompanyId: b.companyId, password, actors, sessions }) }; delete env.JEST_WORKER_ID; const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.company-transfer-real.config.ts"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" }); child.on("error", reject); child.on("exit", code => code === 0 ? done() : reject(new Error("公司互转真实浏览器岗位验收失败"))); });
    const view = await call(`/company-transfers?projectId=${f.projectId}`, "finance_staff"); expect(view.rows.length).toBe(4); expect(view.balances.every((r: { inTransitCents: string }) => r.inTransitCents === "0")).toBe(true);
    expect(view.balances.find((b: {companyId:string}) => b.companyId === f.companyId).receivableCents).toBe("21000");
    const finance = await call(`/operating-projections/project/${f.projectId}`, "finance_staff"), manager = await call(`/operating-projections/project/${f.projectId}`, "project_manager"); expect(finance.operating.confirmedCostCents).toBe("95000"); expect(finance.operating.payableCents).toBe("36000"); expect(finance.relationshipTotals).toEqual(expect.arrayContaining([expect.objectContaining({relationship:"upward",receivableCents:"38300"})])); expect(finance.companyTransferBalances).toEqual(manager.companyTransferBalances); expect(finance.companyTransferBalances).toEqual(view.balances);
  });
});

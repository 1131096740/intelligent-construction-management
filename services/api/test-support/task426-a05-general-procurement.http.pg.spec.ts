import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { apiJsonReplacer } from "../src/api-json-replacer";
import { createApiValidationPipe } from "../src/validation/api-validation";
import { PrismaService } from "../src/database/prisma.service";

const describePg = process.env.RUN_GENERAL_PROCUREMENT_PG16 === "1" ? describe : describe.skip;
const password = "Local-Procurement-A05-Only-01";
const signaturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"
);

describePg("A05 综合采购同案身份与委托公开 HTTP / PostgreSQL 16", () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let origin: string;

  async function request<T = unknown>(token: string, path: string, method = "GET", body?: object) {
    const response = await fetch(origin + path, { method, headers: {
      "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as T };
  }

  async function login(phone: string) {
    const result = await request<{ tokens: { accessToken: string } }>("", "/auth/login", "POST", { phone, password });
    expect(result).toMatchObject({ status: 201, body: { tokens: { accessToken: expect.any(String) } } });
    return result.body.tokens.accessToken;
  }

  async function actor(role?: string, projectId?: string) {
    const phone = `local-procurement-a05-${randomUUID()}`;
    const user = await db.user.create({ data: {
      name: "合成采购身份验收人员", phone, passwordHash: await hash(password, 4), mustChangePassword: false
    } });
    if (role) {
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: "合成验收岗位" } });
      await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId } });
    }
    return { id: user.id, phone, token: await login(phone) };
  }

  async function sign(token: string) {
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(signaturePng)], { type: "image/png" }), "合成签名.png");
    const response = await fetch(origin + "/me/signature/canvas", {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: form
    });
    expect(response.status).toBe(201);
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    const runId = process.env.JG_PROCUREMENT_OWNED_RUN_ID ?? "";
    const orderedFixture = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId)
      && url.pathname === "/jg_task01_" + runId.replaceAll("-", "")
      && url.username === "general_procurement_runtime"
      && url.searchParams.get("sslmode") === "require"
      && url.searchParams.get("sslaccept") === "strict"
      && Boolean(url.searchParams.get("sslcert"));
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1"
        || (url.pathname !== "/general_procurement" && !orderedFixture)) {
      throw new Error("仅允许本机一次性采购测试数据库");
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
    db = app.get(PrismaService);
  });
  afterAll(async () => { await app?.close(); });

  it("本人自审验密、撤岗停用和委托关闭双方待办均绑定同一采购轮次", async () => {
    const project = await db.project.create({ data: { code: `A05-${randomUUID()}`, name: "合成采购身份验收项目" } });
    const applicant = await actor("project_manager", project.id);
    const director = await actor("comprehensive_director");
    const outgoing = await actor("comprehensive_director");
    const delegate = await actor();
    const chairman = await actor("chairman");
    const technical = await actor("super_admin");
    await sign(applicant.token);
    await sign(delegate.token);

    const draft = await request<{ id: string }>(applicant.token, "/general-procurements", "POST", {
      requestKey: randomUUID(), requestProtocolVersion: 2, scope: "project", projectId: project.id,
      category: "office_supplies", lines: [{ id: randomUUID(), name: "合成同案采购物品" }]
    });
    expect(draft).toMatchObject({ status: 201, body: { id: expect.any(String), revision: 1 } });
    const id = draft.body.id;
    const base = `/general-procurements/${id}`;
    expect(await request(applicant.token, `${base}/submission`, "POST", { revision: 1 }))
      .toMatchObject({ status: 201, body: { status: "approval_pending", revision: 2 } });
    const round = await db.approvalInstance.findFirstOrThrow({ where: {
      businessType: "general_procurement", businessId: id, status: "in_progress"
    } });
    const approvals = () => db.approvalActionLog.findMany({
      where: { approvalInstanceId: round.id, action: "approve" }, orderBy: { createdAt: "asc" }
    });
    const duties = (token: string) => request<{ reviewDuties: Array<{ nodeIndex: number }> }>(token, base);
    const openApproval = async (token: string) => {
      const result = await request<{ queues: { pending: Array<{ businessId: string; type: string }> } }>(token, "/me/work-items");
      expect(result.status).toBe(200);
      return result.body.queues.pending.filter(item => item.businessId === id && item.type === "approval");
    };
    const review = (token: string, revision: number, expectedNodeIndex: number, confirmation = {}) =>
      request(token, `${base}/review`, "POST", { revision, expectedNodeIndex, decision: "approve", ...confirmation });

    expect((await review(technical.token, 2, 0)).status).toBe(403);
    expect(await openApproval(technical.token)).toEqual([]);
    expect((await duties(delegate.token)).status).toBe(403);
    expect((await review(applicant.token, 2, 1)).status).toBe(400);
    const selfReviewReason = "本人兼任该项目经理，已独立核对申请";
    expect(await review(applicant.token, 2, 1, { selfReviewReason, confirmationPassword: "A05-Wrong-Password" }))
      .toMatchObject({ status: 400, body: { message: expect.stringContaining("当前密码不正确") } });
    expect(await approvals()).toEqual([]);
    expect(await db.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(round);
    expect(await db.generalProcurement.findUnique({ where: { id } }))
      .toMatchObject({ status: "approval_pending", revision: 2 });
    expect(await review(applicant.token, 2, 1, { selfReviewReason, confirmationPassword: password }))
      .toMatchObject({ status: 201, body: { status: "approval_pending", revision: 3 } });
    const [selfAction] = await approvals();
    expect(selfAction).toMatchObject({ actorUserId: applicant.id, representedUserId: applicant.id,
      approvedRoleKey: "project_manager", signatureVersionIdSnapshot: expect.any(String), metadata: { selfReview: true, selfReviewReason } });
    expect((await review(applicant.token, 3, 1, { selfReviewReason, confirmationPassword: password })).status).toBe(409);

    expect(await duties(outgoing.token)).toMatchObject({ status: 200, body: { reviewDuties: [{ nodeIndex: 0 }] } });
    const removal = { operation: "remove", scope: "global", roleKey: "comprehensive_director", userId: outgoing.id };
    const preview = await request<{ canApply: boolean; snapshotHash: string; summary?: { blockingInstances: number };
      blockingIssues?: Array<{ code: string }> }>(chairman.token, "/organization/role-changes/preview", "POST", removal);
    if (preview.status !== 201 || !preview.body.canApply) {
      const issues = preview.body.blockingIssues?.map(issue => issue.code).filter(code => /^[a-z_]{1,50}$/u.test(code));
      const count = preview.body.summary?.blockingInstances;
      throw new Error(`A05_ROLE_REMOVAL_PREVIEW ${preview.status} ${Number.isSafeInteger(count) ? count : "-"} ${issues?.join(",") || "-"}`);
    }
    const applied = await request(chairman.token, "/organization/role-changes/apply", "POST", {
      ...removal, snapshotHash: preview.body.snapshotHash, confirmationPassword: password
    });
    if (applied.status !== 201) throw new Error(`A05_ROLE_REMOVAL_APPLY ${applied.status}`);
    expect((await review(outgoing.token, 3, 0)).status).toBe(401);
    const updatedToken = await login(outgoing.phone);
    expect((await review(updatedToken, 3, 0)).status).toBe(403);
    expect((await request(chairman.token, `/organization/users/${outgoing.id}`, "PATCH", {
      isActive: false, confirmationPassword: password
    })).status).toBe(200);
    expect((await review(updatedToken, 3, 0)).status).toBe(401);

    const options = await request<Array<{ value: string; actionKey: string; resourceType: string }>>(director.token, "/approval-delegations/duty-options");
    expect(options.status).toBe(200);
    const option = options.body.find(choice => choice.value === `${round.id}:0`);
    expect(option).toMatchObject({ actionKey: "general_procurement.approve", resourceType: "general_procurement_approval_duty" });
    const assignDuty = (toUserId: string) => request<{ id: string }>(director.token, "/approval-delegations", "POST", {
      toUserId, startsAt: new Date(Date.now() - 1_000).toISOString(),
      endsAt: new Date(Date.now() + 120_000).toISOString(), actionKey: option!.actionKey,
      resourceType: option!.resourceType, resourceId: option!.value
    });
    expect((await assignDuty(technical.id)).status).toBe(201);
    expect(await openApproval(technical.token)).toEqual([]);
    expect((await review(technical.token, 3, 0)).status).toBe(403);
    expect(await approvals()).toEqual([selfAction]);

    const assignment = await assignDuty(delegate.id);
    expect(assignment).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    for (const token of [director.token, delegate.token]) {
      expect(await duties(token)).toMatchObject({ status: 200, body: { reviewDuties: [{ nodeIndex: 0 }] } });
      expect(await openApproval(token)).toHaveLength(1);
    }
    expect((await review(technical.token, 3, 0)).status).toBe(403);
    expect(await approvals()).toEqual([selfAction]);

    expect(await review(delegate.token, 3, 0)).toMatchObject({ status: 201, body: { status: "approved_pending_procurement", revision: 4 } });
    await Promise.all([director.token, delegate.token].map(async token => {
      expect((await review(token, 3, 0)).status).toBe(409);
      expect(await openApproval(token)).toEqual([]);
    }));
    expect((await duties(delegate.token)).status).toBe(403);
    const actions = await approvals();
    expect(actions).toEqual([selfAction, expect.objectContaining({ actorUserId: delegate.id, representedUserId: director.id,
      approvedRoleKey: "comprehensive_director", signatureVersionIdSnapshot: expect.any(String),
      metadata: expect.objectContaining({ delegationId: assignment.body.id }) })]);
    expect(await db.approvalInstance.findUnique({ where: { id: round.id } })).toMatchObject({ status: "approved" });
  });
});

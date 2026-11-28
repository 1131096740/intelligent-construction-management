import { Prisma } from "@prisma/client";
import { createTemplateTestServer } from "../contract-template/template-management.test-support";
import type { WorkItemsReadModel } from "./me.service";

describe("本人草稿队列读取真实直接签署输入（公开HTTP，模拟持久层）", () => {
  let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  let token: string;
  const numberReadBatchSizes: number[] = [];
  let rawReadFailure: "unavailable" | "duplicate" | "missing" | "mismatch" | "extra" | null = null;
  const marker = { protocolVersion: 1, source: "direct_signed", relationship: "outside", signedOn: null,
    enterpriseParty: null, counterpartyParty: null, fixedPaymentTermsVersionId: null };
  beforeAll(async () => {
    server = await createTemplateTestServer({ draftWorkbench: true });
    Object.assign(server.store.prisma, { spotProcurement: server.store.table("spotProcurement") });
    // The approved persistence boundary only: register this exact read, delegate all other reads.
    const original = server.store.prisma.$queryRaw;
    server.store.prisma.$queryRaw = async (input: Prisma.Sql | TemplateStringsArray, ...bindings: unknown[]) => {
      const query = "strings" in input ? input : Prisma.sql(input, ...bindings);
      const text = query.strings.join("?").replace(/\s+/gu, " ").trim();
      const prefix = 'SELECT "id", "contractId", "originalSignedNumber" FROM public."ContractVersion" WHERE "status" = \'draft\' AND ("id", "contractId") IN (';
      if (text.startsWith(prefix)) {
        const count = query.values.length / 2;
        if (!Number.isInteger(count) || count < 1 || count > 30 ||
          text !== prefix + Array.from({ length: count }, () => '(?, ?)').join(',') + ')' ||
          query.values.some(value => typeof value !== "string")) throw new Error("模拟原号批读拒绝shape或参数上界");
        numberReadBatchSizes.push(count);
        const rows: Array<Record<string, unknown>> = [];
        const ids = new Set<unknown>();
        for (let index = 0; index < query.values.length; index += 2) {
          if (ids.has(query.values[index])) throw new Error("模拟原号批读拒绝重复V");
          ids.add(query.values[index]);
          const row = await server.store.table("contractVersion").findUnique({ where: { id: query.values[index], contractId: query.values[index + 1], status: "draft" } });
          if (row) rows.push({ id: row.id, contractId: row.contractId, originalSignedNumber: row.originalSignedNumber });
        }
        if (rawReadFailure === "unavailable") throw new Error("模拟原号列读取暂不可用，不应向用户泄露此错误");
        if (rawReadFailure === "duplicate") return [...rows, rows[0]];
        if (rawReadFailure === "missing") return rows.slice(1);
        if (rawReadFailure === "mismatch") return rows.map((row, index) => index === 0 ? { ...row, contractId: "unrequested-contract" } : row);
        if (rawReadFailure === "extra") return rows.map(row => ({ ...row, unrequested: true }));
        return rows.reverse(); // DB row order is not a pairing guarantee.
      }
      return original(input, ...bindings);
    };
    await server.store.prisma.project.create({ data: { id: "me-project", name: "本人合同项目", isActive: true } });
    const response = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "13800001102", password: server.password }) });
    expect(response.status).toBe(201);
    token = (await response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  });
  afterAll(async () => { await server?.app.close(); });
  async function seed(id: string, number: string | null, amount: string | null = "100.0054", extra: Record<string, unknown> = {}) {
    await server.store.prisma.contract.create({ data: { id: `c-${id}`, projectId: "me-project", name: `合同${id}`, code: "不应显示HT", temporaryCode: "不应显示暂号", ownerUserId: "staff", source: "new", voidedAt: null } });
    await server.store.prisma.contractVersion.create({ data: { id, contractId: `c-${id}`, status: "draft", versionNo: 1, changeType: "original", numericProtocolVersion: 2, amountCents: 999999n, amountYuan: amount === null ? null : new Prisma.Decimal(amount), originalSignedNumber: number, draftData: { contractBasics: { relationship: "outside" }, directSigningInput: marker }, ...extra } });
  }
  async function drafts() {
    const response = await fetch(`${await server.app.getUrl()}/me/work-items`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return (await response.json() as WorkItemsReadModel).queues.drafts;
  }
  it("保留真实原号与四位金额，不展示系统编号", async () => {
    await seed("direct-a", "  合同Ａ  ");
    expect((await drafts()).find(row => row.id === "contract-draft:direct-a")).toMatchObject({ businessCode: "  合同Ａ  ", amountText: "¥100.0054", businessId: "c-direct-a", targetPath: "/合同工作台/c-direct-a?versionId=direct-a" });
  });
  it("保留无编号及重复原号，金额未知与真实零分开，路由仍独立", async () => {
    await seed("no-number", null, null);
    await seed("same-a", "同号", "0");
    await seed("same-b", "同号", "100.0054");
    await seed("spaces", "   ", "1");
    const rows = await drafts();
    expect(rows.find(row => row.id === "contract-draft:no-number")).toMatchObject({ businessCode: "未注明编号", amountText: "金额待确定" });
    expect(rows.find(row => row.id === "contract-draft:same-a")).toMatchObject({ businessCode: "同号", amountText: "¥0.0000", targetPath: "/合同工作台/c-same-a?versionId=same-a" });
    expect(rows.find(row => row.id === "contract-draft:same-b")).toMatchObject({ businessCode: "同号", targetPath: "/合同工作台/c-same-b?versionId=same-b" });
    expect(rows.find(row => row.id === "contract-draft:spaces")).toMatchObject({ businessCode: "   ", amountText: "¥1.0000" });
  });
  it("非法保留域不能退回旧编号或金额，不提供办理路由", async () => {
    await seed("bad-marker", "不可信号", "100.0054", { draftData: { contractBasics: { relationship: "outside" }, directSigningInput: { ...marker, callerQualified: true } } });
    expect((await drafts()).find(row => row.id === "contract-draft:bad-marker")).toMatchObject({ businessCode: "编号待核对", amountText: "金额待核对", currentNode: "资料待核对", targetPath: "/合同管理/c-bad-marker?versionId=bad-marker", tone: "warning" });
  });

  it.each([
    ["numeric1-marker", { numericProtocolVersion: 1 }],
    ["changed-marker", { changeType: "change" }],
    ["null-marker", { draftData: { directSigningInput: null } }],
    ["inside-marker", { draftData: { contractBasics: { relationship: "inside" }, directSigningInput: marker } }],
    ["bad-date", { draftData: { contractBasics: { relationship: "outside" }, directSigningInput: { ...marker, signedOn: "2026-02-29" } } }],
    ["missing-field", { draftData: { contractBasics: { relationship: "outside" }, directSigningInput: { protocolVersion: 1, source: "direct_signed", relationship: "outside" } } }],
    ["bad-party", { draftData: { contractBasics: { relationship: "outside" }, directSigningInput: { ...marker, enterpriseParty: { roleKey: "construction_enterprise", displayOrder: -1 } } } }]
  ])("%s保留域不合法不返回legacy标识", async (id, extra) => {
    await seed(id, "不得显示", "1", extra);
    expect((await drafts()).find(row => row.id === `contract-draft:${id}`)).toMatchObject({ businessCode: "编号待核对", amountText: "金额待核对", targetPath: `/合同管理/c-${id}?versionId=${id}` });
  });
  it("原号读取缺失或类型非法只显示中文待核对", async () => {
    await seed("empty-number", "");
    await seed("invalid-number", null, "1", { originalSignedNumber: 42 });
    for (const id of ["empty-number", "invalid-number"]) {
      expect((await drafts()).find(row => row.id === `contract-draft:${id}`)).toMatchObject({ businessCode: "编号待核对", amountText: "金额待核对", targetPath: `/合同管理/c-${id}?versionId=${id}` });
    }
  });
  it("旧V1和generated仍使用原编号金额，其他经办人草稿不进入本人队列", async () => {
    await seed("legacy-v1", null, "100.0054", { numericProtocolVersion: 1, draftData: {} });
    await seed("generated-v2", null, "100.0054", { draftData: { contractBasics: { relationship: "inside" } } });
    await seed("other-owner", "他人原号");
    await server.store.prisma.contract.update({ where: { id: "c-other-owner" }, data: { ownerUserId: "director" } });
    const rows = await drafts();
    for (const id of ["legacy-v1", "generated-v2"]) {
      expect(rows.find(row => row.id === `contract-draft:${id}`)).toMatchObject({ businessCode: "不应显示HT", amountText: "¥9,999.99", targetPath: `/contracts/c-${id}/workbench` });
    }
    expect(rows.some(row => row.businessId === "c-other-owner")).toBe(false);
    expect((await fetch(`${await server.app.getUrl()}/me/work-items`)).status).toBe(401);
  });

  it("历史接管草稿保留原队列展示", async () => {
    await seed("takeover-v", null, "100.0054", { numericProtocolVersion: 1, draftData: {} });
    await server.store.prisma.contract.update({ where: { id: "c-takeover-v" }, data: { source: "historical_takeover", code: "历史原编号" } });
    await server.store.prisma.contractTakeover.create({ data: { id: "historical-me", projectId: "me-project", contractId: "c-takeover-v", contractVersionId: "takeover-v", takeoverStatus: "draft", responsibleUserId: "staff", createdByUserId: "staff" } });
    const rows = await drafts();
    expect(rows.find(row => row.id === "takeover:historical-me")).toMatchObject({ businessCode: "历史原编号", amountText: "¥9,999.99", targetPath: "/历史合同接管" });
    expect(rows.some(row => row.id === "contract-draft:takeover-v")).toBe(false);
  });

  it("原号批次缺失、重复、错绑或不可读保持只读核对定位", async () => {
    await seed("read-failure", "真实原号", "1");
    try {
      for (const failure of ["unavailable", "duplicate", "missing", "mismatch", "extra"] as const) {
        rawReadFailure = failure;
        expect((await drafts()).find(row => row.id === "contract-draft:read-failure")).toMatchObject({
          businessCode: "编号待核对", amountText: "金额待核对", targetPath: "/合同管理/c-read-failure?versionId=read-failure"
        });
      }
    } finally { rawReadFailure = null; }
  });
  it("多份直接签署草稿的原号有界批读且保留输出", async () => {
    // This positive control repairs earlier deliberately corrupt persisted fixture rows;
    // a malformed batch correctly withholds every result in that batch.
    for (const id of ["empty-number", "invalid-number"]) {
      await server.store.prisma.contractVersion.update({ where: { id }, data: { originalSignedNumber: null } });
    }
    for (let index = 0; index < 65; index++) await seed(`batch-${index}`, `批量原号${index}`, "100.0054");
    numberReadBatchSizes.length = 0;
    const rows = await drafts();
    expect(numberReadBatchSizes.length).toBeLessThanOrEqual(3);
    expect(numberReadBatchSizes.every(size => size > 0 && size <= 30)).toBe(true);
    expect(numberReadBatchSizes.some(size => size > 1)).toBe(true);
    const batchRows = rows.filter(item => item.id.startsWith("contract-draft:batch-"));
    expect(batchRows.length).toBeGreaterThan(0);
    for (const row of batchRows) {
      const index = row.id.slice("contract-draft:batch-".length);
      expect(row).toMatchObject({ businessCode: `批量原号${index}`, amountText: "¥100.0054", targetPath: `/合同工作台/c-batch-${index}?versionId=batch-${index}` });
    }
  });

});

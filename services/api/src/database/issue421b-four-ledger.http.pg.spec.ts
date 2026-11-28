import { hash } from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as ExcelJS from "exceljs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";

const run =
  process.env.ISSUE421B_LEDGER_RUN === "1" ? describe : describe.skip;

/**
 * #421b 真库证据（真实 PostgreSQL 16 + 真实 Nest HTTP）：
 *
 * 1) 付款/零星采购/综合采购/报销四类台账的服务端筛选与导出使用同一读模型；
 * 2) 导出只包含逐行权限校验后可见的行，无权行不会出现；
 * 3) 金额/日期写成数值/日期单元格，文本公式前缀被转义；
 * 4) 未知金额不写 0（零星/综合/报销的未知金额保持空白，不进合计）。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue421b-four-ledger-local.cjs
 */
run("issue 421b four ledger filters and exports on real PostgreSQL and HTTP", () => {
  jest.setTimeout(180_000);
  const password = "Issue421b-Ledger-Password-01";
  const ids = {
    projectA: "i421b-project-a",
    projectB: "i421b-project-b",
    director: "i421b-director",
    staffA: "i421b-staff-a",
    finance: "i421b-finance",
    manager: "i421b-manager",
    outsider: "i421b-outsider",
    contractA: "i421b-contract-a",
    versionA: "i421b-version-a",
    contractB: "i421b-contract-b",
    versionB: "i421b-version-b",
    paymentA: "i421b-payment-a",
    paymentB: "i421b-payment-b",
    spotA: "i421b-spot-a",
    spotB: "i421b-spot-b",
    spotVersionA: "i421b-spot-version-a",
    spotVersionB: "i421b-spot-version-b",
    generalA: "i421b-general-a",
    generalB: "i421b-general-b",
    claimA: "i421b-claim-a",
    claimB: "i421b-claim-b"
  };
  const phones: Record<string, string> = {
    director: "13900004311",
    staffA: "13900004312",
    finance: "13900004313",
    manager: "13900004314",
    outsider: "13900004315"
  };
  const tokens = new Map<string, string>();
  let app: INestApplication;
  let owner: PrismaClient;
  let base: string;

  const login = async (actor: keyof typeof phones) => {
    const response = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: phones[actor], password })
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { tokens: { accessToken: string } };
    tokens.set(actor, body.tokens.accessToken);
  };

  const callJson = async (actor: keyof typeof phones, path: string) => {
    const response = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${tokens.get(actor)}` }
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const callWorkbook = async (actor: keyof typeof phones, path: string) => {
    const response = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${tokens.get(actor)}` }
    });
    if (response.status !== 200) return { status: response.status, sheet: null };
    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return { status: response.status, sheet: workbook.worksheets[0] ?? null };
  };

  const headersOf = (sheet: ExcelJS.Worksheet) =>
    (sheet.getRow(1).values as unknown[]).slice(1) as string[];

  const setUpdatedAt = async (table: string, id: string, iso: string) => {
    await owner.$executeRawUnsafe(
      `UPDATE "${table}" SET "updatedAt" = $1::timestamptz WHERE "id" = $2`,
      new Date(iso),
      id
    );
  };

  const dataRowTexts = (
    sheet: ExcelJS.Worksheet,
    columnNumber: number,
    prefix: string
  ) =>
    sheet
      .getRows(2, sheet.rowCount - 1)
      ?.map((row) => row.getCell(columnNumber).value)
      .filter((value): value is string => typeof value === "string" && value.startsWith(prefix)) ?? [];

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (
      process.env.NODE_ENV !== "test" ||
      target.hostname !== "127.0.0.1" ||
      !target.pathname.endsWith("_issue421b_ledger")
    ) {
      throw new Error("ISSUE421B_ISOLATED_DATABASE_REQUIRED");
    }
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    const passwordHash = await hash(password, 4);
    await owner.user.createMany({
      data: [
        { id: ids.director, name: "合同部主管", phone: phones.director, passwordHash, mustChangePassword: false, isActive: true },
        { id: ids.staffA, name: "合同部经办甲", phone: phones.staffA, passwordHash, mustChangePassword: false, isActive: true },
        { id: ids.finance, name: "财务人员乙", phone: phones.finance, passwordHash, mustChangePassword: false, isActive: true },
        { id: ids.manager, name: "总经理", phone: phones.manager, passwordHash, mustChangePassword: false, isActive: true },
        { id: ids.outsider, name: "项目员工丙", phone: phones.outsider, passwordHash, mustChangePassword: false, isActive: true }
      ]
    });
    await owner.project.createMany({
      data: [
        { id: ids.projectA, code: "I421B-A", name: "总部综合楼", isActive: true },
        { id: ids.projectB, code: "I421B-B", name: "数据中心", isActive: true }
      ]
    });
    await owner.position.createMany({
      data: [
        { key: "contract_director", name: "合同部主管" },
        { key: "finance_staff", name: "财务人员" },
        { key: "general_manager", name: "总经理" }
      ],
      skipDuplicates: true
    });
    const positions = await owner.position.findMany({
      where: { key: { in: ["contract_director", "finance_staff", "general_manager"] } }
    });
    await owner.userPosition.createMany({
      data: [
        { userId: ids.director, positionId: positions.find((position) => position.key === "contract_director")!.id, projectId: null },
        { userId: ids.finance, positionId: positions.find((position) => position.key === "finance_staff")!.id, projectId: null },
        { userId: ids.manager, positionId: positions.find((position) => position.key === "general_manager")!.id, projectId: null }
      ]
    });
    await owner.projectMember.createMany({
      data: [
        { projectId: ids.projectA, userId: ids.staffA, positionKey: "contract_staff" },
        { projectId: ids.projectA, userId: ids.outsider, positionKey: "employee" }
      ]
    });

    await owner.contract.create({
      data: {
        id: ids.contractA,
        projectId: ids.projectA,
        code: "HT-421B-A",
        name: "幕墙分包合同",
        counterparty: "=HYPERLINK(\"http://evil.example\")",
        contractTypeKey: "labor_subcontract",
        companyEntityName: "四川建工智管建筑工程有限公司"
      }
    });
    await owner.contractVersion.create({
      data: {
        id: ids.versionA,
        contractId: ids.contractA,
        versionNo: 1,
        changeType: "initial",
        status: "effective",
        amountCents: 100_000n,
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "i421b-company",
        companyEntityNameSnapshot: "四川建工智管建筑工程有限公司",
        draftData: {},
        templateSnapshot: {},
        clauseSnapshot: {}
      }
    });
    await owner.contract.create({
      data: {
        id: ids.contractB,
        projectId: ids.projectB,
        code: "HT-421B-B",
        name: "钢材采购合同",
        counterparty: "钢材供应商",
        contractTypeKey: "material_purchase",
        companyEntityName: "四川建工智管建筑工程有限公司"
      }
    });
    await owner.contractVersion.create({
      data: {
        id: ids.versionB,
        contractId: ids.contractB,
        versionNo: 1,
        changeType: "initial",
        status: "effective",
        amountCents: 250_000n,
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "i421b-company",
        companyEntityNameSnapshot: "四川建工智管建筑工程有限公司",
        draftData: {},
        templateSnapshot: {},
        clauseSnapshot: {}
      }
    });

    await owner.paymentRequest.createMany({
      data: [
        {
          id: ids.paymentA,
          projectId: ids.projectA,
          contractId: ids.contractA,
          contractVersionId: ids.versionA,
          paymentTermsVersionId: ids.versionA,
          code: "FK-421B-A",
          status: "approved_pending_payment",
          requestedAmountCents: 100_000n,
          paidAmountCents: 0n,
          paymentSubjectType: "our_company"
        },
        {
          id: ids.paymentB,
          projectId: ids.projectB,
          contractId: ids.contractB,
          contractVersionId: ids.versionB,
          paymentTermsVersionId: ids.versionB,
          code: "FK-421B-B",
          status: "paid",
          requestedAmountCents: 250_000n,
          paidAmountCents: 250_000n,
          paymentSubjectType: "our_company"
        }
      ]
    });

    await owner.spotProcurement.createMany({
      data: [
        {
          id: ids.spotA,
          projectId: ids.projectA,
          code: "LK-421B-A",
          applicantUserId: ids.staffA,
          handlerUserId: ids.staffA,
          currentVersionId: ids.spotVersionA,
          status: "approved_in_progress"
        },
        {
          id: ids.spotB,
          projectId: ids.projectB,
          code: "LK-421B-B",
          applicantUserId: ids.manager,
          handlerUserId: ids.manager,
          currentVersionId: ids.spotVersionB,
          status: "approved_in_progress"
        }
      ]
    });
    await owner.spotProcurementVersion.createMany({
      data: [
        {
          id: ids.spotVersionA,
          procurementId: ids.spotA,
          versionNo: 1,
          status: "approved",
          requestProtocolVersion: 2,
          reason: "=1+1 零星材料",
          handlerUserId: ids.staffA,
          applicationDepartmentSnapshot: "工程部",
          applicationNameSnapshot: "合同部经办甲",
          purchaserNameSnapshot: "合同部经办甲",
          purchaserDepartmentNameSnapshot: "工程部",
          createdByUserId: ids.staffA,
          estimatedTotalAmount: new Prisma.Decimal("12.3400")
        },
        {
          id: ids.spotVersionB,
          procurementId: ids.spotB,
          versionNo: 1,
          status: "approved",
          requestProtocolVersion: 2,
          reason: "数据中心零星材料",
          handlerUserId: ids.manager,
          applicationDepartmentSnapshot: "综合部",
          applicationNameSnapshot: "总经理",
          purchaserNameSnapshot: "总经理",
          purchaserDepartmentNameSnapshot: "综合部",
          createdByUserId: ids.manager,
          estimatedTotalAmount: new Prisma.Decimal("50.0000")
        }
      ]
    });

    await owner.spotProcurementLine.createMany({
      data: [
        {
          versionId: ids.spotVersionA,
          sortOrder: 1,
          materialName: "零星材料",
          quantity: new Prisma.Decimal("1.000000"),
          estimatedUnitPrice: new Prisma.Decimal("12.3400"),
          estimatedAmount: new Prisma.Decimal("12.3400")
        },
        {
          versionId: ids.spotVersionB,
          sortOrder: 1,
          materialName: "零星材料",
          quantity: new Prisma.Decimal("1.000000"),
          estimatedUnitPrice: new Prisma.Decimal("50.0000"),
          estimatedAmount: new Prisma.Decimal("50.0000")
        }
      ]
    });

    await owner.generalProcurement.createMany({
      data: [
        {
          id: ids.generalA,
          code: "ZHCG-421B-A",
          requestKey: "i421b-request-a",
          creationFingerprint: "i421b-fingerprint-a",
          projectId: ids.projectA,
          companyEntityId: "i421b-company",
          companyNameSnapshot: "四川建工智管建筑工程有限公司",
          applicantUserId: ids.staffA,
          applicantNameSnapshot: "合同部经办甲",
          category: "office_supplies",
          reason: "=1+1 办公用品",
          requestProtocolVersion: 2,
          scope: "project",
          lines: [],
          status: "approved_pending_procurement",
          estimatedAmount: new Prisma.Decimal("500.0000")
        },
        {
          id: ids.generalB,
          code: "ZHCG-421B-B",
          requestKey: "i421b-request-b",
          creationFingerprint: "i421b-fingerprint-b",
          projectId: ids.projectB,
          companyEntityId: "i421b-company",
          companyNameSnapshot: "四川建工智管建筑工程有限公司",
          applicantUserId: ids.manager,
          applicantNameSnapshot: "总经理",
          category: "equipment",
          reason: "数据中心设备",
          requestProtocolVersion: 2,
          scope: "project",
          lines: [],
          status: "approved_pending_procurement",
          estimatedAmount: new Prisma.Decimal("800.0000")
        }
      ]
    });

    await owner.expenseClaim.createMany({
      data: [
        {
          id: ids.claimA,
          code: "BX-421B-A",
          claimType: "reimbursement",
          status: "approved_pending_payment",
          companyEntityId: "i421b-company",
          companyEntityNameSnapshot: "四川建工智管建筑工程有限公司",
          projectId: ids.projectA,
          applicantUserId: ids.staffA,
          applicantNameSnapshot: "合同部经办甲",
          handledByUserId: ids.staffA,
          handledByNameSnapshot: "合同部经办甲",
          reason: "=1+1 差旅报销",
          payeeNameSnapshot: "合同部经办甲",
          requestedAmountCents: 120_000n,
          companyPayableAmountCents: 120_000n,
          fundedAmountCents: 0n,
          loanOffsetAmountCents: 0n
        },
        {
          id: ids.claimB,
          code: "BX-421B-B",
          claimType: "loan",
          status: "disbursed",
          companyEntityId: "i421b-company",
          companyEntityNameSnapshot: "四川建工智管建筑工程有限公司",
          projectId: ids.projectB,
          applicantUserId: ids.manager,
          applicantNameSnapshot: "总经理",
          handledByUserId: ids.manager,
          handledByNameSnapshot: "总经理",
          reason: "数据中心借款",
          payeeNameSnapshot: "总经理",
          requestedAmountCents: 80_000n,
          fundedAmountCents: 80_000n
        }
      ]
    });

    await Promise.all([
      setUpdatedAt("PaymentRequest", ids.paymentA, "2026-11-20T01:00:00.000Z"),
      setUpdatedAt("PaymentRequest", ids.paymentB, "2026-11-19T01:00:00.000Z"),
      setUpdatedAt("SpotProcurement", ids.spotA, "2026-11-20T02:00:00.000Z"),
      setUpdatedAt("SpotProcurement", ids.spotB, "2026-11-19T02:00:00.000Z"),
      setUpdatedAt("GeneralProcurement", ids.generalA, "2026-11-20T03:00:00.000Z"),
      setUpdatedAt("GeneralProcurement", ids.generalB, "2026-11-19T03:00:00.000Z"),
      setUpdatedAt("ExpenseClaim", ids.claimA, "2026-11-20T04:00:00.000Z"),
      setUpdatedAt("ExpenseClaim", ids.claimB, "2026-11-19T04:00:00.000Z")
    ]);

    await Promise.all([
      login("director"),
      login("staffA"),
      login("finance"),
      login("manager"),
      login("outsider")
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
  });

  it("filters payment ledger on the server and exports the same visible filtered rows", async () => {
    const financeList = await callJson("finance", "/payments?view=formal_ledger&keyword=幕墙");
    expect(financeList.status).toBe(200);
    expect(financeList.body.rows.map((row: { paymentNo: string }) => row.paymentNo)).toEqual([
      "FK-421B-A"
    ]);
    expect(financeList.body.filters.keyword).toBe("幕墙");
    expect(
      financeList.body.columns.map((column: { key: string }) => column.key)
    ).toEqual(expect.arrayContaining(["paymentNo", "signingParty", "counterparty"]));

    const financeAll = await callJson("finance", "/payments?view=formal_ledger");
    expect(financeAll.body.rows).toHaveLength(2);
    expect(financeAll.body.rows.every((row: { signingParty: string }) => row.signingParty === "四川建工智管建筑工程有限公司")).toBe(true);

    const staffList = await callJson("staffA", "/payments?view=formal_ledger");
    expect(staffList.status).toBe(200);
    // 合同部经办不在付款敏感台账的逐行可见范围内。
    expect(staffList.body.rows).toEqual([]);

    const exported = await callWorkbook(
      "finance",
      "/payments/ledger-export?view=formal_ledger&keyword=幕墙"
    );
    expect(exported.status).toBe(200);
    const sheet = exported.sheet!;
    const headers = headersOf(sheet);
    const index = (header: string) => headers.indexOf(header) + 1;
    expect(dataRowTexts(sheet, index("付款编号"), "FK-")).toEqual(["FK-421B-A"]);
    expect(sheet.getRow(2).getCell(index("申请金额（元）")).value).toBe(1000);
    expect(sheet.getRow(2).getCell(index("申请金额（元）")).numFmt).toBe("#,##0.0000");
    expect(sheet.getRow(2).getCell(index("更新时间")).value).toBeInstanceOf(Date);
    expect(sheet.getRow(2).getCell(index("相对方（乙方）")).value).toBe(
      "'=HYPERLINK(\"http://evil.example\")"
    );
    expect(sheet.getRow(2).getCell(index("项目")).value).toBe("总部综合楼");
  });

  it("does not let payment export bypass row-level visibility", async () => {
    const staff = await callWorkbook("staffA", "/payments/ledger-export?view=formal_ledger");
    expect(staff.status).toBe(200);
    expect(dataRowTexts(staff.sheet!, 1, "FK-")).toEqual([]);

    const outsider = await callWorkbook("outsider", "/payments/ledger-export?view=formal_ledger");
    expect(outsider.status).toBe(200);
    expect(dataRowTexts(outsider.sheet!, 1, "FK-")).toEqual([]);
  });

  it("filters and exports spot procurement with the same accessible rows", async () => {
    const staffList = await callJson("staffA", "/spot-procurements?keyword=零星");
    expect(staffList.status).toBe(200);
    expect(staffList.body.items.map((item: { code: string }) => item.code)).toEqual([
      "LK-421B-A"
    ]);

    const byDate = await callJson(
      "staffA",
      "/spot-procurements?dateFrom=2026-11-20&dateTo=2026-11-20"
    );
    expect(byDate.body.items.map((item: { code: string }) => item.code)).toEqual([
      "LK-421B-A"
    ]);

    const staffExport = await callWorkbook("staffA", "/spot-procurements/ledger-export");
    expect(staffExport.status).toBe(200);
    const staffSheet = staffExport.sheet!;
    const staffHeaders = headersOf(staffSheet);
    const staffIndex = (header: string) => staffHeaders.indexOf(header) + 1;
    // 项目 B 的申请人不属于当前账号可见范围，导出不得出现。
    expect(dataRowTexts(staffSheet, staffIndex("采购编号"), "LK-")).toEqual(["LK-421B-A"]);
    expect(staffSheet.getRow(2).getCell(staffIndex("预计金额（元）")).value).toBe(12.34);
    expect(staffSheet.getRow(2).getCell(staffIndex("采购内容与用途")).value).toBe(
      "'=1+1 零星材料"
    );
    expect(staffSheet.getRow(2).getCell(staffIndex("更新时间")).value).toBeInstanceOf(Date);

    // 项目普通员工既非申请人/经办人，也无物资岗位；逐行判定不返回任何零星采购行。
    const outsider = await callWorkbook("outsider", "/spot-procurements/ledger-export");
    expect(outsider.status).toBe(200);
    expect(dataRowTexts(outsider.sheet!, 1, "LK-")).toEqual([]);
  });

  it("filters and exports general procurement with the same access scope", async () => {
    const staffList = await callJson("staffA", "/general-procurements?keyword=办公");
    expect(staffList.status).toBe(200);
    expect(staffList.body.items.map((item: { code: string }) => item.code)).toEqual([
      "ZHCG-421B-A"
    ]);

    const managerList = await callJson("manager", "/general-procurements",);
    expect(managerList.status).toBe(200);
    expect(managerList.body.items.map((item: { code: string }) => item.code).sort()).toEqual([
      "ZHCG-421B-A",
      "ZHCG-421B-B"
    ]);

    const staffExport = await callWorkbook("staffA", "/general-procurements/ledger-export");
    expect(staffExport.status).toBe(200);
    const sheet = staffExport.sheet!;
    const headers = headersOf(sheet);
    const index = (header: string) => headers.indexOf(header) + 1;
    expect(dataRowTexts(sheet, index("采购编号"), "ZHCG-")).toEqual(["ZHCG-421B-A"]);
    expect(sheet.getRow(2).getCell(index("采购单位")).value).toBe("四川建工智管建筑工程有限公司");
    expect(sheet.getRow(2).getCell(index("预计金额（元）")).value).toBe(500);
    expect(sheet.getRow(2).getCell(index("采购内容与用途")).value).toBe("'=1+1 办公用品");
    // 没有实际采购批次时，实际采购金额保持空白，不写 0。
    expect(sheet.getRow(2).getCell(index("实际采购金额（元）")).value).toBeNull();

    const managerExport = await callWorkbook("manager", "/general-procurements/ledger-export");
    expect(managerExport.status).toBe(200);
    expect(
      dataRowTexts(managerExport.sheet!, index("采购编号"), "ZHCG-").sort()
    ).toEqual(["ZHCG-421B-A", "ZHCG-421B-B"]);
  });

  it("filters expense claims by access and exports high precision facts in all four ledgers", async () => {
    const managerList = await callJson("manager", "/expense-claims/ledger?keyword=差旅");
    expect(managerList.status).toBe(200);
    expect(managerList.body.rows.map((row: { code: string }) => row.code)).toEqual([
      "BX-421B-A"
    ]);
    expect(managerList.body.rows[0].claimTypeLabel).toBe("费用报销");

    const staffList = await callJson("staffA", "/expense-claims/ledger");
    expect(staffList.status).toBe(200);
    expect(staffList.body.rows.map((row: { code: string }) => row.code)).toEqual([
      "BX-421B-A"
    ]);

    const exported = await callWorkbook(
      "manager",
      "/expense-claims/ledger-export?dateFrom=2026-11-20&dateTo=2026-11-20"
    );
    expect(exported.status).toBe(200);
    const sheet = exported.sheet!;
    const headers = headersOf(sheet);
    const index = (header: string) => headers.indexOf(header) + 1;
    expect(dataRowTexts(sheet, index("报销编号"), "BX-")).toEqual(["BX-421B-A"]);
    expect(sheet.getRow(2).getCell(index("申请金额（元）")).value).toBe(1200);
    expect(sheet.getRow(2).getCell(index("事由")).value).toBe("'=1+1 差旅报销");
    expect(sheet.getRow(2).getCell(index("更新时间")).value).toBeInstanceOf(Date);

    const staffExport = await callWorkbook("staffA", "/expense-claims/ledger-export");
    expect(staffExport.status).toBe(200);
    // 项目 B 的借款不在员工本人范围内。
    expect(dataRowTexts(staffExport.sheet!, index("报销编号"), "BX-")).toEqual(["BX-421B-A"]);

    await owner.paymentRequest.update({
      where: { id: ids.paymentA },
      data: { requestedAmountCents: 9_007_199_254_740_993n }
    });
    await owner.spotProcurementVersion.update({
      where: { id: ids.spotVersionA },
      data: { estimatedTotalAmount: new Prisma.Decimal("1234567890123456.7891") }
    });
    const generalEstimate = "1234567890123456.7890";
    await owner.generalProcurement.create({
      data: {
        code: "ZHCG-421B-PRECISION",
        requestKey: "i421b-request-precision",
        creationFingerprint: "i421b-fingerprint-precision",
        projectId: ids.projectA,
        companyEntityId: "i421b-company",
        companyNameSnapshot: "四川建工智管建筑工程有限公司",
        applicantUserId: ids.staffA,
        applicantNameSnapshot: "合同部经办甲",
        category: "office_supplies",
        reason: "高精度综合采购",
        requestProtocolVersion: 2,
        scope: "project",
        lines: [{
          id: "00000000-0000-4000-8000-000000000003",
          name: "高精度综合采购",
          specification: null,
          unit: "项",
          quantity: "1.0000",
          unitPrice: generalEstimate,
          estimatedAmount: generalEstimate,
          requiredOn: null,
          note: null
        }],
        status: "approved_pending_procurement",
        estimatedAmount: new Prisma.Decimal(generalEstimate)
      }
    });
    await owner.expenseClaim.update({
      where: { id: ids.claimA },
      data: {
        requestedAmountCents: 9_007_199_254_740_999n,
        fundedAmountCents: 9_007_199_254_740_901n,
        loanOffsetAmountCents: 92n,
        companyPayableAmountCents: 9_007_199_254_740_907n
      }
    });
    const cases = [
      ["finance", "/payments/ledger-export?view=formal_ledger&keyword=幕墙",
        { "申请金额（元）": "90071992547409.93" }],
      ["staffA", "/spot-procurements/ledger-export?keyword=LK-421B-A",
        { "预计金额（元）": "1234567890123456.7891" }],
      ["staffA", "/general-procurements/ledger-export?keyword=ZHCG-421B-PRECISION",
        { "预计金额（元）": generalEstimate }],
      ["manager", "/expense-claims/ledger-export?keyword=差旅",
        {
          "申请金额（元）": "90071992547409.99",
          "已付款/冲销（元）": "90071992547409.93",
          "待付金额（元）": "90071992547409.07"
        }]
    ] as const;
    for (const [actor, endpoint, amounts] of cases) {
      const exported = await callWorkbook(actor, endpoint);
      expect(exported.status).toBe(200);
      const sheet = exported.sheet!;
      const headers = headersOf(sheet);
      expect(sheet.rowCount).toBe(3);
      for (const [header, expected] of Object.entries(amounts)) {
        const column = headers.indexOf(header) + 1;
        for (const row of [2, 3]) {
          const cell = sheet.getRow(row).getCell(column);
          expect(cell.value).toBe(expected);
          expect(cell.numFmt).toBe("@");
        }
      }
    }
  });
});

import { hash } from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as ExcelJS from "exceljs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";

const run =
  process.env.ISSUE421_LEDGER_RUN === "1" ? describe : describe.skip;

/**
 * #421a 真库证据（真实 PostgreSQL 16 + 真实 Nest HTTP）：
 *
 * 1) 正式结算台账只读已复核 `SignedContractSettlement`，草稿/待复核不进入；
 * 2) 跨项目按可见范围合并，项目/日期/关键字筛选作用于全部可见记录；
 * 3) 导出与列表筛选完全一致，且逐行可见性不因导出绕过；
 * 4) 金额/日期写成数值/日期单元格，文本公式前缀被转义；
 * 5) 未知合同金额保持「不设合同总价」且不写 0、不进合计。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue421-ledger-local.cjs
 */
run("issue 421a signed settlement ledger and exports on real PostgreSQL and HTTP", () => {
  jest.setTimeout(180_000);
  const password = "Issue421-Ledger-Password-01";
  const ids = {
    projectA: "i421-project-a",
    projectB: "i421-project-b",
    director: "i421-director",
    staffA: "i421-staff-a",
    finance: "i421-finance",
    outsider: "i421-outsider",
    contractA: "i421-contract-a",
    versionA: "i421-version-a",
    contractB: "i421-contract-b",
    versionB: "i421-version-b",
    signedA: "i421-signed-a",
    signedB: "i421-signed-b",
    signedPending: "i421-signed-pending"
  };
  const phones: Record<string, string> = {
    director: "13900004211",
    staffA: "13900004212",
    finance: "13900004213",
    outsider: "13900004214"
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

  const callWorkbook = async (actor: keyof typeof phones, path: string, protocol?: string) => {
    const response = await fetch(`${base}${path}`, {
      headers: {
        authorization: `Bearer ${tokens.get(actor)}`,
        ...(protocol ? { "x-contract-numeric-protocol": protocol } : {})
      }
    });
    if (response.status !== 200) return { status: response.status, sheet: null };
    const buffer = Buffer.from(await response.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return { status: response.status, sheet: workbook.worksheets[0] ?? null };
  };

  const headersOf = (sheet: ExcelJS.Worksheet) =>
    (sheet.getRow(1).values as unknown[]).slice(1) as string[];

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (
      process.env.NODE_ENV !== "test" ||
      target.hostname !== "127.0.0.1" ||
      !target.pathname.endsWith("_issue421_ledger")
    ) {
      throw new Error("ISSUE421_ISOLATED_DATABASE_REQUIRED");
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
        { id: ids.outsider, name: "项目员工丙", phone: phones.outsider, passwordHash, mustChangePassword: false, isActive: true }
      ]
    });
    await owner.project.createMany({
      data: [
        { id: ids.projectA, code: "I421-A", name: "总部综合楼", isActive: true },
        { id: ids.projectB, code: "I421-B", name: "数据中心", isActive: true }
      ]
    });
    await owner.position.createMany({
      data: [
        { key: "contract_director", name: "合同部主管" },
        { key: "finance_staff", name: "财务人员" }
      ],
      skipDuplicates: true
    });
    const positions = await owner.position.findMany({
      where: { key: { in: ["contract_director", "finance_staff"] } }
    });
    await owner.userPosition.createMany({
      data: [
        {
          userId: ids.director,
          positionId: positions.find((position) => position.key === "contract_director")!.id,
          projectId: null
        },
        {
          userId: ids.finance,
          positionId: positions.find((position) => position.key === "finance_staff")!.id,
          projectId: null
        }
      ]
    });
    await owner.projectMember.createMany({
      data: [
        { projectId: ids.projectA, userId: ids.staffA, positionKey: "contract_staff" },
        { projectId: ids.projectA, userId: ids.staffA, positionKey: "project_manager" },
        { projectId: ids.projectA, userId: ids.outsider, positionKey: "employee" }
      ]
    });

    await owner.contract.create({
      data: {
        id: ids.contractA,
        projectId: ids.projectA,
        code: "HT-421-A",
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
        amountCents: 123_450n,
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "i421-company",
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
        code: "HT-421-B",
        name: "钢材采购框架合同",
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
        amountCents: 0n,
        amountLimitType: "unlimited",
        pricingNature: "framework",
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "i421-company",
        companyEntityNameSnapshot: "四川建工智管建筑工程有限公司",
        draftData: {},
        templateSnapshot: {},
        clauseSnapshot: {}
      }
    });

    await owner.signedContractSettlement.createMany({
      data: [
        {
          id: ids.signedA,
          projectId: ids.projectA,
          contractKind: "downstream",
          contractId: ids.contractA,
          ownerUserId: ids.staffA,
          number: "JS-421-A",
          amountYuan: new Prisma.Decimal("100.0000"),
          state: "confirmed",
          submittedAt: new Date("2026-11-20T00:30:00.000Z"),
          reviewedAt: new Date("2026-11-20T01:30:00.000Z"),
          reviewedByUserId: ids.director,
          confirmationNo: 1n,
          confirmedContractSource: {
            relationship: "inside",
            sourceRecordId: ids.versionA,
            sourceVersion: 1,
            contractTypeKey: "labor_subcontract",
            name: "幕墙分包合同",
            signingParty: "四川建工智管建筑工程有限公司",
            counterparty: "=HYPERLINK(\"http://evil.example\")",
            payerKind: "participating_company"
          }
        },
        {
          id: ids.signedB,
          projectId: ids.projectB,
          contractKind: "outside_fact",
          contractId: ids.contractB,
          ownerUserId: ids.director,
          number: "JS-421-B",
          amountYuan: new Prisma.Decimal("25.5000"),
          state: "confirmed",
          submittedAt: new Date("2026-11-19T00:30:00.000Z"),
          reviewedAt: new Date("2026-11-19T01:30:00.000Z"),
          reviewedByUserId: ids.director,
          confirmationNo: 1n,
          confirmedContractSource: {
            relationship: "outside",
            sourceRecordId: "i421-outside-b",
            sourceVersion: 1,
            name: "表外机械租赁合同",
            signingParty: "施工企业",
            counterparty: "设备租赁公司",
            payerKind: "construction_enterprise"
          }
        },
        {
          id: ids.signedPending,
          projectId: ids.projectA,
          contractKind: "downstream",
          contractId: ids.contractA,
          ownerUserId: ids.staffA,
          number: "JS-421-PENDING",
          amountYuan: new Prisma.Decimal("50.0000"),
          state: "pending_review",
          submittedAt: new Date("2026-11-21T00:30:00.000Z")
        }
      ]
    });

    await Promise.all([
      login("director"),
      login("staffA"),
      login("finance"),
      login("outsider")
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
  });

  it("only puts confirmed signed settlements into the formal ledger", async () => {
    const director = await callJson("director", "/settlements/signed-ledger");
    expect(director.status).toBe(200);
    const numbers = director.body.rows.map((row: { settlementNo: string }) => row.settlementNo);
    expect(numbers).toEqual(["JS-421-A", "JS-421-B"]);
    expect(numbers).not.toContain("JS-421-PENDING");
    expect(director.body.summary).toMatchObject({
      total: 2,
      knownAmountRows: 2,
      unknownAmountRows: 0,
      totalAmountYuan: "125.5000"
    });
  });

  it("merges visible projects and enforces row-level visibility", async () => {
    const staff = await callJson("staffA", "/settlements/signed-ledger");
    expect(staff.status).toBe(200);
    expect(staff.body.rows.map((row: { settlementNo: string }) => row.settlementNo)).toEqual([
      "JS-421-A"
    ]);

    const finance = await callJson("finance", "/settlements/signed-ledger");
    expect(finance.status).toBe(200);
    expect(
      finance.body.rows.map((row: { settlementNo: string }) => row.settlementNo).sort()
    ).toEqual(["JS-421-A", "JS-421-B"]);

    const outsider = await callJson("outsider", "/settlements/signed-ledger");
    expect(outsider.status).toBe(200);
    expect(outsider.body.rows).toEqual([]);
  });

  it("filters the whole visible ledger by project, date, status and keyword", async () => {
    const byProject = await callJson(
      "director",
      `/settlements/signed-ledger?projectId=${ids.projectB}`
    );
    expect(byProject.body.rows.map((row: { settlementNo: string }) => row.settlementNo)).toEqual([
      "JS-421-B"
    ]);

    const byDate = await callJson(
      "director",
      "/settlements/signed-ledger?dateFrom=2026-11-20&dateTo=2026-11-20"
    );
    expect(byDate.body.rows.map((row: { settlementNo: string }) => row.settlementNo)).toEqual([
      "JS-421-A"
    ]);

    const byKeyword = await callJson("director", "/settlements/signed-ledger?keyword=机械");
    expect(byKeyword.body.rows.map((row: { settlementNo: string }) => row.settlementNo)).toEqual([
      "JS-421-B"
    ]);

    const byStatus = await callJson("director", "/settlements/signed-ledger?status=表外合同");
    expect(byStatus.body.rows.map((row: { settlementNo: string }) => row.settlementNo)).toEqual([
      "JS-421-B"
    ]);
  });

  it("exports the same filtered rows with numeric amount, date and escaped text", async () => {
    const listed = await callJson("staffA", "/settlements/signed-ledger?keyword=幕墙");
    const exported = await callWorkbook(
      "staffA",
      "/settlements/signed-ledger-export?keyword=幕墙"
    );
    expect(exported.status).toBe(200);
    const sheet = exported.sheet!;
    const headers = headersOf(sheet);
    const index = (header: string) => headers.indexOf(header) + 1;
    expect(sheet.getRow(2).getCell(index("结算编号")).value).toBe(
      listed.body.rows[0].settlementNo
    );
    expect(sheet.getRow(3).getCell(1).value).toBe("合计（不含待确定金额）");
    const money = sheet.getRow(2).getCell(index("结算金额（元）"));
    expect(money.value).toBe(100);
    expect(money.numFmt).toBe("#,##0.0000");
    const date = sheet.getRow(2).getCell(index("复核日期"));
    expect(date.value).toBeInstanceOf(Date);
    expect((date.value as Date).toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(sheet.getRow(2).getCell(index("相对方（乙方）")).value).toBe(
      "'=HYPERLINK(\"http://evil.example\")"
    );
    expect(sheet.getRow(2).getCell(index("项目")).value).toBe("总部综合楼");
  });

  it("does not let exports bypass row-level visibility", async () => {
    const staff = await callWorkbook("staffA", "/settlements/signed-ledger-export");
    expect(staff.status).toBe(200);
    const sheet = staff.sheet!;
    const numbers = [2, 3]
      .map((rowNumber) => sheet.getRow(rowNumber).getCell(1).value)
      .filter((value) => typeof value === "string" && value.startsWith("JS-"));
    expect(numbers).toEqual(["JS-421-A"]);

    const outsider = await callWorkbook("outsider", "/settlements/signed-ledger-export");
    expect(outsider.status).toBe(403);
  });

  it("exports filtered contracts and preserves original amounts in contract and settlement workbooks", async () => {
    const fixed = await callWorkbook("director", "/contracts/ledger-export?keyword=幕墙");
    expect(fixed.status).toBe(200);
    const fixedHeaders = headersOf(fixed.sheet!);
    const fixedIndex = (header: string) => fixedHeaders.indexOf(header) + 1;
    const fixedSheet = fixed.sheet!;
    expect(fixedSheet.getRow(2).getCell(fixedIndex("合同编号")).value).toBe("HT-421-A");
    expect(fixedSheet.getRow(2).getCell(fixedIndex("签约方（甲方）")).value).toBe(
      "四川建工智管建筑工程有限公司"
    );
    expect(fixedSheet.getRow(2).getCell(fixedIndex("合同金额（元）")).value).toBe(1234.5);
    expect(fixedSheet.getRow(2).getCell(fixedIndex("合同金额（元）")).numFmt).toBe(
      "#,##0.0000"
    );
    expect(fixedSheet.getRow(2).getCell(fixedIndex("更新时间")).value).toBeInstanceOf(Date);
    expect(fixedSheet.getRow(2).getCell(fixedIndex("相对方（乙方）")).value).toBe(
      "'=HYPERLINK(\"http://evil.example\")"
    );

    const framework = await callWorkbook("director", "/contracts/ledger-export?keyword=框架");
    expect(framework.status).toBe(200);
    const frameworkHeaders = headersOf(framework.sheet!);
    const frameworkMoney = frameworkHeaders.indexOf("合同金额（元）") + 1;
    expect(framework.sheet!.getRow(2).getCell(frameworkMoney).value).toBe("不设合同总价");
    // 全部金额未知时合计保持空白，不写 0。
    expect(framework.sheet!.getRow(3).getCell(frameworkMoney).value).toBeNull();

    const scope = "scope=formal_ledger&keyword=合同&sort=contractNo:asc";
    const list = await callJson("director", `/contracts/lifecycle-ledger?${scope}&pageSize=1&page=2`);
    expect(list).toMatchObject({
      status: 200,
      body: { rows: [{ contractNo: "HT-421-B" }], meta: { total: 2, totalPages: 2 } }
    });
    const formal = await callWorkbook("director", `/contracts/ledger-export?${scope}`);
    expect(formal.status).toBe(200);
    const codeColumn = headersOf(formal.sheet!).indexOf("合同编号") + 1;
    expect([2, 3].map(row => formal.sheet!.getRow(row).getCell(codeColumn).value)).toEqual(["HT-421-A", "HT-421-B"]);

    const limited = await callJson("staffA", "/contracts/lifecycle-ledger?scope=formal_ledger&keyword=框架");
    expect(limited).toMatchObject({ status: 200, body: { rows: [], meta: { total: 0 } } });
    const limitedExport = await callWorkbook("staffA", "/contracts/ledger-export?scope=formal_ledger&keyword=框架");
    expect(limitedExport.status).toBe(200);
    expect(limitedExport.sheet!.rowCount).toBeLessThanOrEqual(2);

    const amountYuan = "1234567890123456.7890";
    await owner.contractVersion.update({
      where: { id: ids.versionA },
      data: {
        numericProtocolVersion: 2,
        amountCents: 123_456_789_012_345_679n,
        amountYuan: new Prisma.Decimal(amountYuan)
      }
    });
    await owner.signedContractSettlement.update({
      where: { id: ids.signedA },
      data: { amountYuan: new Prisma.Decimal(amountYuan) }
    });
    const cases = [
      ["director", "/contracts/ledger-export?keyword=幕墙", "合同金额（元）", "2"],
      ["staffA", "/settlements/signed-ledger-export?keyword=幕墙", "结算金额（元）"]
    ] as const;
    for (const [actor, endpoint, header, protocol] of cases) {
      const exported = await callWorkbook(actor, endpoint, protocol);
      expect(exported.status).toBe(200);
      const sheet = exported.sheet!;
      const column = headersOf(sheet).indexOf(header) + 1;
      expect(sheet.rowCount).toBe(3);
      for (const row of [2, 3]) {
        const cell = sheet.getRow(row).getCell(column);
        expect(cell.value).toBe(amountYuan);
        expect(cell.numFmt).toBe("@");
      }
    }
  });
});

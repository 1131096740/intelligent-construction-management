"use strict";

// #423 real PostgreSQL 16 + HTTP verification.
//
// Proves, against the real backend, that:
// 1. the position → fixed-entry matrix in @jiangkong/shared-domain matches what
//    the Nest Guard actually allows (no over-privilege, dual positions union);
// 2. /me/work-items action groups count real pending work items and every item
//    carries an actionGroup.
//
// The schema is created with `prisma db push` from schema.prisma (no migration
// replay) inside a disposable local container owned by this process.
const test = require("node:test");
const assert = require("node:assert/strict");
const { hash } = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { Test } = require("@nestjs/testing");
const { visibleNavigationEntryKeys } = require("@jiangkong/shared-domain");
const { AppModule } = require("../dist/app.module");
const { apiJsonReplacer } = require("../dist/api-json-replacer");
const { createApiValidationPipe } = require("../dist/validation/api-validation");

const password = "Issue423-Real-Db-Password-01";
const ids = {
  project: "i423-project",
  contract: "i423-contract",
  version: "i423-version",
  terms: "i423-terms",
  payment: "i423-payment",
  approval: "i423-approval"
};
const users = {
  employee: "i423-employee",
  contract: "i423-contract-staff",
  finance: "i423-finance-staff",
  dual: "i423-dual",
  comprehensive: "i423-comprehensive",
  chairman: "i423-chairman",
  superAdmin: "i423-super-admin",
  financeDirector: "i423-finance-director"
};
const actorByName = Object.fromEntries(
  Object.entries(users).map(([name, id]) => [id, name])
);
const phones = {
  employee: "13900423001",
  contract: "13900423002",
  finance: "13900423003",
  dual: "13900423004",
  comprehensive: "13900423005",
  chairman: "13900423006",
  superAdmin: "13900423007",
  financeDirector: "13900423008"
};
const tokens = new Map();
const roleScopes = new Map();

let app;
let owner;
let base;

async function login(actor) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: phones[actor], password })
  });
  assert.equal(response.status, 201, `login ${actor}`);
  const body = await response.json();
  tokens.set(actor, body.tokens.accessToken);
  roleScopes.set(actor, {
    roleKeys: body.user.roleKeys,
    globalRoleKeys: body.user.globalRoleKeys
  });
}

async function call(actor, path) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${tokens.get(actor)}` }
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function entryKeys(actor) {
  const scope = roleScopes.get(actor);
  return new Set(visibleNavigationEntryKeys(scope.roleKeys, scope.globalRoleKeys));
}

test.before(async () => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.NODE_ENV !== "test" ||
    target.hostname !== "127.0.0.1" ||
    !target.pathname.endsWith("_issue423_navigation")
  ) {
    throw new Error("ISSUE423_ISOLATED_DATABASE_REQUIRED");
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
    data: Object.entries(users).map(([name, id]) => ({
      id,
      name,
      phone: phones[name],
      passwordHash,
      mustChangePassword: false,
      isActive: true
    }))
  });
  await owner.project.create({
    data: { id: ids.project, code: "I423-PROJECT", name: "隔离导航矩阵项目", isActive: true }
  });
  await owner.position.createMany({
    data: [
      "employee",
      "contract_staff",
      "finance_staff",
      "comprehensive_director",
      "chairman",
      "super_admin",
      "finance_director"
    ].map((key) => ({ key, name: key })),
    skipDuplicates: true
  });
  const positions = await owner.position.findMany({
    where: {
      key: {
        in: [
          "contract_staff",
          "finance_staff",
          "comprehensive_director",
          "chairman",
          "super_admin",
          "finance_director"
        ]
      }
    }
  });
  const positionId = (key) => positions.find((position) => position.key === key).id;
  await owner.userPosition.createMany({
    data: [
      { userId: users.contract, positionId: positionId("contract_staff"), projectId: null },
      { userId: users.finance, positionId: positionId("finance_staff"), projectId: null },
      { userId: users.dual, positionId: positionId("contract_staff"), projectId: null },
      { userId: users.dual, positionId: positionId("finance_staff"), projectId: null },
      { userId: users.comprehensive, positionId: positionId("comprehensive_director"), projectId: null },
      { userId: users.chairman, positionId: positionId("chairman"), projectId: null },
      { userId: users.superAdmin, positionId: positionId("super_admin"), projectId: null },
      { userId: users.financeDirector, positionId: positionId("finance_director"), projectId: null }
    ]
  });
  await owner.projectMember.create({
    data: { projectId: ids.project, userId: users.employee, positionKey: "employee" }
  });

  await owner.contract.create({
    data: {
      id: ids.contract,
      projectId: ids.project,
      code: "HT-I423-001",
      name: "隔离导航矩阵合同",
      counterparty: "隔离供应商",
      companyEntityName: "四川建工智管建筑工程有限公司"
    }
  });
  await owner.contractVersion.create({
    data: {
      id: ids.version,
      contractId: ids.contract,
      versionNo: 1,
      changeType: "initial",
      status: "effective",
      amountCents: 1_000_000n,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await owner.paymentTermsVersion.create({
    data: {
      id: ids.terms,
      contractId: ids.contract,
      contractVersionId: ids.version,
      versionNo: 1,
      status: "effective",
      originalText: "按进度付款"
    }
  });
  await owner.paymentRequest.create({
    data: {
      id: ids.payment,
      projectId: ids.project,
      contractId: ids.contract,
      contractVersionId: ids.version,
      paymentTermsVersionId: ids.terms,
      code: "FK-I423-001",
      status: "approval_pending",
      requestedAmountCents: 120_000n,
      approvedAmountCents: null,
      paidAmountCents: 0n,
      sourceType: "contract_advance",
      paymentMatter: "隔离真库分组付款"
    }
  });
  await owner.approvalInstance.create({
    data: {
      id: ids.approval,
      flowType: "payment.approve",
      businessType: "payment_request",
      businessId: ids.payment,
      status: "in_progress",
      currentNodeIndex: 0,
      applicantUserId: users.employee,
      frozenNodes: [
        {
          name: "财务主管",
          mode: "any",
          roleKeys: ["finance_director"],
          approvedRoleKeys: [],
          protocolVersion: 1,
          executionMode: "parallel"
        }
      ]
    }
  });

  for (const actor of Object.keys(users)) await login(actor);
});

test.after(async () => {
  await app?.close();
  await owner?.$disconnect();
});

test("each position sees the fixed entries derived from backend capabilities", () => {
  const expectations = {
    employee: {
      present: ["home", "contract_workbench", "ledger_contract", "spot_procurement_workbench"],
      absent: ["archives", "audit_logs", "employee_management", "fund_account", "project_workbench", "wage_assumption"]
    },
    contract: {
      present: ["contract_workbench", "historical_contract_takeover", "archives", "correction_center"],
      absent: ["audit_logs", "employee_management", "fund_account", "wage_assumption", "project_workbench"]
    },
    finance: {
      present: ["fund_account", "fund_handling_workbench", "wage_assumption", "payable_settlement_workbench", "project_workbench"],
      absent: ["audit_logs", "employee_management"]
    },
    comprehensive: {
      present: ["fund_account", "fund_handling_workbench", "company_transfer_ledger", "other_project_payment", "employee_management"],
      absent: ["audit_logs", "contract_template_library", "fund_execution_cases"]
    },
    chairman: {
      present: ["audit_logs", "archives", "employee_management", "company_entity"],
      absent: []
    },
    superAdmin: {
      present: ["audit_logs", "employee_management"],
      absent: ["wage_assumption", "payable_settlement_workbench", "fund_handling_workbench", "company_entity"]
    },
    financeDirector: {
      present: ["audit_logs", "fund_account", "payable_settlement_workbench", "employee_management"],
      absent: []
    }
  };
  for (const [actor, expectation] of Object.entries(expectations)) {
    const keys = entryKeys(actor);
    for (const key of expectation.present) assert.ok(keys.has(key), `${actor} missing ${key}`);
    for (const key of expectation.absent) assert.ok(!keys.has(key), `${actor} must not see ${key}`);
  }
});

test("navigation visibility matches real backend guards (no over-privilege)", async () => {
  assert.equal((await call("contract", "/contracts")).status, 200);
  assert.equal((await call("employee", "/contracts")).status, 200);

  const cases = [
    { entry: "archives", path: "/archives", allow: "contract", deny: ["employee", "comprehensive"] },
    { entry: "audit_logs", path: "/audit-logs", allow: "chairman", deny: ["contract", "finance", "dual"] },
    { entry: "employee_management", path: "/organization/directory", allow: "chairman", deny: ["finance", "employee"] },
    { entry: "fund_account", path: "/fund-accounts", allow: "finance", deny: ["contract", "employee"] },
    {
      entry: "project_workbench",
      path: `/projects/${ids.project}/operating-funds-overview`,
      allow: "finance",
      deny: ["contract", "employee"]
    }
  ];
  for (const item of cases) {
    const allowed = await call(item.allow, item.path);
    assert.equal(allowed.status, 200, `${item.path} should allow ${item.allow}`);
    assert.ok(entryKeys(item.allow).has(item.entry), `${item.allow} should see ${item.entry}`);
    for (const actor of item.deny) {
      const denied = await call(actor, item.path);
      assert.equal(denied.status, 403, `${item.path} must deny ${actor}`);
      assert.ok(!entryKeys(actor).has(item.entry), `${actor} must not see ${item.entry}`);
    }
  }
});

test("dual positions union the entries without duplicates or extra privilege", async () => {
  const finance = visibleNavigationEntryKeys(
    roleScopes.get("finance").roleKeys,
    roleScopes.get("finance").globalRoleKeys
  );
  const contract = visibleNavigationEntryKeys(
    roleScopes.get("contract").roleKeys,
    roleScopes.get("contract").globalRoleKeys
  );
  const dual = visibleNavigationEntryKeys(
    roleScopes.get("dual").roleKeys,
    roleScopes.get("dual").globalRoleKeys
  );
  assert.equal(new Set(dual).size, dual.length);
  const expectedUnion = new Set([...finance, ...contract]);
  assert.equal(dual.length, expectedUnion.size);
  for (const key of dual) assert.ok(expectedUnion.has(key));
  const dualKeys = new Set(dual);
  assert.ok(dualKeys.has("fund_account"));
  assert.ok(dualKeys.has("archives"));
  assert.ok(!dualKeys.has("audit_logs"));
  assert.ok(!dualKeys.has("employee_management"));

  assert.equal((await call("dual", "/archives")).status, 200);
  assert.equal((await call("dual", "/fund-accounts")).status, 200);
  assert.equal((await call("dual", "/audit-logs")).status, 403);
});

test("work item action groups count real pending items", async () => {
  const response = await call("financeDirector", "/me/work-items");
  assert.equal(response.status, 200);
  const workItems = response.body;
  assert.ok(Array.isArray(workItems.queues.pending));
  assert.ok(workItems.queues.pending.length >= 1);
  for (const item of workItems.queues.pending) {
    assert.ok(item.actionGroup, `pending ${item.id} is missing actionGroup`);
  }
  const approvalItems = workItems.queues.pending.filter((item) => item.actionGroup === "approval");
  assert.ok(approvalItems.length >= 1);
  const approvalGroup = (workItems.groups ?? []).find((group) => group.key === "approval");
  assert.ok(approvalGroup, "approval group is missing");
  assert.equal(approvalGroup.count, approvalItems.length);
  assert.equal(approvalGroup.title, "待审批");
  assert.equal(approvalGroup.targetPath, "/审批中心?view=pendingApproval");
  assert.ok(approvalGroup.items.length >= 1);
  assert.equal(approvalGroup.items[0].actionGroup, "approval");

  const employee = await call("employee", "/me/work-items");
  assert.equal(employee.status, 200);
  for (const group of employee.body.groups ?? []) {
    assert.ok(group.count > 0);
    assert.equal(group.items.length, Math.min(3, group.count));
  }
});

test("the same person is never exposed twice in the resolved matrix", () => {
  const dual = visibleNavigationEntryKeys(
    roleScopes.get("dual").roleKeys,
    roleScopes.get("dual").globalRoleKeys
  );
  assert.equal(new Set(dual).size, dual.length);
});

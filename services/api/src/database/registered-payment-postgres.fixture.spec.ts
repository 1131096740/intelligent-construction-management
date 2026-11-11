import { Prisma } from "@prisma/client";
import { assertRegisteredPgConnectedRoles, buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import type { RegisteredPgExecutionContext } from "./registered-payment-postgres.fixture";
import * as registeredCases from "./registered-payment-postgres.cases";

function fixture() {
  const runId = "da49e313-e3da-407f-b279-3d09caecfc3e";
  const proof = {
    authorizationReference: "synthetic-identity-protocol-only",
    runId: "da49e313e3da", resourceRunId: runId,
    databaseName: `jg_task01_${runId.replaceAll("-", "")}`,
    databaseOid: "12345", systemIdentifier: "7234567890123456789",
    host: "127.0.0.1", port: 15432,
    ownerRole: "jg_task01_owner", runtimeRole: "jg_task01_runtime", observerRole: "jg_task01_observer",
    sourceSealSha256: "a".repeat(64),
    preparedSqlSha256: Object.fromEntries(["registered-funding.sql", "registered-history-revision.sql", "registered-write-authority.sql", "registered-canonical-proof.sql", "registered-intercompany.sql", "registered-canonical-adapter.sql", "registered-voucher.sql"].map(name => [name, "b".repeat(64)])),
    transport: "isolated-loopback-tls-verify-full",
    application: { origin: "http://127.0.0.1:15433/", databaseRole: "jg_task01_runtime", sourceSealSha256: "a".repeat(64), notificationAdapter: "disabled", fileStorage: "dedicated-private-local" }
  };
  const sessions = [proof.ownerRole, proof.runtimeRole, proof.observerRole].map((role, index) => ({
    database: proof.databaseName, effectiveRole: role, loginRole: role,
    databaseOid: proof.databaseOid, systemIdentifier: proof.systemIdentifier,
    pid: 100 + index, version: "160004", replication: "origin", tls: true,
    readOnly: index === 2 ? "on" : "off"
  }));
  const privileges = [proof.runtimeRole, proof.observerRole].map(role => ({ role, unsafe: false, canWrite: role === proof.runtimeRole }));
  const calls: Array<{ role: string; sql: string; values: unknown[] }> = [];
  const clients = sessions.map(session => ({
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
      calls.push({ role: session.loginRole, sql, values });
      if (sql.includes("current_database()")) return [session];
      if (sql.includes("pg_roles")) return privileges;
      if (sql.includes("pg_proc")) return ["jg_registered_history_read_revision", "jg_registered_history_lock_revision", "jg_registered_operating_scope_lock", "jg_registered_payment_projection_deferred"].map(name => ({ name, owner: proof.ownerRole, definer: name !== "jg_registered_payment_projection_deferred", config: ["search_path=pg_catalog, public, pg_temp"] }));
      if (sql.includes("pg_trigger")) return ["OperatingFact_registered_payment_complete", "OperatingImpactEntry_registered_payment_complete"].map(name => ({ name, deferrable: true, deferred: true, enabled: "O", kind: 5, correctFunction: true }));
      throw new Error("Unexpected SQL protocol request");
    }
  }));
  const context = { proof, owner: clients[0], runtime: clients[1], observer: clients[2], password: "synthetic-credential-only", httpTimeoutMs: 1000 } as unknown as RegisteredPgExecutionContext;
  return { context, proof, sessions, privileges, calls };
}

describe("registered PG fixture: dedicated TLS session identity protocol (no connections)", () => {
  it("accepts three independent resource-bound TLS roles, with a separate read-only observer", async () => {
    const f = fixture();
    await expect(assertRegisteredPgConnectedRoles(f.context)).resolves.toEqual({ database: f.proof.databaseName, ownerPid: 100, runtimePid: 101, observerPid: 102 });
  });

  it.each([
    ["TLS", { tls: false }, "PG_RESOURCE_DATABASE_VERSION"],
    ["database", { database: "foreign_database" }, "PG_RESOURCE_DATABASE_VERSION"],
    ["database oid", { databaseOid: "54321" }, "PG_RESOURCE_DATABASE_VERSION"],
    ["cluster", { systemIdentifier: "8234567890123456789" }, "PG_RESOURCE_DATABASE_VERSION"],
    ["replication bypass", { replication: "replica" }, "PG_RESOURCE_DATABASE_VERSION"],
    ["server version", { version: "150004" }, "PG_RESOURCE_DATABASE_VERSION"],
    ["effective role", { effectiveRole: "jg_task01_owner" }, "PG_RESOURCE_ROLE_PID_BINDING"],
    ["login role", { loginRole: "unbound_login" }, "PG_RESOURCE_ROLE_PID_BINDING"]
  ])("rejects a runtime %s mismatch", async (_label, patch, error) => {
    const f = fixture(); Object.assign(f.sessions[1]!, patch);
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow(error as string);
  });

  it("rejects an observer using runtime credentials even when it is in a read-only transaction", async () => {
    const f = fixture(); f.sessions[2]!.effectiveRole = f.proof.runtimeRole; f.sessions[2]!.loginRole = f.proof.runtimeRole;
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_ROLE_PID_BINDING");
  });

  it("rejects the declared observer=runtime role before querying any client", async () => {
    const f = fixture(); f.proof.observerRole = f.proof.runtimeRole;
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_ROLE_SEPARATION");
    expect(f.calls).toHaveLength(0);
  });

  it("rejects an observer whose session permits writes", async () => {
    const f = fixture(); f.sessions[2]!.readOnly = "off";
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_OBSERVER_READ_ONLY");
  });

  it("rejects an observer with effective write capability even if its current session is read-only", async () => {
    const f = fixture(); f.privileges[1]!.canWrite = true;
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_OBSERVER_PRIVILEGES");
  });

  it.each([0, 1])("rejects unsafe effective privileges of restricted role %s", async index => {
    const f = fixture(); f.privileges[index]!.unsafe = true;
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_RUNTIME_PRIVILEGES");
  });

  it("rejects two client objects reaching the same actual backend", async () => {
    const f = fixture(); f.sessions[2]!.pid = f.sessions[1]!.pid;
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_ROLE_PID_BINDING");
  });

  it("rechecks changed actual session identity on every invocation after reconnect", async () => {
    const f = fixture(); await assertRegisteredPgConnectedRoles(f.context);
    f.sessions[2]!.pid = 202;
    await expect(assertRegisteredPgConnectedRoles(f.context)).resolves.toMatchObject({ observerPid: 202 });
    f.sessions[2]!.systemIdentifier = "8234567890123456789";
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_DATABASE_VERSION");
  });

  it("binds the full owned resource UUID independently from the short fixture key", async () => {
    const f = fixture(); f.proof.resourceRunId = "ea49e313-e3da-407f-b279-3d09caecfc3e";
    await expect(assertRegisteredPgConnectedRoles(f.context)).rejects.toThrow("PG_RESOURCE_DATABASE");
    expect(f.calls).toHaveLength(0);
  });
});

describe("registered PG original case: explicit observer projection protocol (no HTTP/PG)", () => {
  it.each(["normal", "response-loss", "upstream-failure", "absent-db-fact", "cancel-commit", "cancel-changed-ledger", "cancel-orphan-impact", "cancel-fake-success", "cancel-settlement-status",
      "cancel-settlement-updated-at", "cancel-request-updated-at", "cancel-owner-role", "cancel-owner-pid", "cancel-owner-start", "cancel-owner-method", "cancel-owner-getter"])(
    "verifies the %s case through only the approved observer columns", async scenario => {
    const f = fixture();
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    const { ids } = plan;
    const prepared = { plan, accessToken: "synthetic-only", companyARegistrationId: "registration-a", companyBRegistrationId: "registration-b", companyBSourceId: "source-b" };
    let recorded = false;
    let orphanImpact = false;
    let submittedCancellation = false;
    let ownerReads = 0;
    let ownerGetterReads = 0;
    Object.assign(f.context.owner, { $transaction: async (operation: (client: unknown) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ isolationLevel: "RepeatableRead" });
      let readOnly = false;
      return operation({
        $executeRawUnsafe: async (sql: string) => { expect(sql).toBe("SET TRANSACTION READ ONLY"); readOnly = true; },
        $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
          expect(readOnly).toBe(true);
          expect(sql).toContain('s."status"');
          expect(values).toEqual([ids.settlement, ids.payment]);
          ownerReads++;
          const after = (name: string) => submittedCancellation && scenario === name;
          return [{
            database: f.proof.databaseName, databaseOid: f.proof.databaseOid, systemIdentifier: f.proof.systemIdentifier,
            effectiveRole: after("cancel-owner-role") ? f.proof.runtimeRole : f.proof.ownerRole,
            loginRole: f.proof.ownerRole, ownerOid: "10", pid: after("cancel-owner-pid") ? 999 : 100,
            startedAt: after("cancel-owner-start") ? "2026-11-07T00:00:00.000002Z" : "2026-11-07T00:00:00.000001Z",
            tls: true, readOnly: "on", isolation: "repeatable read",
            settlementStatus: after("cancel-settlement-status") ? "paid" : "approved",
            settlementUpdatedAt: after("cancel-settlement-updated-at") ? "2026-11-07T00:00:00.001000Z" : "2026-11-07T00:00:00.000000Z",
            requestUpdatedAt: after("cancel-request-updated-at") ? "2026-11-07T00:00:00.001000Z" : "2026-11-07T00:00:00.000000Z"
          }];
        }
      });
    } });
    const reads = new Set<string>();
    const allowed: Record<string, string[]> = {
      paymentRequest: ["approvedAmountCents", "paidAmountCents", "status"],
      settlement: ["payableAmountCents", "paidAmountCents"],
      paymentExecution: ["id", "idempotencyKey", "amountCents", "paymentRequestId", "voucherFileId"],
      registeredPaymentFunding: ["executionId", "operatingLedgerEffectiveDateAtRegistration", "actualPayerId", "actualPayerKind"],
      registeredFundPaymentAllocation: ["executionId", "accountId", "sourceBatchId", "amountCents"],
      registeredPaymentEvent: ["executionId"],
      interEntityRelationshipEntry: ["id", "paymentExecutionId", "sourceType", "entryKind", "direction", "status", "originalDebtorCompanyId", "creditorCompanyId", "amountCents", "projectId"],
      operatingFact: ["id"], operatingImpactEntry: ["id"],
      auditLog: ["actorUserId", "metadata"],
      fundAccountBalanceRegistration: ["accountId", "balanceYuan", "coveredExecutionIds"]
    };
    function rows(model: string, where: Record<string, unknown>) {
      if (model === "paymentRequest") return [{ approvedAmountCents: 10000n, paidAmountCents: recorded ? 4000n : 0n, status: recorded ? "partially_paid" : "approved_pending_payment" }];
      if (model === "settlement") return [{ payableAmountCents: 10000n, paidAmountCents: recorded ? 4000n : 0n }];
      if (model === "fundAccountBalanceRegistration") return [{ accountId: where.id === "registration-a" ? "account-a" : "account-b", balanceYuan: new Prisma.Decimal("100"), coveredExecutionIds: [] }];
      if (model === "operatingImpactEntry" && orphanImpact && where.sourceBusinessId === undefined) return [{ id: "orphan-impact" }];
      if (!recorded) return [];
      if (model === "paymentExecution") return [{ id: "execution-one", idempotencyKey: ids.requestKey, amountCents: 4000n, paymentRequestId: ids.payment, voucherFileId: null }];
      if (model === "registeredPaymentFunding") return [{ executionId: "execution-one", operatingLedgerEffectiveDateAtRegistration: null, actualPayerId: ids.companyB, actualPayerKind: "participating_company" }];
      if (model === "registeredFundPaymentAllocation") return [{ executionId: "execution-one", accountId: "account-b", sourceBatchId: "source-b", amountCents: 4000n }];
      if (model === "registeredPaymentEvent") return [{ executionId: "execution-one" }];
      if (model === "interEntityRelationshipEntry") return [{ id: "root-one", paymentExecutionId: "execution-one", sourceType: "registered_payment_execution", entryKind: "proxy_payment", direction: "increase", status: "confirmed", originalDebtorCompanyId: ids.companyA, creditorCompanyId: ids.companyB, amountCents: 4000n, projectId: ids.project }];
      if (model === "auditLog") return [{ actorUserId: ids.actor, metadata: { voucherFileId: null, voucherPending: true, actualPayer: { kind: "participating_company", id: ids.companyB } } }];
      return [];
    }
    const observer = Object.fromEntries(Object.keys(allowed).map(model => {
      const read = async (input: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        if (!input.select) throw new Error("OBSERVER_SELECT_REQUIRED");
        const columns = Object.keys(input.select);
        if (!columns.length || columns.some(column => !allowed[model]!.includes(column) || input.select![column] !== true)) throw new Error("OBSERVER_COLUMN_DENIED");
        reads.add(model);
        return rows(model, input.where).map(row => Object.fromEntries(columns.map(column => [column, (row as Record<string, unknown>)[column]])));
      };
      return [model, { findMany: read, findUniqueOrThrow: async (input: Parameters<typeof read>[0]) => (await read(input))[0] }];
    }));
    Object.assign(observer, { $executeRawUnsafe: async (sql: string) => { expect(sql).toBe("SET TRANSACTION READ ONLY"); } });
    Object.assign(f.context.observer, { $transaction: async (operation: (client: unknown) => Promise<unknown>) => operation(observer) });
    const responseCancellations: jest.SpyInstance[] = [];
    const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const route = new URL(String(input)).pathname;
      const respond = (status: number, body: unknown) => {
        const response = new Response(JSON.stringify(body), { status });
        Object.defineProperty(response, "url", { value: String(input) });
        return response;
      };
      if (route.endsWith("/registration-options")) return respond(200, { expectedPaymentUpdatedAt: "2026-11-07T00:00:00.000Z", remainingAmountCents: "10000", accounts: [{ scopeKey: `company:${ids.companyB}`, eligible: true }] });
      if (route.endsWith("/registrations") && init?.method === "POST") {
        if (scenario === "upstream-failure") return respond(503, {});
        if (scenario.startsWith("cancel-")) {
          submittedCancellation = true;
          if (scenario === "cancel-owner-method") {
            Object.assign(f.context.owner, { $transaction() { throw new Error("unexpected replaced owner method"); } });
          }
          if (scenario === "cancel-owner-getter") {
            const transaction = f.context.owner.$transaction;
            Object.defineProperty(f.context.owner, "$transaction", { get() { ownerGetterReads++; return transaction; } });
          }
          recorded = scenario === "cancel-changed-ledger";
          orphanImpact = scenario === "cancel-orphan-impact";
          return respond(scenario === "cancel-fake-success" ? 201 : 500, {});
        }
        recorded = scenario !== "absent-db-fact";
        const response = respond(201, {});
        responseCancellations.push(jest.spyOn(response.body!, "cancel"));
        return response;
      }
      if (route === `/payment-executions/results/${ids.requestKey}`) return respond(200, { status: "recorded", execution: { executionId: "execution-one", amountCents: "4000", paidAt: plan.paidAt }, effects: [], intercompany: [{}] });
      throw new Error("Unapproved HTTP protocol request");
    });
    try {
      const continuity = { checkLight: jest.fn(), fetch: globalThis.fetch, assertHttpRequest: jest.fn() };
      if (scenario.startsWith("cancel-")) {
        const cancel = jest.fn(async (submit: () => Promise<void>) => {
          expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(["GET"]);
          expect(reads.has("auditLog")).toBe(true);
          await submit();
        });
        const run = registeredCases.runRegisteredNullCrossCompanyCommitCancellation(f.context, prepared, continuity, cancel);
        if (scenario === "cancel-commit") {
          await expect(run).resolves.toMatchObject({caseId: "registered.null-cross-company.cancel-commit", passed: true, rollbackObserved: true});
        } else {
          const errors: Record<string, string> = {
            "cancel-fake-success": "PG_CASE_CANCEL_HTTP_STATUS",
            "cancel-owner-method": "PG_CASE_CANCEL_OWNER_CHANGED",
            "cancel-owner-getter": "PG_CASE_CANCEL_OWNER_CHANGED",
            "cancel-owner-role": "PG_CASE_CANCEL_OWNER_PROOF",
            "cancel-owner-pid": "PG_CASE_CANCEL_OWNER_PROOF"
          };
          await expect(run).rejects.toThrow(errors[scenario] ?? "PG_CASE_CANCEL_LEDGER_CHANGED");
        }
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(ownerReads).toBe(["cancel-owner-method", "cancel-owner-getter"].includes(scenario) ? 1 : 2);
        expect(ownerGetterReads).toBe(0);
        expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
        return;
      }
      const run = scenario === "normal" ? registeredCases.runRegisteredNullCrossCompanyCommit(f.context, prepared)
        : registeredCases.runRegisteredNullCrossCompanyResponseLoss(f.context, prepared, continuity);
      if (scenario === "upstream-failure" || scenario === "absent-db-fact") {
        await expect(run).rejects.toThrow(scenario === "upstream-failure" ? "PG_CASE_RESPONSE_LOSS_BOUNDARY" : "PG_CASE_COMMITTED_GRAPH_COUNTS");
        expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
      } else {
        await expect(run).resolves.toMatchObject({ caseId: scenario === "normal" ? "registered.null-cross-company.commit"
          : "registered.null-cross-company.response-loss", passed: true, executionId: "execution-one", rootId: "root-one" });
        expect([...reads].sort()).toEqual(Object.keys(allowed).sort());
        expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(scenario === "normal" ? ["GET", "POST", "POST", "GET"] : ["GET", "POST", "GET", "POST"]);
        expect(responseCancellations.map(cancel => cancel.mock.calls.length)).toEqual(scenario === "normal" ? [0, 0] : [1, 0]);
        const [original, replay] = fetch.mock.calls.filter(([, request]) => request?.method === "POST").map(([, request]) => request?.body);
        expect(JSON.parse(String(original)).idempotencyKey).toBe(ids.requestKey);
        expect(replay).toBe(original);
      }
      expect(ownerReads).toBe(0);
    } finally { fetch.mockRestore(); }
  });
});


describe("registered fixture synthetic construction enterprise plan", () => {
  it("allocates sixteen independent identities including a separate party, version and assignment", () => {
    const plan = buildRegisteredPgFixturePlan("da49e313e3da", "2026-11-07", "2026-11-01");
    expect(Object.values(plan.ids)).toHaveLength(16);
    expect(new Set(Object.values(plan.ids)).size).toBe(16);
    for (const value of Object.values(plan.ids)) expect(value).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });
});

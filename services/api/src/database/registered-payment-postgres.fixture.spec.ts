import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertRegisteredPgConnectedRoles, buildRegisteredPgFixturePlan, seedRegisteredPgFixture, seedRegisteredPgAttributionGapFixture, seedRegisteredPgCompetitionFixture, seedRegisteredPgCompetitionFollowUpFixture } from "./registered-payment-postgres.fixture";
import type { RegisteredPgExecutionContext } from "./registered-payment-postgres.fixture";
import * as registeredCases from "./registered-payment-postgres.cases";
import { payment261SeedProfile, gap261SeedProfile, competition261SeedProfile, voucher261SeedProfile, seedPayment261 } from "./registered-payment-postgres.seed261";

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
  it("records only the failed seed identity proof before the owner transaction", async () => {
    const f = fixture();
    f.sessions[2]!.readOnly = "off";
    const recordSeedFailure = jest.fn();
    const fetch = jest.fn();
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    await expect(seedRegisteredPgFixture(f.context, plan, { checkLight() {}, fetch, recordSeedFailure }))
      .rejects.toMatchObject({ code: "TASK16_FIXTURE_FAILED_CLOSED", fixtureOutcome: "NOT_ATTEMPTED" });
    expect(recordSeedFailure).toHaveBeenCalledTimes(1);
    expect(recordSeedFailure).toHaveBeenCalledWith("SEED_IDENTITY", "PG_RESOURCE_OBSERVER_READ_ONLY", undefined);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("projects an owner transaction code without exposing the SDK message", async () => {
    const f = fixture();
    const recordSeedFailure = jest.fn();
    const fetch = jest.fn();
    const transaction = jest.fn().mockRejectedValue(Object.assign(new Error("private statement"), { code: "P2028" }));
    Object.assign(f.context.owner, { $transaction: transaction });
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    await expect(seedRegisteredPgFixture(f.context, plan, { checkLight() {}, fetch, recordSeedFailure }))
      .rejects.toMatchObject({ code: "TASK16_FIXTURE_FAILED_CLOSED", fixtureOutcome: "UNKNOWN_DO_NOT_RETRY" });
    expect(recordSeedFailure).toHaveBeenCalledWith("SEED_OWNER_TRANSACTION", "P2028", undefined);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the fixed HTTP failure code and status without forwarding the body", async () => {
    const f = fixture();
    Object.assign(f.context.owner, { $transaction: jest.fn().mockResolvedValue(undefined) });
    const recordSeedFailure = jest.fn();
    const response = new Response(JSON.stringify({ message: "private body" }), { status: 403 });
    Object.defineProperty(response, "url", { value: new URL("/auth/login", f.proof.application.origin).href });
    const fetch = jest.fn().mockResolvedValue(response);
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    await expect(seedRegisteredPgFixture(f.context, plan, { checkLight() {}, fetch, recordSeedFailure }))
      .rejects.toMatchObject({ code: "TASK16_FIXTURE_FAILED_CLOSED", fixtureOutcome: "UNKNOWN_DO_NOT_RETRY" });
    expect(recordSeedFailure).toHaveBeenCalledWith("SEED_LOGIN", "PG_FIXTURE_REAL_HTTP_LOGIN", 403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("runs only the fixed two-statement 261 seed with binding %s", async bound => {
    const f = fixture();
    const calls: string[] = [];
    const query = jest.fn(async (sql: string, payload: string, database: string) => {
      calls.push("bind");
      expect(sql).toContain("$1::jsonb");
      expect(sql).toMatch(/set_config\('jg_task16.payment_seed_v1',[\s\S]+true\)/);
      expect(sql).not.toContain("synthetic-hash");
      expect(database).toBe(f.proof.databaseName);
      expect(JSON.parse(payload)).toMatchObject({ passwordHash: "synthetic-hash", phone: plan.phone, ids: plan.ids });
      return [{ bound }];
    });
    const execute = jest.fn(async (sql: string) => {
      calls.push("static-do");
      expect(sql).toContain("DO $jg_task16_seed$");
      expect(sql).toContain("PG_FIXTURE_AUTOMATIC_HISTORY_MARKER_REQUIRED");
      expect(sql).not.toContain("synthetic-hash");
      expect(sql).not.toMatch(/INSERT INTO public\."RegisteredContractHistoryRevision"|\bEXECUTE\b/);
      return 0;
    });
    const transaction = jest.fn(async (run: (tx: unknown) => Promise<void>) => run({ $queryRawUnsafe: query, $executeRawUnsafe: execute }));
    Object.assign(f.context.owner, { $transaction: transaction });
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    const run = seedPayment261(f.context.owner, f.proof.databaseName, plan, "synthetic-hash",
      "91350211M000100Y46", "91440300708461136T", () => calls.push("check"));
    if (bound) {
      await run;
      expect(calls).toEqual(["check", "check", "bind", "check", "check", "static-do", "check", "check"]);
    } else {
      await expect(run).rejects.toThrow("隔离付款种子参数绑定未通过");
      expect(execute).not.toHaveBeenCalled();
    }
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("uses the original registered HTTP login after the explicit 261 owner seed", async () => {
    const f = fixture();
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ bound: true }]), $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
    const transaction = jest.fn(async (run: (client: unknown) => Promise<void>) => run(tx));
    Object.assign(f.context.owner, { $transaction: transaction });
    const recordSeedFailure = jest.fn();
    const response = new Response(JSON.stringify({ message: "synthetic denied" }), { status: 403 });
    Object.defineProperty(response, "url", { value: new URL("/auth/login", f.proof.application.origin).href });
    const fetch = jest.fn().mockResolvedValue(response);
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    await expect(seedRegisteredPgFixture(f.context, plan, { checkLight() {}, fetch, recordSeedFailure, seedProfile: payment261SeedProfile }))
      .rejects.toMatchObject({ code: "TASK16_FIXTURE_FAILED_CLOSED", fixtureOutcome: "UNKNOWN_DO_NOT_RETRY" });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(recordSeedFailure).toHaveBeenCalledWith("SEED_LOGIN", "PG_FIXTURE_REAL_HTTP_LOGIN", 403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([gap261SeedProfile, competition261SeedProfile, voucher261SeedProfile, "follow-up" as const])(
    "retains the original login and opening protocol for %s after exactly two owner statements", async profile => {
      const f = fixture();
      const contender = fixture();
      contender.sessions[1]!.pid = 201;
      const second = { ...contender.context, owner: f.context.owner, observer: f.context.observer,
        password: "synthetic-distinct-second-credential",
        proof: { ...f.context.proof, application: { ...f.context.proof.application, origin: "http://127.0.0.1:15434/" } } };
      const followUp = profile === "follow-up";
      const effectiveProfile = followUp ? competition261SeedProfile : profile;
      const gap = profile === gap261SeedProfile;
      const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ bound: true }]), $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
      const transaction = jest.fn(async (run: (client: unknown) => Promise<void>) => run(tx));
      Object.assign(f.context.owner, { $transaction: transaction });
      const routes: string[] = [];
      const fetch = jest.fn(async (target: URL, init?: RequestInit) => {
        routes.push(target.port + target.pathname);
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        const response = new Response(JSON.stringify(target.pathname === "/auth/login"
          ? { tokens: { accessToken: target.port === "15433" ? "synthetic-primary" : "synthetic-contender" } }
          : { id: body.scopeKey, sources: body.sources.map((source: { projectId: string }, index: number) =>
            ({ id: body.scopeKey + index, projectId: source.projectId })) }), { status: 201 });
        Object.defineProperty(response, "url", { value: target.href });
        if (target.pathname === "/fund-accounts/openings" && body.balanceYuan === "8")
          expect(body.sources.map((source: { amountYuan: string }) => source.amountYuan)).toEqual(["5", "3"]);
        return response;
      });
      const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
      const lane = { checkLight() {}, fetch: fetch as typeof globalThis.fetch, seedProfile: effectiveProfile };
      const result = gap
        ? await seedRegisteredPgAttributionGapFixture(f.context, plan, lane)
        : followUp ? await seedRegisteredPgCompetitionFollowUpFixture(f.context, second, plan, lane, lane) : await seedRegisteredPgCompetitionFixture(f.context, second, plan, lane, lane);
      const payload = JSON.parse(tx.$queryRawUnsafe.mock.calls[0]![1]);
      expect(payload.profile).toBe(effectiveProfile);
      if (followUp) {
        expect(result).toMatchObject({companyASourceId:`company:${plan.ids.companyA}0`});
        expect("followUpRequestKey" in result && result.followUpRequestKey).toMatch(/^[a-f0-9-]{36}$/u);
      } else expect(Object.hasOwn(result,"companyASourceId")).toBe(false);
      expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      expect(payload.passwordHash).not.toBe(f.context.password);
      expect(routes).toEqual(["15433/auth/login", "15433/fund-accounts/openings", "15433/fund-accounts/openings",
        ...(!gap ? ["15434/auth/login"] : [])]);
      if ("attributionGap" in result) expect(result.attributionGap.otherProjectId).toBe(payload.otherProjectId);
      if ("contender" in result) {
        expect(result.contender.actorId).toBe(payload.contender.actorId);
        expect(result.contender.accessToken).toBe("synthetic-contender");
        expect(payload.contender.passwordHash).not.toBe(second.password);
        await expect(seedRegisteredPgCompetitionFixture(f.context, second, plan, lane, { ...lane, seedProfile: payment261SeedProfile }))
          .rejects.toMatchObject({ code: "TASK16_FIXTURE_FAILED_CLOSED", fixtureOutcome: "NOT_ATTEMPTED" });
        expect(transaction).toHaveBeenCalledTimes(1);
      }
    });

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
      "cancel-settlement-updated-at", "cancel-request-updated-at", "cancel-owner-role", "cancel-owner-pid", "cancel-owner-start", "cancel-owner-method", "cancel-owner-getter", "cancel-orphan-key", "cancel-recorded-key", "cancel-unconfirmed-execution", "cancel-result-error", "competition", "competition-follow-up", "competition-follow-up-director-wins", "competition-follow-up-stale-todo", "competition-follow-up-wrong-payer", "competition-follow-up-double-debit", "competition-follow-up-ineligible", "competition-stale-todo", "competition-second-win", "disconnect-recovery", "disconnect-ledger-drift", "disconnect-recorded-key", "disconnect-first-succeeded", "disconnect-same-pid", "disconnect-equivalent-origin", "disconnect-ip-alias"])(
    "verifies the %s case through only the approved observer columns", async scenario => {
    const f = fixture();
    const plan = buildRegisteredPgFixturePlan(f.proof.runId, "2026-11-07", "2026-11-01");
    const { ids } = plan;
    const prepared = { plan, accessToken: "synthetic-only", companyARegistrationId: "registration-a", companyBRegistrationId: "registration-b", companyBSourceId: "source-b" };
    const competition = scenario.startsWith("competition");
    const disconnect = scenario.startsWith("disconnect");
    const equivalentOrigin = scenario === "disconnect-equivalent-origin" || scenario === "disconnect-ip-alias";
    const followUp = scenario.startsWith("competition-follow-up");
    const directorWins = scenario === "competition-follow-up-director-wins";
    const followUpKey = randomUUID();
    let completed = false;
    let followUpPosts = 0;
    let posts = 0;
    const total = competition ? 4000n : 10000n, paid = competition ? 3000n : 4000n;
    const contender = { actorId: randomUUID(), requestKey: randomUUID(), accessToken: "synthetic-contender-only" };
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
          const cancellation = scenario.startsWith("cancel-");
          expect(values).toEqual([ids.settlement, ids.payment, ...(cancellation ? [ids.requestKey] : [])]);
          if (cancellation) expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM public."PaymentExecution" e WHERE e."idempotencyKey"=$3)');
          ownerReads++;
          if (submittedCancellation && scenario === "cancel-orphan-key") return [];
          const after = (name: string) => submittedCancellation && scenario === name;
          return [{
            database: f.proof.databaseName, databaseOid: f.proof.databaseOid, systemIdentifier: f.proof.systemIdentifier,
            effectiveRole: after("cancel-owner-role") ? f.proof.runtimeRole : f.proof.ownerRole,
            loginRole: f.proof.ownerRole, ownerOid: "10", pid: after("cancel-owner-pid") ? 999 : 100,
            startedAt: after("cancel-owner-start") ? "2026-11-07T00:00:00.000002Z" : "2026-11-07T00:00:00.000001Z",
            tls: true, readOnly: "on", isolation: "repeatable read",
            settlementStatus: after("cancel-settlement-status") ? "paid" : "approved",
            settlementUpdatedAt: after("cancel-settlement-updated-at") ? "2026-11-07T00:00:00.001000Z" : "2026-11-07T00:00:00.000000Z",
            requestUpdatedAt: after("cancel-request-updated-at") || after("disconnect-ledger-drift") ? "2026-11-07T00:00:00.001000Z" : "2026-11-07T00:00:00.000000Z"
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
      if (model === "paymentRequest") return [{ approvedAmountCents: total, paidAmountCents: completed ? total : recorded ? paid : 0n, status: completed ? "paid" : recorded ? "partially_paid" : "approved_pending_payment" }];
      if (model === "settlement") return [{ payableAmountCents: total, paidAmountCents: completed ? total : recorded ? paid : 0n }];
      if (model === "fundAccountBalanceRegistration") return [{ accountId: where.id === "registration-a" ? "account-a" : "account-b", balanceYuan: new Prisma.Decimal("100"), coveredExecutionIds: [] }];
      if (model === "operatingImpactEntry" && orphanImpact && where.sourceBusinessId === undefined) return [{ id: "orphan-impact" }];
      if (!recorded) return [];
      if (completed) {
        const secondAmount = scenario === "competition-follow-up-double-debit" ? 2000n : 1000n;
        if (model === "paymentExecution") return [{id:"execution-one",idempotencyKey:directorWins?contender.requestKey:ids.requestKey,amountCents:3000n,paymentRequestId:ids.payment,voucherFileId:null}, {id:"execution-two",idempotencyKey:followUpKey,amountCents:1000n,paymentRequestId:ids.payment,voucherFileId:null}];
        if (model === "registeredPaymentFunding") return [{executionId:"execution-one",operatingLedgerEffectiveDateAtRegistration:null,actualPayerId:ids.companyB,actualPayerKind:"participating_company"}, {executionId:"execution-two",operatingLedgerEffectiveDateAtRegistration:null,actualPayerId:scenario === "competition-follow-up-wrong-payer" ? ids.companyB : ids.companyA,actualPayerKind:"participating_company"}];
        if (model === "registeredFundPaymentAllocation") return [{executionId:"execution-one",accountId:"account-b",sourceBatchId:"source-b",amountCents:3000n}, {executionId:"execution-two",accountId:"account-a",sourceBatchId:"source-a",amountCents:secondAmount}];
        if (model === "registeredPaymentEvent") return [{executionId:"execution-one"},{executionId:"execution-two"}];
        if (model === "auditLog") return [{actorUserId:directorWins?contender.actorId:ids.actor,metadata:{voucherFileId:null,voucherPending:true,actualPayer:{kind:"participating_company",id:ids.companyB}}}, {actorUserId:directorWins?ids.actor:contender.actorId,metadata:{executionId:"execution-two",voucherFileId:null,voucherPending:true,actualPayer:{kind:"participating_company",id:ids.companyA}}}];
      }
      if (model === "paymentExecution") return [{ id: "execution-one", idempotencyKey: directorWins?contender.requestKey:ids.requestKey, amountCents: paid, paymentRequestId: ids.payment, voucherFileId: null }];
      if (model === "registeredPaymentFunding") return [{ executionId: "execution-one", operatingLedgerEffectiveDateAtRegistration: null, actualPayerId: ids.companyB, actualPayerKind: "participating_company" }];
      if (model === "registeredFundPaymentAllocation") return [{ executionId: "execution-one", accountId: "account-b", sourceBatchId: "source-b", amountCents: paid }];
      if (model === "registeredPaymentEvent") return [{ executionId: "execution-one" }];
      if (model === "interEntityRelationshipEntry") return [{ id: "root-one", paymentExecutionId: "execution-one", sourceType: "registered_payment_execution", entryKind: "proxy_payment", direction: "increase", status: "confirmed", originalDebtorCompanyId: ids.companyA, creditorCompanyId: ids.companyB, amountCents: paid, projectId: ids.project }];
      if (model === "auditLog") return [{ actorUserId: directorWins?contender.actorId:ids.actor, metadata: { voucherFileId: null, voucherPending: true, actualPayer: { kind: "participating_company", id: ids.companyB } } }];
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
      if (competition) {
        const laneB = new URL(String(input)).port === "15434";
        const token = laneB ? contender.accessToken : prepared.accessToken;
        expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
        const initial = "2026-11-07T00:00:00.000Z", updated = "2026-11-07T00:00:00.005Z";
        const stale = laneB && scenario === "competition-stale-todo";
        if (completed && route === "/payment-executions/work-items" && !(laneB && scenario === "competition-follow-up-stale-todo")) return respond(200,{total:0,items:[]});
        if (followUp && recorded && route.endsWith("/registration-options")) return respond(200,{paymentId:ids.payment,projectId:ids.project,expectedPaymentUpdatedAt:updated,remainingAmountCents:"1000",accounts:[{scopeKey:`company:${ids.companyA}`,eligible:scenario !== "competition-follow-up-ineligible",currentRegistrationId:"registration-a"}]});
        if (followUp && route.endsWith("/registrations") && init?.method === "POST" && JSON.parse(String(init.body)).idempotencyKey === followUpKey) {
          const body=JSON.parse(String(init.body));
          expect(laneB).toBe(!directorWins); expect(body.scopeKey).toBe(`company:${ids.companyA}`);expect(body.expectedRegistrationId).toBe("registration-a");expect(body.sourceAllocations).toEqual([{sourceBatchId:"source-a",amountCents:"1000"}]);expect(body.expectedPaymentUpdatedAt).toBe(updated);expect(body.amountCents).toBe("1000");
          followUpPosts++; completed=true; return respond(201,{});
        }
        if (followUp && route.endsWith(`/results/${followUpKey}`)) return respond(200,{status:"recorded",execution:{executionId:"execution-two",paymentId:ids.payment,amountCents:"1000",paidAt:plan.paidAt,voucherPending:true},effects:[],intercompany:[]});
        if (followUp && route === "/payment-executions/recorded-items") return respond(200,{total:2,items:[{executionId:"execution-one",resultKey:directorWins?contender.requestKey:ids.requestKey,amountCents:"3000",paidAt:plan.paidAt},{executionId:"execution-two",resultKey:followUpKey,amountCents:"1000",paidAt:plan.paidAt}]});
        if (route === "/payment-executions/work-items") return respond(200, { total: 1, items: [{ paymentId: ids.payment, projectId: ids.project,
          expectedPaymentUpdatedAt: recorded && !stale ? updated : initial, paidAmountCents: recorded && !stale ? "3000" : "0",
          remainingAmountCents: recorded && !stale ? "1000" : "4000" }] });
        if (route.endsWith("/registration-options")) return respond(200, { paymentId: ids.payment, expectedPaymentUpdatedAt: initial,
          remainingAmountCents: "4000", accounts: [{ scopeKey: `company:${ids.companyB}`, eligible: true }] });
        if (route === `/payment-executions/${ids.payment}/registrations` && init?.method === "POST") {
          const command = JSON.parse(String(init.body));
          expect(command.idempotencyKey).toBe(laneB ? contender.requestKey : ids.requestKey);
          expect(command.amountCents).toBe("3000");
          expect(command.expectedPaymentUpdatedAt).toBe(initial);
          expect(command.confirmationPassword).toBe(laneB ? "synthetic-second-credential" : f.context.password);
          if (laneB === directorWins) recorded = true;
          return respond(laneB === directorWins || scenario === "competition-second-win" ? 201 : 409, {});
        }
        if (route === `/payment-executions/results/${laneB ? contender.requestKey : ids.requestKey}`) {
          return respond(200, laneB !== directorWins ? { status: "unconfirmed" } : { status: "recorded",
            execution: { executionId: "execution-one", amountCents: "3000", paidAt: plan.paidAt }, effects: [], intercompany: [{entryId:"root-one"}] });
        }
        throw new Error("Unexpected competition HTTP route");
      }
      if (route.endsWith("/registration-options")) return respond(200, { expectedPaymentUpdatedAt: "2026-11-07T00:00:00.000Z", remainingAmountCents: "10000", accounts: [{ scopeKey: `company:${ids.companyB}`, eligible: true }] });
      if (route.endsWith("/registrations") && init?.method === "POST") {
        if (disconnect) {
          posts++;
          if (posts === 1 || !equivalentOrigin)
            expect(new URL(String(input)).port).toBe(posts === 1 ? "15433" : "15434");
          if (posts === 1) {
            submittedCancellation = true;
            return respond(scenario === "disconnect-first-succeeded" ? 201 : 503, {});
          }
          recorded = true;
          return respond(201, {});
        }
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
      if (scenario.startsWith("cancel-") && route === `/payment-executions/results/${ids.requestKey}`) {
        expect(init?.method).toBe("GET");
        expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${prepared.accessToken}`);
        expect(ownerReads).toBe(2);
        if (scenario === "cancel-recorded-key") return respond(200, { status: "recorded", execution: { executionId: "execution-one" } });
        if (scenario === "cancel-unconfirmed-execution") return respond(200, { status: "unconfirmed", execution: null });
        return respond(scenario === "cancel-result-error" ? 503 : 200, { status: "unconfirmed" });
      }
      if (disconnect && route === `/payment-executions/results/${ids.requestKey}` && !recorded && scenario !== "disconnect-recorded-key")
        return respond(200, { status: "unconfirmed" });
      if (route === `/payment-executions/results/${ids.requestKey}`) return respond(200, { status: "recorded", execution: { executionId: "execution-one", amountCents: "4000", paidAt: plan.paidAt }, effects: [], intercompany: [{}] });
      throw new Error("Unapproved HTTP protocol request");
    });
    try {
      const continuity = { checkLight: jest.fn(), fetch: globalThis.fetch, assertHttpRequest: jest.fn() };
      if (disconnect) {
        const fault = async (submit: () => Promise<void>) => {
          await submit();
          return { mode: "disconnect-commit", state: "commit-disconnected", transactionId: "407", executionAllowed: false, nativeAdmission: false } as const;
        };
        const begin = registeredCases.runRegisteredNullCrossCompanyDisconnectAttempt(f.context, prepared, continuity, fault);
        if (scenario === "disconnect-first-succeeded") {
          await expect(begin).rejects.toThrow("PG_CASE_DISCONNECT_HTTP_STATUS");
          await expect(registeredCases.runRegisteredNullCrossCompanyDisconnectAttempt(f.context, prepared, continuity, fault)).rejects.toThrow("PG_CASE_DISCONNECT_ATTEMPT_USED");
          expect(posts).toBe(1);
          return;
        }
        const attempt = await begin;
        await expect(registeredCases.runRegisteredNullCrossCompanyDisconnectAttempt(f.context, prepared, continuity, fault)).rejects.toThrow("PG_CASE_DISCONNECT_ATTEMPT_USED");
        expect(Object.keys(attempt)).toEqual([]);
        const confirm = registeredCases.confirmRegisteredNullCrossCompanyDisconnectRollback(attempt, continuity);
        if (scenario === "disconnect-ledger-drift") {
          await expect(confirm).rejects.toThrow("PG_CASE_DISCONNECT_LEDGER_CHANGED");
          expect(posts).toBe(1);
          return;
        }
        const confirmed = await confirm;
        expect(Object.keys(confirmed)).toEqual([]);
        await expect(registeredCases.confirmRegisteredNullCrossCompanyDisconnectRollback(attempt, continuity)).rejects.toThrow("PG_CASE_DISCONNECT_ATTEMPT");
        const replacementOrigin = scenario === "disconnect-equivalent-origin" ? "http://127.0.0.1:15433"
          : scenario === "disconnect-ip-alias" ? "http://127.1:15433/" : "http://127.0.0.1:15434/";
        const second: RegisteredPgExecutionContext = {
          ...f.context, proof: { ...f.context.proof, application: { ...f.context.proof.application, origin: replacementOrigin } },
          runtime: { $queryRawUnsafe: async () => [{ ...f.sessions[1], pid: scenario === "disconnect-same-pid" ? 101 : 103 }] } as unknown as RegisteredPgExecutionContext["runtime"]
        };
        await expect(registeredCases.runRegisteredNullCrossCompanyDisconnectRecovery({ ...confirmed }, second, continuity)).rejects.toThrow("PG_CASE_DISCONNECT_ROLLBACK_PROOF");
        const recovered = registeredCases.runRegisteredNullCrossCompanyDisconnectRecovery(confirmed, second, continuity);
        if (equivalentOrigin) {
          await expect(recovered).rejects.toThrow("PG_CASE_DISCONNECT_REPLACEMENT_SCOPE");
          expect(posts).toBe(1);
          expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "POST"]);
        } else if (scenario === "disconnect-recorded-key" || scenario === "disconnect-same-pid") {
          await expect(recovered).rejects.toThrow(scenario === "disconnect-recorded-key" ? "PG_CASE_DISCONNECT_KEY_ALREADY_RESOLVED" : "PG_CASE_DISCONNECT_REPLACEMENT_IDENTITY");
          expect(posts).toBe(1);
        } else {
          await expect(recovered).resolves.toMatchObject({ passed: true, rollbackObserved: true, executionId: "execution-one", rootId: "root-one" });
          expect(posts).toBe(2);
          const [first, second] = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
          expect(first?.[1]?.body).toBe(second?.[1]?.body);
          expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "POST", "GET", "POST", "GET"]);
        }
        await expect(registeredCases.runRegisteredNullCrossCompanyDisconnectRecovery(confirmed, second, continuity)).rejects.toThrow("PG_CASE_DISCONNECT_ROLLBACK_PROOF");
        return;
      }
      if (competition) {
        const second: RegisteredPgExecutionContext = {
          ...f.context, password: "synthetic-second-credential",
          proof: { ...f.context.proof, application: { ...f.context.proof.application, origin: "http://127.0.0.1:15434/" } },
          runtime: { $queryRawUnsafe: async () => [{ ...f.sessions[1], pid: 103 }] } as unknown as RegisteredPgExecutionContext["runtime"]
        };
        const withSamePaymentLock = jest.fn(async (_id: string, _pids: readonly [number, number],
          submissions: readonly [() => Promise<{ status: number; body: unknown }>, () => Promise<{ status: number; body: unknown }>]) =>
          Promise.all([submissions[0](), submissions[1]()]));
        const run = (followUp ? registeredCases.runRegisteredTwoActorPaymentCompetitionFollowUp : registeredCases.runRegisteredTwoActorPaymentCompetition)(f.context, second, { ...prepared, contender, companyASourceId:"source-a",followUpRequestKey:followUpKey }, {
          lanes: [continuity, continuity], withSamePaymentLock, withFollowUp: async <T>(_lane:number,_key:string,consume:()=>Promise<T>) => consume()
        });
        if (followUp) {
          if (scenario === "competition-follow-up" || directorWins) {await expect(run).resolves.toMatchObject({fullyPaid:true,secondExecutionId:"execution-two",passed:true}); expect(followUpPosts).toBe(2);}
          else await expect(run).rejects.toThrow(/PG_COMPETITION_FOLLOW_UP/u);
        } else if (scenario === "competition") await expect(run).resolves.toMatchObject({ competitionObserved: true, winner: "finance_staff", passed: true });
        else await expect(run).rejects.toThrow(scenario === "competition-stale-todo" ? "PG_COMPETITION_SHARED_WORK" : "PG_COMPETITION_ONE_HTTP_WINNER");
        expect(withSamePaymentLock).toHaveBeenCalledWith(ids.payment, [101, 103], expect.any(Array));
        expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2+followUpPosts);
        return;
      }
      if (scenario.startsWith("cancel-")) {
        const cancel = jest.fn(async (submit: () => Promise<void>) => {
          expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(["GET"]);
          expect(reads.has("auditLog")).toBe(true);
          await submit();
        });
        const run = registeredCases.runRegisteredNullCrossCompanyCommitCancellation(f.context, prepared, continuity, cancel);
        if (scenario === "cancel-commit") {
          await expect(run).resolves.toMatchObject({caseId: "registered.null-cross-company.cancel-commit", passed: true, rollbackObserved: true, originalResultUnconfirmed: true});
        } else {
          const errors: Record<string, string> = {
            "cancel-fake-success": "PG_CASE_CANCEL_HTTP_STATUS",
            "cancel-owner-method": "PG_CASE_CANCEL_OWNER_CHANGED",
            "cancel-owner-getter": "PG_CASE_CANCEL_OWNER_CHANGED",
            "cancel-owner-role": "PG_CASE_CANCEL_OWNER_PROOF",
            "cancel-owner-pid": "PG_CASE_CANCEL_OWNER_PROOF",
            "cancel-orphan-key": "PG_CASE_CANCEL_OWNER_PROOF",
            "cancel-recorded-key": "PG_CASE_CANCEL_ORIGINAL_RESULT",
            "cancel-unconfirmed-execution": "PG_CASE_CANCEL_ORIGINAL_RESULT",
            "cancel-result-error": "PG_CASE_CANCEL_ORIGINAL_RESULT"
          };
          await expect(run).rejects.toThrow(errors[scenario] ?? "PG_CASE_CANCEL_LEDGER_CHANGED");
        }
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(ownerReads).toBe(["cancel-owner-method", "cancel-owner-getter"].includes(scenario) ? 1 : 2);
        expect(ownerGetterReads).toBe(0);
        const resultRead = ["cancel-commit", "cancel-recorded-key", "cancel-unconfirmed-execution", "cancel-result-error"].includes(scenario);
        expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST", ...(resultRead ? ["GET"] : [])]);
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

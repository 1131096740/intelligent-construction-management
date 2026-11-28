import "reflect-metadata";

import { ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { fundExecutionCommandFingerprint } from "./fund-execution-command-receipt";
import { FundExecutionService } from "./fund-execution.service";
import { FundExecutionController } from "./fund-execution.controller";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionSelectionRefService } from "./fund-execution-selection-ref.service";

describe("FundExecutionController authorization wiring", () => {
  function handler(method: keyof FundExecutionController) {
    return FundExecutionController.prototype[method] as object;
  }

  it("is never public", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FundExecutionController)).toBeFalsy();
  });

  it.each(["list", "detail", "returnCase", "review"] as const)(
    "does not preempt exact service-side direct/delegated authorization for %s",
    (method) => {
      expect(
        Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler(method))
      ).toBeUndefined();
    }
  );

  it("retains the direct global finance-director gate for final confirmation", () => {
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler("confirm"))
    ).toEqual(["finance_director"]);
  });

  it("retains finance writer gates on commands that do not accept approval delegation", () => {
    for (const method of [
      "capabilities",
      "create",
      "update",
      "submit",
      "reverse"
    ] as const) {
      expect(
        Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler(method))
      ).toEqual(["finance_staff", "finance_director"]);
    }
  });

  it("refuses fresh wages via HTTP and only replays the exact authorized historical command", async () => {
    const originalKey = "10000000-0000-4000-8000-000000000011";
    const changedKey = "10000000-0000-4000-8000-000000000012";
    const input = { reason: "本地历史工资出款", observationSelectionRef: "previous-bank-selection" };
    const actorUserId = "finance";
    const snapshot = { caseId: "historic-case", status: "draft", revision: 1 };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ id: actorUserId }]),
      fundExecutionCommandReceipt: {
        findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
          where.idempotencyKey === originalKey ? {
            action: "create_case", createdByUserId: actorUserId, responseSnapshot: snapshot,
            payloadFingerprint: fundExecutionCommandFingerprint("create_case", { actorUserId, ...input })
          } : null),
        create: jest.fn()
      },
      fundExecution: { create: jest.fn() },
      bankTransactionClaim: { create: jest.fn() },
      fundExecutionCase: { create: jest.fn() }
    };
    const options = {
      matchObservationInTransaction: jest.fn().mockResolvedValue({ observation: { direction: "outflow" } })
    };
    const prisma = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const audit = { record: jest.fn() };
    const service = new FundExecutionService(prisma as never, audit as never, options as never, {} as never);
    const module = await Test.createTestingModule({
      controllers: [FundExecutionController],
      providers: [
        { provide: FundExecutionService, useValue: service },
        { provide: FundExecutionSelectionOptionsService, useValue: options }
      ]
    }).compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: actorUserId };
      next();
    });
    const previousSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "synthetic-v7-authorization";
    try {
      await app.listen(0, "127.0.0.1");
      const url = `${await app.getUrl()}/fund-executions/cases`;
      const post = (idempotencyKey: string, reason = input.reason) => fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, reason, idempotencyKey })
      });
      const replay = await post(originalKey);
      expect(replay.status).toBe(201);
      await expect(replay.json()).resolves.toEqual(snapshot);
      expect((await post(originalKey, "不同原因")).status).toBe(409);
      expect((await post(changedKey)).status).toBe(410);
      tx.$queryRaw.mockResolvedValue([]);
      expect((await post(originalKey)).status).toBe(403);
      expect(options.matchObservationInTransaction).toHaveBeenCalledTimes(1);
      expect(tx.fundExecution.create).not.toHaveBeenCalled();
      expect(tx.bankTransactionClaim.create).not.toHaveBeenCalled();
      expect(tx.fundExecutionCase.create).not.toHaveBeenCalled();
      expect(tx.fundExecutionCommandReceipt.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      else process.env.OPERATING_LEDGER_DB_WRITE_SECRET = previousSecret;
      await app.close();
    }
  });

  it("authorizes the real options service before business reads and selectionRef signing", async () => {
    const methods = ["observation", "reversal", "classification"] as const;
    const observation = {
      id: "observation-1",
      reference: "OBS-1",
      payerVerificationId: "payer-verification-1",
      payerVerificationReference: "PAYER-1",
      holderCompanyEntityId: "company-1",
      holderNameSnapshot: "测试公司",
      holderCreditCodeSnapshot: "91310000TEST000001",
      verificationReference: "VERIFY-1",
      verifiedByUserId: "finance-director-1",
      verifiedAt: new Date("2026-08-31T00:00:00.000Z"),
      verificationEvidenceFileId: "verification-file-1",
      verificationEvidenceContentSha256: "a".repeat(64),
      verificationSourceType: "bank_account_legal_holder",
      verificationSourceRecordId: "payer-source-1",
      verificationIssuedByDatabaseRole: "test_role",
      transactionSourceType: "bank_statement",
      transactionSourceId: "transaction-1",
      transactionSourceIdentity: "transaction-identity-1",
      transactionEvidenceFileId: "transaction-file-1",
      transactionEvidenceContentSha256: "b".repeat(64),
      transactionExecutedByUserId: "executor-1",
      amountCents: 10_000n,
      currencyCode: "CNY",
      direction: "inflow",
      occurredAt: new Date("2026-08-31T01:00:00.000Z"),
      payloadFingerprint: "c".repeat(64)
    };

    function sqlText(query: unknown) {
      if (
        typeof query === "object" &&
        query !== null &&
        "strings" in query &&
        Array.isArray(query.strings)
      ) {
        return query.strings.join(" ");
      }
      return String(query);
    }

    function harness(input: { active: boolean; global: boolean }) {
      const authorizationQueries: string[] = [];
      const businessQueries: string[] = [];
      const prisma = {
        companyTransferBankClaim:{count:jest.fn().mockResolvedValue(0),findMany:jest.fn().mockResolvedValue([])},contractBankEventClaim:{findMany:jest.fn().mockResolvedValue([])},contractProxyBankClaim:{findMany:jest.fn().mockResolvedValue([])}, bankTransactionClaim: {
          findMany: jest.fn().mockResolvedValue([])
        },
        verifiedBankTransactionObservation: {
          findMany: jest.fn().mockResolvedValue([observation])
        },
        $queryRaw: jest.fn((query: unknown) => {
          const sql = sqlText(query);
          if (sql.includes('FROM "User" user_row')) {
            authorizationQueries.push(sql);
            return Promise.resolve(
              input.active && input.global
                ? [{ id: "active-global-user" }]
                : []
            );
          }
          businessQueries.push(sql);
          return Promise.resolve([]);
        }),
        $transaction: jest.fn().mockRejectedValue(
          new Error("classification business query reached")
        )
      };
      const refs = new FundExecutionSelectionRefService({
        bankObservationSecret: "controller-options-bank-secret",
        axisBusinessSecret: "controller-options-axis-secret"
      });
      const issueObservation = jest.spyOn(refs, "issueBankObservation");
      const issueReversal = jest.spyOn(refs, "issueReversalTarget");
      const issueAxis = jest.spyOn(refs, "issueAxisBusinessOption");
      return {
        prisma,
        authorizationQueries,
        businessQueries,
        issueObservation,
        signers: [issueObservation, issueReversal, issueAxis],
        service: new FundExecutionSelectionOptionsService(
          prisma as never,
          refs
        )
      };
    }

    const active = harness({ active: true, global: true });
    await expect(
      active.service.listObservationCandidates("active-global-user")
    ).resolves.toEqual([
      expect.objectContaining({
        selectionRef: expect.stringMatching(/^fobs1\./u)
      })
    ]);
    expect(active.authorizationQueries).toHaveLength(1);
    expect(active.authorizationQueries[0]).toMatch(
      /user_row\."isActive" = TRUE/u
    );
    expect(active.authorizationQueries[0]).toMatch(
      /user_position\."projectId" IS NULL/u
    );
    expect(active.authorizationQueries[0]).toMatch(
      /'finance_staff', 'finance_director'/u
    );
    expect(active.prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      active.prisma.bankTransactionClaim.findMany.mock.invocationCallOrder[0]!
    );
    expect(
      active.prisma.bankTransactionClaim.findMany.mock.invocationCallOrder[0]
    ).toBeLessThan(active.issueObservation.mock.invocationCallOrder[0]!);

    const outgoing = { ...observation, id: "outgoing", reference: "OUT-OBS", direction: "outflow" };
    active.prisma.verifiedBankTransactionObservation.findMany.mockImplementation(async ({ where }) =>
      [observation, outgoing].filter((entry) => !where.direction || entry.direction === where.direction));
    const incoming = await active.service.listObservationCandidates("active-global-user", new Date(), "fund_execution_case");
    const reversal = await active.service.listObservationCandidates("active-global-user", new Date(), "fund_execution_reversal");
    expect(incoming.map(({ summary }) => summary.slice(0, 2))).toEqual(["入账"]);
    expect(reversal.map(({ summary }) => summary.slice(0, 2))).toEqual(["入账", "出账"]);

    for (const denied of [
      { label: "project-only", active: true, global: false },
      { label: "inactive-global", active: false, global: true }
    ]) {
      for (const method of methods) {
        const current = harness(denied);
        const result =
          method === "observation"
            ? current.service.listObservationCandidates(`${denied.label}-user`)
            : method === "reversal"
              ? current.service.listReversalTargets(`${denied.label}-user`)
              : current.service.listCasePlans(
                  "case-1",
                  `${denied.label}-user`
                );
        await expect(result).rejects.toBeInstanceOf(ForbiddenException);
        expect(current.authorizationQueries).toHaveLength(1);
        expect(current.businessQueries).toEqual([]);
        expect(current.prisma.bankTransactionClaim.findMany).not.toHaveBeenCalled();
        expect(
          current.prisma.verifiedBankTransactionObservation.findMany
        ).not.toHaveBeenCalled();
        expect(current.prisma.$transaction).not.toHaveBeenCalled();
        for (const signer of current.signers) {
          expect(signer).not.toHaveBeenCalled();
        }
      }
    }
  });
});

// 该套件验证原审批/归档职责；履约范围事务守卫由 contract-economic-* 与 PostgreSQL 套件独立覆盖。
jest.mock("../contract-ledger/contract-economic-coverage", () => ({ ...jest.requireActual("../contract-ledger/contract-economic-coverage"), assertEconomicContractReady: jest.fn().mockResolvedValue(undefined) }));
import { AuditService } from "../audit/audit.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { ContractTakeoverActivationService } from "./contract-takeover-activation.service";
import { CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE } from "./contract-takeover-operating-source.adapter";

describe("ContractTakeoverActivationService POL-09 operating projection", () => {
  it("projects the opening settlement and each historical payment in the activation transaction without creating payment workflow rows", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest
        .fn()
        .mockResolvedValue({ created: true })
    } as unknown as OperatingSourceReplayService;
    const service = new ContractTakeoverActivationService(audit, operatingSources);
    const tx = activationTx();

    const result = await service.executePreparedActivation(
      tx as never,
      {
        takeover: {
          id: "takeover-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-1",
          takeoverLevel: "A"
        },
        contractFacts: {
          signedAt: new Date("2026-01-01"),
          historicalSettledCents: 100_000n,
          zeroSettlementDeclared: false
        },
        financeFacts: { zeroPaymentDeclared: false, excessTreatment: null },
        payments: [
          { id: "historical-payment-1", amountCents: 100_000n, status: "draft" }
        ],
        vouchers: [{ historicalPaymentId: "historical-payment-1" }],
        contract: {
          counterparty: "历史相对方",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityIsActive: null,
          companyEntityDataStatus: null,
          companyEntityVersionId: null,
          companyEntityVersionName: null,
          companyEntityCreditCode: null,
          companyEntityRegisteredAddress: null
        },
        contractVersion: { draftData: null, amountCents: 1_000_000n, amountLimitType: "capped" }
      },
      "finance-director-1",
      "activate-1"
    );

    expect(result.historicalInitialSettlementId).toBe("initial-settlement-1");
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenNthCalledWith(
      2,
      tx,
      {
        projectId: "project-1",
        sourceType: "settlement",
        sourceBusinessId: "initial-settlement-1"
      },
      "finance-director-1"
    );
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenNthCalledWith(
      3,
      tx,
      {
        projectId: "project-1",
        sourceType: CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE,
        sourceBusinessId: "historical-payment-1"
      },
      "finance-director-1"
    );
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it.each(["missing", "matching", "conflicting"] as const)(
    "keeps the verified original inside counterparty snapshot when it is %s",
    async (existing) => {
      const audit = { record: jest.fn() } as unknown as AuditService;
      const operating = { appendConfirmedSourceIfEnabledInTransaction: jest.fn() } as unknown as OperatingSourceReplayService;
      const service = new ContractTakeoverActivationService(audit, operating);
      const tx = {
        ...activationTx(),
        contractPartySnapshot: {
          findMany: jest.fn().mockResolvedValue(existing === "missing" ? []
            : [{ businessPartyVersionId: existing === "matching" ? "original-version" : "other-version" }]),
          create: jest.fn()
        },
        businessPartyVersion: {
          findUnique: jest.fn().mockResolvedValue({ businessPartyId: "original", snapshot: { name: "原签约相对方" } }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ snapshot: { name: "原签约相对方", originalCode: "retained" } })
        },
        projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue({
          id: "affiliate", businessPartyVersionId: "builder-version", affiliateNameSnapshot: "原施工企业"
        }) },
        projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([
          { companyEntityVersionId: "our-version", companyNameSnapshot: "原我方公司" }
        ]) }
      };
      tx.contractTakeoverConfirmationEvent.findFirst.mockResolvedValue({
        responseSnapshot: { revision: 1, assignments: { contract: "staff", finance: "finance", supervisor: "director" } }
      });
      const execution = service.executePreparedActivation(tx as never, {
        takeover: {
          id: "takeover-1", projectId: "project-1", contractId: "contract-1",
          contractVersionId: "original-contract-version", paymentTermsVersionId: "terms-1", takeoverLevel: "NONE"
        },
        contractFacts: {
          signedAt: new Date("2026-09-01"), historicalSettledCents: 6_000n, zeroSettlementDeclared: false,
          contractFactsSnapshot: { counterparty: "原签约相对方", counterpartyVersionId: "original-version" }
        },
        financeFacts: { zeroPaymentDeclared: false, excessTreatment: null },
        payments: [{ id: "payment", status: "draft", amountCents: 6_000n }],
        vouchers: [{ historicalPaymentId: "payment" }],
        contract: {
          counterparty: "原签约相对方", contractTypeKey: "material_purchase", companyEntityId: "our-company",
          companyEntityIsActive: true, companyEntityDataStatus: "complete",
          companyEntityVersionId: "our-version", companyEntityVersionName: "原我方公司",
          companyEntityCreditCode: "known-code", companyEntityRegisteredAddress: null
        },
        contractVersion: { draftData: { historicalTakeover: true, relationship: "inside" }, amountCents: 10_000n, amountLimitType: "capped" }
      }, "director", "activate");
      if (existing === "conflicting") {
        await expect(execution).rejects.toThrow("原合同相对方版本与已保存的签约快照不一致");
        expect(tx.settlement.create).not.toHaveBeenCalled();
      } else {
        await expect(execution).resolves.toMatchObject({ activated: true });
      }
      if (existing === "missing") {
        expect(tx.contractPartySnapshot.create).toHaveBeenCalledWith({ data: {
          contractVersionId: "original-contract-version", roleKey: "party_b", displayOrder: 0,
          businessPartyVersionId: "original-version", snapshot: { name: "原签约相对方", originalCode: "retained" }
        } });
      } else {
        expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
      }
      expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    }
  );

  it("requires a handover before a no-grade or C-level takeover is activated", async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn()
    } as unknown as OperatingSourceReplayService;
    const service = new ContractTakeoverActivationService(audit, operatingSources);
    const tx = activationTx();

    await expect(
      service.executePreparedActivation(
        tx as never,
        {
          takeover: {
            id: "takeover-c",
            projectId: "project-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-1",
            takeoverLevel: "C"
          },
          contractFacts: {
            signedAt: new Date("2026-01-01"),
            historicalSettledCents: 0n,
            zeroSettlementDeclared: true
          },
          financeFacts: { zeroPaymentDeclared: true, excessTreatment: null },
          payments: [],
          vouchers: [],
          contract: {
            counterparty: "历史相对方",
            contractTypeKey: "material_purchase",
            companyEntityId: null,
            companyEntityIsActive: null,
            companyEntityDataStatus: null,
            companyEntityVersionId: null,
            companyEntityVersionName: null,
            companyEntityCreditCode: null,
            companyEntityRegisteredAddress: null
          },
          contractVersion: { draftData: null, amountCents: 1_000_000n, amountLimitType: "capped" }
        },
        "finance-director-1",
        "activate-c"
      )
    ).rejects.toThrow("请先完成接管分工登记");
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).not.toHaveBeenCalled();
  });

  it("keeps direct-contract historical payments as advance or overpay without creating an opening settlement", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest
        .fn()
        .mockResolvedValue({ created: true })
    } as unknown as OperatingSourceReplayService;
    const service = new ContractTakeoverActivationService(audit, operatingSources);
    const tx = activationTx();
    tx.contractTakeoverExcessEvidence.count.mockResolvedValue(1);
    tx.contractTakeoverBalanceAccount.create.mockResolvedValue({
      id: "balance-account-1"
    });

    await service.executePreparedActivation(
      tx as never,
      {
        takeover: {
          id: "takeover-direct-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-1",
          takeoverLevel: "A"
        },
        contractFacts: {
          signedAt: new Date("2026-01-01"),
          historicalSettledCents: 0n,
          zeroSettlementDeclared: true
        },
        financeFacts: {
          zeroPaymentDeclared: false,
          excessTreatment: "historical_advance"
        },
        payments: [
          { id: "historical-payment-direct-1", amountCents: 100_000n, status: "draft" }
        ],
        vouchers: [{ historicalPaymentId: "historical-payment-direct-1" }],
        contract: {
          counterparty: "历史相对方",
          contractTypeKey: "other",
          companyEntityId: null,
          companyEntityIsActive: null,
          companyEntityDataStatus: null,
          companyEntityVersionId: null,
          companyEntityVersionName: null,
          companyEntityCreditCode: null,
          companyEntityRegisteredAddress: null
        },
        contractVersion: { draftData: null, amountCents: 1_000_000n, amountLimitType: "capped" }
      },
      "finance-director-1",
      "activate-direct-1"
    );

    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.contractTakeoverHistoricalPaymentAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          historicalPaymentId: "historical-payment-direct-1",
          allocationType: "historical_advance",
          amountCents: 100_000n
        })
      ]
    });
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenCalledTimes(2);
  });
});

function activationTx() {
  return {
    contractTakeoverSettlementEvidence: {
      count: jest.fn().mockResolvedValue(1)
    },
    contractTakeoverExcessEvidence: {
      count: jest.fn().mockResolvedValue(0)
    },
    settlement: {
      create: jest.fn().mockResolvedValue({ id: "initial-settlement-1" })
    },
    contractTakeoverHistoricalPaymentAllocation: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractTakeoverHistoricalPayment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractVersion: {
      draftData: null,
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    paymentTermsVersion: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractTakeoverBalanceAccount: {
      create: jest.fn()
    },
    contractTakeoverBalanceEntry: {
      create: jest.fn()
    },
    contractTakeover: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractTakeoverConfirmationEvent: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    paymentRequest: { create: jest.fn() },
    paymentExecution: { create: jest.fn() }
  };
}

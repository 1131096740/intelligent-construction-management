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
          historicalSettledCents: 100_000n,
          zeroSettlementDeclared: false
        },
        financeFacts: { zeroPaymentDeclared: false, excessTreatment: null },
        payments: [
          { id: "historical-payment-1", amountCents: 100_000n, status: "draft" }
        ],
        vouchers: [{ historicalPaymentId: "historical-payment-1" }],
        contract: {
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityIsActive: null,
          companyEntityDataStatus: null,
          companyEntityVersionId: null,
          companyEntityVersionName: null,
          companyEntityCreditCode: null,
          companyEntityRegisteredAddress: null
        },
        contractVersion: { amountCents: 1_000_000n, amountLimitType: "capped" }
      },
      "finance-director-1",
      "activate-1"
    );

    expect(result.historicalInitialSettlementId).toBe("initial-settlement-1");
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenNthCalledWith(
      1,
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
      2,
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

  it("rejects C-level takeover before formal contract or ledger activation", async () => {
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
            historicalSettledCents: 0n,
            zeroSettlementDeclared: true
          },
          financeFacts: { zeroPaymentDeclared: true, excessTreatment: null },
          payments: [],
          vouchers: [],
          contract: {
            contractTypeKey: "material_purchase",
            companyEntityId: null,
            companyEntityIsActive: null,
            companyEntityDataStatus: null,
            companyEntityVersionId: null,
            companyEntityVersionName: null,
            companyEntityCreditCode: null,
            companyEntityRegisteredAddress: null
          },
          contractVersion: { amountCents: 1_000_000n, amountLimitType: "capped" }
        },
        "finance-director-1",
        "activate-c"
      )
    ).rejects.toThrow("C级历史接管只能进入资料缺口");
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
          contractTypeKey: "other",
          companyEntityId: null,
          companyEntityIsActive: null,
          companyEntityDataStatus: null,
          companyEntityVersionId: null,
          companyEntityVersionName: null,
          companyEntityCreditCode: null,
          companyEntityRegisteredAddress: null
        },
        contractVersion: { amountCents: 1_000_000n, amountLimitType: "capped" }
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
    ).toHaveBeenCalledTimes(1);
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
    paymentRequest: { create: jest.fn() },
    paymentExecution: { create: jest.fn() }
  };
}

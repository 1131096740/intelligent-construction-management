import { mergeContractDrilldown } from "./project-operating-drilldown";

describe("OPS-14 总览按合同钻取", () => {
  it("按合同分列已结算、已付、未付，审批中与已批待付只作构成不叠加", () => {
    const rows = mergeContractDrilldown({
      projectionRows: [
        {
          contractKey: "contract-a",
          settledCents: "10000",
          paidCents: "4000",
          unpaidCents: "6000"
        },
        {
          contractKey: "contract-b",
          settledCents: "5000",
          paidCents: "5000",
          unpaidCents: "0"
        }
      ],
      contracts: [
        { id: "contract-a", code: "HT-A", name: "甲合同" },
        { id: "contract-b", code: "HT-B", name: "乙合同" }
      ],
      affiliateContracts: [],
      companyContracts: [],
      paymentRequests: [
        {
          contractId: "contract-a",
          status: "approval_pending",
          requestedAmountCents: 2000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        },
        {
          contractId: "contract-a",
          status: "partially_paid",
          requestedAmountCents: 3000n,
          approvedAmountCents: 3000n,
          paidAmountCents: 1000n
        }
      ]
    });
    expect(rows.find((row) => row.contractKey === "contract-a")).toEqual({
      contractKey: "contract-a",
      contractCode: "HT-A",
      contractName: "甲合同",
      contractKindLabel: "下游合同",
      settledCents: "10000",
      paidCents: "4000",
      unpaidCents: "6000",
      approvalPendingRequestCents: "2000",
      approvedPendingPaymentCents: "2000"
    });
    expect(rows.find((row) => row.contractKey === "contract-b")).toEqual(
      expect.objectContaining({
        unpaidCents: "0",
        approvalPendingRequestCents: "0",
        approvedPendingPaymentCents: "0"
      })
    );
  });

  it("不同合同的预付/欠款不互相抵扣，只按本合同计算", () => {
    const rows = mergeContractDrilldown({
      projectionRows: [
        { contractKey: "a", settledCents: "0", paidCents: "1000", unpaidCents: "0" },
        { contractKey: "b", settledCents: "1000", paidCents: "0", unpaidCents: "1000" }
      ],
      contracts: [
        { id: "a", code: "A", name: "预付合同" },
        { id: "b", code: "B", name: "欠款合同" }
      ],
      affiliateContracts: [],
      companyContracts: [],
      paymentRequests: []
    });
    expect(rows.find((row) => row.contractKey === "a")?.unpaidCents).toBe("0");
    expect(rows.find((row) => row.contractKey === "b")?.unpaidCents).toBe("1000");
  });
});

/**
 * OPS-14：项目总览按合同钻取下游已结算未付。
 *
 * 已结算/已付来自经营投影同一份事实（与总览指标同源）；审批中申请、
 * 已批准待付来自付款申请，仅作为未付的构成说明分列展示，禁止与未付相加。
 * 不同合同、不同预付款与欠款不自动抵扣：每行只按本合同的已结算减已付计算。
 */
export interface ContractDrilldownProjectionRow {
  contractKey: string;
  settledCents: string | null;
  paidCents: string;
  unpaidCents: string | null;
}

export interface ContractDrilldownRequestRow {
  contractId: string;
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  paidAmountCents: bigint;
}

export interface ContractDrilldownRow {
  contractKey: string;
  contractCode: string;
  contractName: string;
  contractKindLabel: "下游合同" | "表外合同" | "对上合同" | "合同";
  settledCents: string | null;
  paidCents: string;
  unpaidCents: string | null;
  approvalPendingRequestCents: string;
  approvedPendingPaymentCents: string;
}

export function mergeContractDrilldown(input: {
  projectionRows: readonly ContractDrilldownProjectionRow[];
  contracts: ReadonlyArray<{ id: string; code: string | null; name: string }>;
  affiliateContracts: ReadonlyArray<{
    ledgerId: string;
    externalContractReference: string | null;
  }>;
  companyContracts: ReadonlyArray<{ id: string; contractName: string | null }>;
  paymentRequests: readonly ContractDrilldownRequestRow[];
}): ContractDrilldownRow[] {
  const contractById = new Map(
    input.contracts.map((row) => [row.id, row])
  );
  const affiliateById = new Map(
    input.affiliateContracts.map((row) => [row.ledgerId, row])
  );
  const companyById = new Map(
    input.companyContracts.map((row) => [row.id, row])
  );
  const settledByContract = new Map(
    input.projectionRows.map((row) => [row.contractKey, row])
  );
  const requestByContract = new Map<
    string,
    {
      approvalPendingRequestCents: bigint;
      approvedPendingPaymentCents: bigint;
    }
  >();
  for (const request of input.paymentRequests) {
    const current = requestByContract.get(request.contractId) ?? {
      approvalPendingRequestCents: 0n,
      approvedPendingPaymentCents: 0n
    };
    if (request.status === "approval_pending") {
      current.approvalPendingRequestCents += request.requestedAmountCents;
    }
    if (request.status === "approved_pending_payment" || request.status === "partially_paid") {
      const approved =
        request.approvedAmountCents ?? request.requestedAmountCents;
      const remaining = approved - request.paidAmountCents;
      if (remaining > 0n) current.approvedPendingPaymentCents += remaining;
    }
    requestByContract.set(request.contractId, current);
  }
  const keys = new Set<string>([
    ...settledByContract.keys(),
    ...requestByContract.keys()
  ]);
  return [...keys]
    .map((contractKey) => {
      const projection = settledByContract.get(contractKey);
      const pending = requestByContract.get(contractKey) ?? {
        approvalPendingRequestCents: 0n,
        approvedPendingPaymentCents: 0n
      };
      const contract = contractById.get(contractKey);
      const affiliate = affiliateById.get(contractKey);
      const company = companyById.get(contractKey);
      return {
        contractKey,
        contractCode: contract?.code ?? "",
        contractName:
          contract?.name ??
          affiliate?.externalContractReference ??
          company?.contractName ??
          "合同资料待核对",
        contractKindLabel: contract
          ? ("下游合同" as const)
          : affiliate
            ? ("表外合同" as const)
            : company
              ? ("对上合同" as const)
              : ("合同" as const),
        settledCents: projection ? projection.settledCents : "0",
        paidCents: projection ? projection.paidCents : "0",
        unpaidCents: projection ? projection.unpaidCents : "0",
        approvalPendingRequestCents:
          pending.approvalPendingRequestCents.toString(),
        approvedPendingPaymentCents:
          pending.approvedPendingPaymentCents.toString()
      };
    })
    .sort(
      (left, right) =>
        left.contractCode.localeCompare(right.contractCode, "zh-CN") ||
        left.contractKey.localeCompare(right.contractKey)
    );
}

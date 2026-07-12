import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import type {
  CreatePaymentRequestPayload
} from "../../api/core-flow-read.api";
import type { PaymentCreateSourceType } from "../payments/payment-list.config";
import { centsToYuanText, yuanToCents } from "./contract-takeover.config";

export interface BusinessSelectOption<T> {
  label: string;
  value: string;
  disabled: boolean;
  hint: string;
  record: T;
}

export interface PaymentCreateBusinessForm {
  sourceType: PaymentCreateSourceType;
  code: string;
  requestedAmountYuan: string;
}

export type SettlementBusinessOption =
  ContractBusinessOptionReadModel["settlements"][number];

export function toContractSelectOptions(
  contracts: ContractBusinessOptionReadModel[],
  mode: "settlement" | "payment"
): Array<BusinessSelectOption<ContractBusinessOptionReadModel>> {
  return contracts.map((contract) => ({
    label: contractOptionLabel(contract),
    value: contract.contractVersionId ?? contract.contractId,
    disabled: mode === "settlement" ? !contract.canCreateSettlement : !contract.canCreatePayment,
    hint:
      mode === "settlement"
        ? contract.settlementUnavailableReason ?? contractOptionHint(contract)
        : contract.paymentUnavailableReason ?? contractOptionHint(contract),
    record: contract
  }));
}

export function toSettlementSelectOptions(
  contract: ContractBusinessOptionReadModel | null
): Array<BusinessSelectOption<SettlementBusinessOption>> {
  return (contract?.settlements ?? []).map((settlement) => ({
    label: `${settlement.settlementNo} · ${settlement.periodLabel} · ${centsToYuanText(settlement.amountCents)}`,
    value: settlement.settlementId,
    disabled: !settlement.canCreatePayment,
    hint: settlement.unavailableReason ?? `${settlement.statusLabel} · 可发起单结算付款`,
    record: settlement
  }));
}

export function contractOptionLabel(contract: ContractBusinessOptionReadModel): string {
  return `${contract.contractNo} · ${contract.contractName} · ${contract.counterparty}`;
}

export function contractOptionHint(contract: ContractBusinessOptionReadModel): string {
  const takeover = contract.takeoverStatusLabel
    ? ` · ${contract.takeoverLevel ?? "-"}级${contract.takeoverStatusLabel}`
    : "";
  return `${contract.sourceLabel}${takeover} · ${contract.contractStatusLabel} · ${centsToYuanText(contract.amountCents)}`;
}

export function findContractOption(
  contracts: ContractBusinessOptionReadModel[],
  value: string
): ContractBusinessOptionReadModel | null {
  return contracts.find((contract) => (contract.contractVersionId ?? contract.contractId) === value) ?? null;
}

export function findSettlementOption(
  contract: ContractBusinessOptionReadModel | null,
  settlementId: string
): SettlementBusinessOption | null {
  return contract?.settlements.find((settlement) => settlement.settlementId === settlementId) ?? null;
}

export function buildPaymentCreatePayload(
  contract: ContractBusinessOptionReadModel | null,
  settlement: SettlementBusinessOption | null,
  form: PaymentCreateBusinessForm
): CreatePaymentRequestPayload {
  const commonPayload = {
    sourceType: form.sourceType,
    code: requiredText(form.code, "付款编号"),
    requestedAmountCents: yuanToCents(form.requestedAmountYuan, "申请金额")
  };

  if (form.sourceType === "settlement") {
    if (!contract?.canCreatePayment) {
      throw new Error(contract?.paymentUnavailableReason ?? "请选择可付款合同");
    }
    if (!settlement?.canCreatePayment) {
      throw new Error(settlement?.unavailableReason ?? "请选择可付款结算");
    }
    return {
      ...commonPayload,
      settlementId: settlement.settlementId
    };
  }

  if (!contract?.contractVersionId || !contract.canCreatePayment) {
    throw new Error(contract?.paymentUnavailableReason ?? "请选择可付款合同");
  }

  return {
    ...commonPayload,
    contractVersionId: contract.contractVersionId
  };
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label}不能为空`);
  }

  return value;
}

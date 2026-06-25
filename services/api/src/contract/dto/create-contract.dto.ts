export interface CreatePaymentTermsStageDto {
  name: string;
  basis:
    | "contract_amount"
    | "current_settlement"
    | "cumulative_settlement"
    | "fixed_amount"
    | "manual_amount";
  ratioBps?: number;
  fixedAmountCents?: number;
  triggerEvent: string;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
  retentionBps?: number;
  originalText: string;
}

export interface CreateContractDto {
  projectId: string;
  code: string;
  name: string;
  counterparty: string;
  companyEntityId?: string;
  amountCents: number;
  paymentTermsOriginalText: string;
  paymentStages: CreatePaymentTermsStageDto[];
}

/** Minimal payload to seed a workbench draft from a published business template. */
export interface CreateContractDraftDto {
  projectId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
}

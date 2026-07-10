export interface CreatePaymentTermsStageDto {
  name: string;
  stageType?: "advance" | "progress" | "final" | "retention" | "other";
  basis:
    | "contract_amount"
    | "current_settlement"
    | "cumulative_settlement"
    | "fixed_amount"
    | "manual_amount";
  ratioBps?: number;
  fixedAmountCents?: string;
  triggerAnchor?: "contract_effective" | "settlement_effective" | "final_settlement_effective";
  triggerEvent: string;
  dueDays: number;
  advanceDeductionMode?: "none" | "per_settlement_ratio" | "after_cumulative_settlement_ratio";
  advanceDeductionRatioBps?: number;
  advanceDeductionStartRatioBps?: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
  retentionBps?: number;
  originalText: string;
}

/** Minimal payload to seed a workbench draft from a published business template. */
export interface CreateContractDraftDto {
  projectId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
  paymentTermsOriginalText?: string;
  paymentStages?: CreatePaymentTermsStageDto[];
}

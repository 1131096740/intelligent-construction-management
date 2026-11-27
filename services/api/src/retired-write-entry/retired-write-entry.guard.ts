import {
  type CanActivate,
  type ExecutionContext,
  GoneException,
  Injectable
} from "@nestjs/common";

export type RetiredWriteEntry = Readonly<{
  controller: string;
  handler: string;
}>;

export const RETIRED_WRITE_ENTRIES: readonly RetiredWriteEntry[] = [
  { controller: "AuthController", handler: "wxLogin" },
  { controller: "BusinessPartyController", handler: "addContractParty" },
  { controller: "BusinessPartyController", handler: "removeContractParty" },
  { controller: "BusinessPartyController", handler: "updateContractPartyRole" },
  { controller: "ContractBillController", handler: "addRow" },
  { controller: "ContractBillController", handler: "deleteRow" },
  { controller: "ContractBillController", handler: "reorderRows" },
  { controller: "ContractBillController", handler: "replaceRows" },
  { controller: "ContractBillController", handler: "updateRow" },
  { controller: "ContractBillExcelController", handler: "applyImport" },
  { controller: "ContractBillExcelController", handler: "previewImport" },
  { controller: "ContractController", handler: "approveGovernedSeal" },
  { controller: "ContractController", handler: "approveSeal" },
  { controller: "ContractController", handler: "completeGovernedSeal" },
  { controller: "ContractController", handler: "copyAbandonedDraft" },
  { controller: "ContractController", handler: "createChangeDraft" },
  { controller: "ContractController", handler: "remindApproval" },
  { controller: "ContractController", handler: "submitApproval" },
  { controller: "ContractController", handler: "uploadFormalApprovalFile" },
  { controller: "ContractDocumentController", handler: "closeNegotiationRound" },
  {
    controller: "ContractDocumentController",
    handler: "createOfflineRevisionPreviewDownloadTicket"
  },
  { controller: "ContractDocumentController", handler: "disposeDifference" },
  { controller: "ContractDocumentController", handler: "openNegotiationRound" },
  { controller: "ContractDocumentController", handler: "retryOfflineRevision" },
  { controller: "ContractDocumentController", handler: "uploadOfflineRevision" },
  { controller: "ContractNumberRuleController", handler: "create" },
  { controller: "ContractNumberRuleController", handler: "stop" },
  { controller: "ContractNumberRuleController", handler: "update" },
  { controller: "ContractTakeoverController", handler: "confirm" },
  { controller: "ContractTemplateController", handler: "cloneVersion" },
  { controller: "ContractTemplateController", handler: "createBusinessScenario" },
  { controller: "ContractTemplateController", handler: "createClause" },
  {
    controller: "ContractTemplateController",
    handler: "createScenarioTemplateMapping"
  },
  { controller: "ContractTemplateController", handler: "createTemplate" },
  { controller: "ContractTemplateController", handler: "discardClauseVersion" },
  { controller: "ContractTemplateController", handler: "discardLayout" },
  { controller: "ContractTemplateController", handler: "discardVersion" },
  { controller: "ContractTemplateController", handler: "publishClauseVersion" },
  { controller: "ContractTemplateController", handler: "publishVersion" },
  { controller: "ContractTemplateController", handler: "revokeLayout" },
  { controller: "ContractTemplateController", handler: "revokeVersion" },
  { controller: "ContractTemplateController", handler: "stopVersion" },
  { controller: "ContractTemplateController", handler: "submitClauseVersion" },
  { controller: "ContractTemplateController", handler: "submitVersion" },
  { controller: "ContractTemplateController", handler: "updateBusinessScenario" },
  { controller: "ContractTemplateController", handler: "updateDraftVersion" },
  {
    controller: "ContractTemplateController",
    handler: "updateScenarioTemplateMapping"
  },
  { controller: "ContractWorkbenchController", handler: "createCheckpoint" },
  { controller: "ContractWorkbenchController", handler: "restore" },
  { controller: "ContractWorkbenchController", handler: "restoreCheckpoint" },
  { controller: "ContractWorkbenchController", handler: "save" },
  { controller: "ContractWorkbenchController", handler: "void" },
  { controller: "ExpenseClaimController", handler: "confirmRepayment" },
  { controller: "ExpenseClaimController", handler: "generateLoanFinalDisbursementPdf" },
  { controller: "ExpenseClaimController", handler: "recordLoanDisbursement" },
  { controller: "ExpenseClaimController", handler: "recordRepayment" },
  { controller: "ExpenseClaimController", handler: "reverseRepayment" },
  { controller: "ExpenseClaimController", handler: "uploadDisbursementVoucherFile" },
  { controller: "ExpenseClaimController", handler: "uploadRepaymentVoucherFile" },
  { controller: "InvoiceLedgerController", handler: "createInvoiceException" },
  {
    controller: "InvoiceLedgerController",
    handler: "createNoInvoiceConfirmation"
  },
  { controller: "InvoiceLedgerController", handler: "createProcurementInvoice" },
  { controller: "InvoiceLedgerController", handler: "reverseAllocation" },
  { controller: "InvoiceLedgerController", handler: "reviewInvoiceException" },
  {
    controller: "InvoiceLedgerController",
    handler: "reviewNoInvoiceConfirmation"
  },
  { controller: "MeController", handler: "uploadSignature" },
  {
    controller: "OrganizationController",
    handler: "previewRoleRemovalBatch"
  },
  { controller: "PaymentController", handler: "remindApproval" },
  { controller: "ProjectController", handler: "recordProxyPayment" },
  { controller: "ProjectController", handler: "recordReceipt" },
  { controller: "ProjectController", handler: "requestProjectFinancingQuota" },
  { controller: "ProjectController", handler: "requestSettlementExceptionQuota" },
  { controller: "ProjectController", handler: "reviewSettlementExceptionQuota" },
  { controller: "ProjectController", handler: "uploadProjectFinancingQuotaPrivateFile" },
  { controller: "ProjectExpenseController", handler: "confirmPurchaseReceipt" },
  { controller: "SettlementController", handler: "create" },
  { controller: "SettlementController", handler: "delegateApproval" },
  { controller: "SettlementController", handler: "remindApproval" },
  { controller: "SettlementController", handler: "reviewApproval" },
  { controller: "SettlementController", handler: "transferApproval" },
  { controller: "SettlementController", handler: "withdrawApproval" },
  { controller: "SettlementDraftController", handler: "abandon" },
  { controller: "SettlementDraftController", handler: "attachLineFile" },
  { controller: "SettlementDraftController", handler: "copyAbandoned" },
  { controller: "SettlementDraftController", handler: "create" },
  { controller: "SettlementDraftController", handler: "generateFrozenDocument" },
  { controller: "SettlementDraftController", handler: "invalidateLineAttachment" },
  { controller: "SettlementDraftController", handler: "linkCounterpartySignedDocument" },
  { controller: "SettlementDraftController", handler: "submit" },
  { controller: "SettlementDraftController", handler: "update" },
  { controller: "SettlementDraftController", handler: "uploadPrivateFile" },
  { controller: "SettlementImportController", handler: "apply" },
  { controller: "SettlementImportController", handler: "preview" },
  { controller: "SettlementTemplateGovernanceController", handler: "clone" },
  { controller: "SettlementTemplateGovernanceController", handler: "create" },
  { controller: "SettlementTemplateGovernanceController", handler: "discard" },
  {
    controller: "SettlementTemplateGovernanceController",
    handler: "downloadPreviewPdf"
  },
  {
    controller: "SettlementTemplateGovernanceController",
    handler: "downloadPreviewXlsx"
  },
  { controller: "SettlementTemplateGovernanceController", handler: "inspect" },
  { controller: "SettlementTemplateGovernanceController", handler: "preview" },
  { controller: "SettlementTemplateGovernanceController", handler: "publish" },
  { controller: "SettlementTemplateGovernanceController", handler: "stop" },
  { controller: "SettlementTemplateGovernanceController", handler: "submit" },
  { controller: "SettlementTemplateGovernanceController", handler: "update" },
  { controller: "SpotProcurementController", handler: "creditSupplierBalance" },
  {
    controller: "SpotProcurementPaymentController",
    handler: "executeSupplierBalance"
  },
  { controller: "SpotProcurementReceiptController", handler: "attachPhoto" },
  { controller: "SpotProcurementReceiptController", handler: "createDelegation" },
  { controller: "SpotProcurementReceiptController", handler: "deleteDraftPhoto" },
  { controller: "SpotProcurementReceiptController", handler: "resetDraft" },
  { controller: "SpotProcurementReceiptController", handler: "retryDutySms" },
  { controller: "SpotProcurementReceiptController", handler: "review" },
  { controller: "SpotProcurementReceiptController", handler: "revokeReview" },
  { controller: "SpotProcurementReceiptController", handler: "submit" },
  { controller: "SpotProcurementReceiptController", handler: "updateDraft" },
  { controller: "SpotProcurementReceiptController", handler: "uploadReceiptPhotoFile" },
  { controller: "VatRateOptionController", handler: "create" },
  { controller: "VatRateOptionController", handler: "update" },
  { controller: "WageStatementController", handler: "confirm" },
  { controller: "WageStatementController", handler: "createApprovedSource" },
  { controller: "WageStatementController", handler: "createDraft" },
  { controller: "WageStatementController", handler: "createRevision" },
  { controller: "WageStatementController", handler: "returnForReview" },
  { controller: "WageStatementController", handler: "submit" },
  { controller: "WageStatementController", handler: "updateDraft" }
] as const;

const RETIRED_WRITE_ENTRY_KEYS = new Set(
  RETIRED_WRITE_ENTRIES.map(
    (entry) => `${entry.controller}.${entry.handler}`
  )
);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class RetiredWriteEntryGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const method = context.switchToHttp().getRequest<{ method?: string }>().method;
    if (!method || SAFE_METHODS.has(method.toUpperCase())) return true;

    const key = `${context.getClass().name}.${context.getHandler().name}`;
    if (!RETIRED_WRITE_ENTRY_KEYS.has(key)) return true;

    throw new GoneException({
      statusCode: 410,
      code: "OLD_WRITE_ENTRY_RETIRED",
      message: "该旧办理入口已停止使用，请返回当前业务页面办理"
    });
  }
}

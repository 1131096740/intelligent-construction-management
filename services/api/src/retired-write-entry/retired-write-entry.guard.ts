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
  { controller: "ApprovalDelegationController", handler: "create" },
  { controller: "ApprovalDelegationController", handler: "revoke" },
  { controller: "AuthController", handler: "wxLogin" },
  { controller: "BusinessPartyController", handler: "addContractParty" },
  { controller: "BusinessPartyController", handler: "createVersion" },
  { controller: "BusinessPartyController", handler: "removeContractParty" },
  { controller: "BusinessPartyController", handler: "updateContractPartyRole" },
  { controller: "CompanyEntityController", handler: "create" },
  { controller: "CompanyEntityController", handler: "update" },
  { controller: "CompanyEntityController", handler: "updateStatus" },
  { controller: "ContractBillController", handler: "addRow" },
  { controller: "ContractBillController", handler: "deleteRow" },
  { controller: "ContractBillController", handler: "reorderRows" },
  { controller: "ContractBillController", handler: "replaceRows" },
  { controller: "ContractBillController", handler: "updateRow" },
  { controller: "ContractBillExcelController", handler: "applyImport" },
  { controller: "ContractBillExcelController", handler: "previewImport" },
  { controller: "ContractController", handler: "copyAbandonedDraft" },
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
  { controller: "ContractTemplateController", handler: "cloneLayout" },
  { controller: "ContractTemplateController", handler: "cloneVersion" },
  { controller: "ContractTemplateController", handler: "createBusinessScenario" },
  { controller: "ContractTemplateController", handler: "createClause" },
  { controller: "ContractTemplateController", handler: "createLayout" },
  {
    controller: "ContractTemplateController",
    handler: "createScenarioTemplateMapping"
  },
  { controller: "ContractTemplateController", handler: "createTemplate" },
  { controller: "ContractTemplateController", handler: "discardClauseVersion" },
  { controller: "ContractTemplateController", handler: "discardLayout" },
  { controller: "ContractTemplateController", handler: "discardVersion" },
  { controller: "ContractTemplateController", handler: "inspectLayout" },
  { controller: "ContractTemplateController", handler: "publishClauseVersion" },
  { controller: "ContractTemplateController", handler: "publishLayout" },
  { controller: "ContractTemplateController", handler: "publishVersion" },
  { controller: "ContractTemplateController", handler: "queueLayoutPreview" },
  { controller: "ContractTemplateController", handler: "revokeLayout" },
  { controller: "ContractTemplateController", handler: "revokeVersion" },
  { controller: "ContractTemplateController", handler: "stopLayout" },
  { controller: "ContractTemplateController", handler: "stopVersion" },
  { controller: "ContractTemplateController", handler: "submitClauseVersion" },
  { controller: "ContractTemplateController", handler: "submitLayout" },
  { controller: "ContractTemplateController", handler: "submitVersion" },
  { controller: "ContractTemplateController", handler: "updateBusinessScenario" },
  { controller: "ContractTemplateController", handler: "updateDraftVersion" },
  {
    controller: "ContractTemplateController",
    handler: "updateLayoutDraftVersion"
  },
  {
    controller: "ContractTemplateController",
    handler: "updateScenarioTemplateMapping"
  },
  { controller: "ContractWorkbenchController", handler: "createCheckpoint" },
  { controller: "ContractWorkbenchController", handler: "restore" },
  { controller: "ContractWorkbenchController", handler: "restoreCheckpoint" },
  { controller: "ContractWorkbenchController", handler: "save" },
  { controller: "ContractWorkbenchController", handler: "void" },
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
  { controller: "OrganizationController", handler: "applyRoleAddition" },
  { controller: "OrganizationController", handler: "applyRoleRemoval" },
  { controller: "OrganizationController", handler: "createDepartment" },
  { controller: "OrganizationController", handler: "createUser" },
  { controller: "OrganizationController", handler: "previewRoleAddition" },
  { controller: "OrganizationController", handler: "previewRoleRemoval" },
  {
    controller: "OrganizationController",
    handler: "previewRoleRemovalBatch"
  },
  { controller: "OrganizationController", handler: "updateDepartment" },
  { controller: "OrganizationController", handler: "updateUser" },
  { controller: "ProjectController", handler: "recordProxyPayment" },
  { controller: "ProjectController", handler: "recordReceipt" },
  { controller: "ProjectController", handler: "requestSettlementExceptionQuota" },
  { controller: "ProjectController", handler: "reviewSettlementExceptionQuota" },
  { controller: "SettlementController", handler: "create" },
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
  { controller: "VatRateOptionController", handler: "create" },
  { controller: "VatRateOptionController", handler: "update" }
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

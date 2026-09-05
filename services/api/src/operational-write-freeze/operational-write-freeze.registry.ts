export const OPERATIONAL_WRITE_MODULES = [
  "account",
  "approval",
  "contract",
  "expense",
  "files",
  "finance",
  "master_data",
  "operations",
  "organization",
  "payment",
  "procurement",
  "project",
  "settlement"
] as const;

export type OperationalWriteModule = (typeof OPERATIONAL_WRITE_MODULES)[number];

/**
 * Central, fail-closed classification for every Nest controller that currently
 * exposes POST, PUT, PATCH, or DELETE handlers. Class names are intentionally
 * used instead of URL prefixes: a controller rename or a new mutation fails the
 * static classification test and is rejected whenever it reaches the guard.
 */
export const OPERATIONAL_WRITE_CONTROLLER_MODULES: Readonly<
  Record<string, OperationalWriteModule>
> = Object.freeze({
  ApprovalDelegationController: "approval",
  ApprovalFormController: "approval",
  AffiliateClearingAuthorityController: "finance",
  AuthController: "account",
  BusinessEntryDefinitionController: "project",
  BusinessPartyController: "master_data",
  CompanyEntityController: "master_data",
  ContractBillController: "contract",
  ContractBillExcelController: "contract",
  ContractBillTransitionController: "contract",
  ContractController: "contract",
  ContractDocumentController: "contract",
  ContractDraftBillExcelController: "contract",
  ContractDraftController: "contract",
  ContractEndedApplicationRetentionController: "contract",
  ContractNumberRuleController: "contract",
  ContractTakeoverController: "contract",
  ContractTemplateController: "contract",
  ContractWorkbenchController: "contract",
  DraftRetentionController: "operations",
  ExpenseClaimController: "expense",
  FileController: "files",
  FundExecutionController: "finance",
  FundMovementController: "finance",
  HistoricalWageTakeoverController: "finance",
  InvoiceLedgerController: "finance",
  ClearingController: "finance",
  MeController: "account",
  OrganizationController: "organization",
  OperatingTakeoverController: "project",
  PayableRegistryController: "payment",
  PaymentController: "payment",
  ProjectController: "project",
  ProjectExpenseController: "expense",
  SettlementController: "settlement",
  SettlementDraftController: "settlement",
  SettlementImportController: "settlement",
  SettlementTemplateGovernanceController: "settlement",
  SettlementWorkbenchController: "settlement",
  SpotProcurementController: "procurement",
  SpotProcurementInvoiceController: "procurement",
  SpotProcurementPaymentController: "procurement",
  SpotProcurementReceiptController: "procurement",
  VatRateOptionController: "finance",
  WageStatementController: "finance"
});

/**
 * POST/PATCH actions that must remain available while business writes are
 * frozen so an operator and read-only users can authenticate safely.
 */
export const OPERATIONAL_WRITE_ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  "AuthController.changePassword",
  "AuthController.login",
  "AuthController.logout",
  "AuthController.refresh",
  "AuthController.wxLogin"
]);

export function operationalWriteActionKey(
  controller: object,
  handler: object
): string {
  const controllerName =
    typeof controller === "function" ? controller.name : controller.constructor.name;
  const handlerName = typeof handler === "function" ? handler.name : "";
  return `${controllerName}.${handlerName}`;
}

export function operationalWriteModuleFor(
  controller: object,
  request?: { params?: Record<string, string | undefined> }
) {
  const controllerName =
    typeof controller === "function" ? controller.name : controller.constructor.name;
  if (
    controllerName === "BusinessEntryDefinitionController" &&
    request?.params?.sceneKey === "business_party"
  ) {
    return "master_data" as const;
  }
  return OPERATIONAL_WRITE_CONTROLLER_MODULES[controllerName];
}

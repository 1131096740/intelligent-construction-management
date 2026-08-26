# 整站能力矩阵

状态：`ready`。本表仅交叉核验四份实施清单，不构成删除或生产写入授权。

## 输入证据

| 输入 | 状态 | SHA-256 |
| --- | --- | --- |
| nestRoutes | ready | `e0e6f03a3e7030e31953e7026f1ccce245ef4e04e11eef6353891b1978ff29a5` |
| webApiWrappers | ready | `d04743119f90014fdd1897628a9c1eaefcc9e7b1b4c6ddea401bed288a99c991` |
| webPageActions | ready | `a9d44da5344bf1915de1b410c0e40e74304efb3f3d3103347f83c7f5ce0f2d2d` |
| routeUsage | ready | `5455ca0211b2d77d42191d8c2b8207636584de87ec4b65da76c51ca67de23f3d` |

## 汇总

| 指标 | 数量 |
| --- | ---: |
| routeCount | 505 |
| pageRouteCount | 324 |
| externalTakeoverRouteCount | 70 |
| exitCandidateRouteCount | 108 |
| internalTaskRouteCount | 3 |
| unclassifiedRouteCount | 0 |
| mainRequestBindingCount | 513 |
| webRequestWithoutNestCount | 0 |
| authRequestWithoutNestCount | 0 |
| orphanWrapperCount | 0 |
| duplicateMutationRouteCount | 0 |
| registeredActionCount | 267 |
| actionBindingCount | 301 |
| acceptedActionBindingCount | 281 |
| unresolvedActionBindingCount | 0 |
| productionMutationConsumerPairCount | 261 |
| coveredProductionMutationConsumerPairCount | 261 |
| uncoveredProductionMutationConsumerPairCount | 0 |
| blockerCount | 0 |

## 路由矩阵

| 方法 | 路径 | 用途 | 消费面 | Web wrapper | 动作 | 写入覆盖 | 阻塞 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DELETE | /approval-delegations/:delegationId | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#revokeApprovalDelegation | — | not_applicable | — |
| DELETE | /contract-bills/:billId/rows/:rowKey | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#deleteBillRow | — | not_applicable | — |
| DELETE | /contract-drafts/:contractVersionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#deletePristineContractDraft<br>apps/web-admin/src/api/contract-workbench.api.ts#executeDeletePristineContractDraftAction | contract-draft.delete-pristine | covered | — |
| DELETE | /contract-drafts/:contractVersionId/edit-lease | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#releaseContractDraftEditLease | contract-draft.lease-release | covered | — |
| DELETE | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardContractBillTransitions | contract-bill-transition.discard | covered | — |
| DELETE | /contract-workbench/:contractVersionId/parties/:partySnapshotId | exit_candidate | none | — | — | not_applicable | — |
| DELETE | /projects/:projectId/participating-companies/:participantId | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#removeProjectParticipatingCompany | project-operating-profile.remove-participating-company | covered | — |
| DELETE | /spot-procurements/:procurementId/receipt/photos/:photoId | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#deleteSpotProcurementReceiptPhoto | spot-procurement-receipt.photo.remove | covered | — |
| GET | /approval-delegations | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listApprovalDelegations | — | not_applicable | — |
| GET | /approval-delegations/user-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchApprovalDelegationUserOptions | — | not_applicable | — |
| GET | /archives | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchArchives | — | not_applicable | — |
| GET | /audit-logs | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchAuditLogs | — | not_applicable | — |
| GET | /audit-logs/file-downloads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchFileDownloadAudits | — | not_applicable | — |
| GET | /business-entry-definitions/:sceneKey | external_takeover | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#fetchBusinessEntryDefinition | — | not_applicable | — |
| GET | /business-entry-definitions/:sceneKey/excel-template | external_takeover | none | apps/web-admin/src/api/business-entry.api.ts#downloadBusinessEntryExcelTemplate | — | not_applicable | — |
| GET | /business-parties/:partyId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getBusinessParty | — | not_applicable | — |
| GET | /business-parties | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listBusinessParties | — | not_applicable | — |
| GET | /business-parties/create-capability | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getBusinessPartyCreateCapability | — | not_applicable | — |
| GET | /business-parties/creation-result | page | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#getBusinessPartyCreationResult | — | not_applicable | — |
| GET | /clearing-cases/:caseId | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#fetchClearingCase | — | not_applicable | — |
| GET | /clearing-cases/capabilities | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#fetchClearingCapabilities | — | not_applicable | — |
| GET | /clearing-cases | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#fetchClearingCases | — | not_applicable | — |
| GET | /company-entities/:id/history | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#fetchCompanyEntityHistory | — | not_applicable | — |
| GET | /company-entities | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#fetchActiveCompanyEntities | — | not_applicable | — |
| GET | /company-entities/management | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#fetchCompanyEntityManagement | — | not_applicable | — |
| GET | /contract-bills/:billId/excel-template | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#downloadBillExcelTemplate | — | not_applicable | — |
| GET | /contract-business-scenarios/available | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#listAvailableContractBusinessScenarios | — | not_applicable | — |
| GET | /contract-business-scenarios | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#listContractScenarioGovernance | — | not_applicable | — |
| GET | /contract-business-scenarios/recommendations | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#recommendContractScenarioTemplates | — | not_applicable | — |
| GET | /contract-drafts/:contractVersionId/bills/:billKey/template | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#downloadContractDraftBillExcelTemplate | — | not_applicable | — |
| GET | /contract-drafts/:contractVersionId/workbench | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#executeAbandonContractDraftAction<br>apps/web-admin/src/api/contract-workbench.api.ts#executeContractBillRemainderCancellation<br>apps/web-admin/src/api/contract-workbench.api.ts#executeDeletePristineContractDraftAction<br>apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftOperationCapabilities<br>apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftWorkbench | contract-bill.remainder-cancellation<br>contract-draft.abandon-application<br>contract-draft.delete-pristine | not_applicable | — |
| GET | /contract-ended-retention/preview | page | web_api_wrapper | apps/web-admin/src/api/contract-ended-retention.api.ts#fetchContractEndedApplicationRetentionPreview | — | not_applicable | — |
| GET | /contract-layout-template-versions/:versionId/preview-generation | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#getLatestLayoutTemplatePreview | — | not_applicable | — |
| GET | /contract-layout-templates/:templateId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getLayoutTemplate | — | not_applicable | — |
| GET | /contract-layout-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedLayoutTemplates | — | not_applicable | — |
| GET | /contract-number-rules | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listContractNumberRules<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchActiveContractNumberRules | — | not_applicable | — |
| GET | /contract-templates/:templateId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getContractTemplate | — | not_applicable | — |
| GET | /contract-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedContractTemplates | — | not_applicable | — |
| GET | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractBillTransitions | — | not_applicable | — |
| GET | /contract-versions/:toContractVersionId/bill-transitions/options | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractBillTransitionOptions | — | not_applicable | — |
| GET | /contract-workbench/:contractId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractWorkbench | — | not_applicable | — |
| GET | /contract-workbench/:contractVersionId/documents | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listContractDocuments | — | not_applicable | — |
| GET | /contract-workbench/:contractVersionId/negotiation-rounds | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#listContractNegotiationRounds | — | not_applicable | — |
| GET | /contract-workbench/:contractVersionId/offline-revisions | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#listContractOfflineRevisionHistory | — | not_applicable | — |
| GET | /contract-workbench/:contractId/transfer-capability | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftTransferCapabilities | — | not_applicable | — |
| GET | /contract-workbench | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#listContractDrafts | — | not_applicable | — |
| GET | /contracts/:contractVersionId/authorizations/readiness | exit_candidate | none | — | — | not_applicable | — |
| GET | /contracts/:contractVersionId/change-eligibility | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractChangeEligibility | — | not_applicable | — |
| GET | /contracts/:contractId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeContractSigningMaterialChange<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchContractDetail<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareContractApprovalReviewAction<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareContractApprovalWithdrawalAction | contract.signing-material-change | not_applicable | — |
| GET | /contracts/:contractVersionId/formal-files/counterparty | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listCounterpartySignedFiles | — | not_applicable | — |
| GET | /contracts | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLedger | — | not_applicable | — |
| GET | /contracts/create-capability | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractCreateCapabilities | — | not_applicable | — |
| GET | /contracts/ledger-export | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractLedgerExport | — | not_applicable | — |
| GET | /contracts/lifecycle-ledger | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLifecycleLedger | — | not_applicable | — |
| GET | /contracts/payment-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentContractOptions | — | not_applicable | — |
| GET | /contracts/settlement-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementContractOptions | — | not_applicable | — |
| GET | /contracts/workbench | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractWorkbenchLedger | — | not_applicable | — |
| GET | /draft-retention/preview | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchDraftRetentionPreview | — | not_applicable | — |
| GET | /expense-claims/:claimId/capability | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimActionCapability | — | not_applicable | — |
| GET | /expense-claims/:claimId | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimDetail | — | not_applicable | — |
| GET | /expense-claims/:claimId/repayments/:repaymentId/capability | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimRepaymentActionCapability | — | not_applicable | — |
| GET | /expense-claims/create-options | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimCreateOptions | — | not_applicable | — |
| GET | /expense-claims | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaims | — | not_applicable | — |
| GET | /files/:fileId/download-ticket-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadPrivateFileByTicket<br>apps/web-admin/src/api/core-flow-read.api.ts#getPrivateFileDownloadTicketCapability | contract-file.download-private-file-by-ticket | not_applicable | — |
| GET | /files/:fileId/download | page | signed_ticket_delivery | — | — | not_applicable | — |
| GET | /funds-workbench | page | web_api_wrapper | apps/web-admin/src/api/funds-workbench.api.ts#fetchFundsWorkbench | — | not_applicable | — |
| GET | /global-invoices/capabilities | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#fetchGlobalInvoiceCapabilities | — | not_applicable | — |
| GET | /global-invoices | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#fetchGlobalInvoices | — | not_applicable | — |
| GET | /health | internal_task | machine_probe | — | — | not_applicable | — |
| GET | /health/readiness | internal_task | machine_probe | — | — | not_applicable | — |
| GET | /me/signature/canvas-capabilities | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getCanvasSignatureCapabilities | — | not_applicable | — |
| GET | /me/signature/canvas-handoffs/:token | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getCanvasSignatureHandoff | — | not_applicable | — |
| GET | /me/signature/ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getSignatureTicket | — | not_applicable | — |
| GET | /me/work-items | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkItems | — | not_applicable | — |
| GET | /me/workbench-summary | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkbenchSummary | — | not_applicable | — |
| GET | /organization/directory | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#fetchOrganizationDirectory | — | not_applicable | — |
| GET | /organization/permission-integrity | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#fetchPermissionIntegrity | — | not_applicable | — |
| GET | /payments/:paymentId/capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentActionCapability | — | not_applicable | — |
| GET | /payments/:paymentId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentDetail<br>apps/web-admin/src/api/core-flow-read.api.ts#preparePaymentApprovalReviewAction<br>apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecutionWithUpload | payment-execution.record | not_applicable | — |
| GET | /payments/contract-application | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractPaymentApplication | — | not_applicable | — |
| GET | /payments/create-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentCreateCapability | — | not_applicable | — |
| GET | /payments | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentLedger<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentLifecycleLedger | — | not_applicable | — |
| GET | /projects/:projectId/affiliate-business-facts/:factId/capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateFactCapability | — | not_applicable | — |
| GET | /projects/:projectId/affiliate-business-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateBusinessFacts | — | not_applicable | — |
| GET | /projects/:projectId/affiliate-business-facts/record-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateRecordCapability | — | not_applicable | — |
| GET | /projects/:projectId/affiliate-company-contracts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateCompanyContracts | — | not_applicable | — |
| GET | /projects/:projectId/construction-enterprise-options | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#fetchProjectConstructionEnterpriseOptions | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/:takeoverId/detail-export | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractTakeoverDetailExport | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/:takeoverId | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getContractTakeover | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#fetchContractTaxFactRevisions | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/capability | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractTakeoverProjectCapability | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/company-entity-candidates | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listHistoricalCompanyEntityCandidates | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/import-batches | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listContractTakeoverImportBatches | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/import-template | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractTakeoverImportTemplate | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/ledger-export | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractTakeoverLedgerExport | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listContractTakeovers | — | not_applicable | — |
| GET | /projects/:projectId/expense-requests/:expenseRequestId/approval-detail | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectExpenseReceiptWithPreflight<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectExpenseApprovalDetail<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareProjectExpenseApprovalReviewAction<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareProjectExpenseWithdrawalAction<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecutionWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinanceWithPreflight | project-expense.execution-local-status<br>project-expense.finance-local-status<br>project-expense.receipt-confirm-local-status | not_applicable | — |
| GET | /projects/:projectId/expense-requests/:expenseRequestId/capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectExpenseActionCapability | — | not_applicable | — |
| GET | /projects/:projectId/expense-requests/create-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectExpenseCreateCapability | — | not_applicable | — |
| GET | /projects/:projectId/expense-requests | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectExpenseRequests | — | not_applicable | — |
| GET | /projects/:projectId/financing-quotas/:quotaId/review-capability | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaReviewAction<br>apps/web-admin/src/api/project-financing-quota.api.ts#fetchProjectFinancingQuotaReviewCapability | project-financing-quota.review-approve<br>project-financing-quota.review-reject | not_applicable | — |
| GET | /projects/:projectId/financing-quotas/:quotaId/termination-capability | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaTerminationAction<br>apps/web-admin/src/api/project-financing-quota.api.ts#fetchProjectFinancingQuotaTerminationCapability | project-financing-quota.terminate | not_applicable | — |
| GET | /projects/:projectId/financing-quotas | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaReviewAction<br>apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaTerminationAction<br>apps/web-admin/src/api/project-financing-quota.api.ts#fetchProjectFinancingQuotaRequestCapability<br>apps/web-admin/src/api/project-financing-quota.api.ts#fetchProjectFinancingQuotaWorkbench<br>apps/web-admin/src/api/project-financing-quota.api.ts#requestProjectFinancingQuotaWithUpload | project-financing-quota.request<br>project-financing-quota.review-approve<br>project-financing-quota.review-reject<br>project-financing-quota.terminate | not_applicable | — |
| GET | /projects/:projectId/operating-funds-overview | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectOperatingOverview | — | not_applicable | — |
| GET | /projects/:projectId/operating-profile | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#fetchProjectOperatingProfile | — | not_applicable | — |
| GET | /projects/:projectId/operating-takeovers/:batchId | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#fetchOperatingTakeoverDetail | — | not_applicable | — |
| GET | /projects/:projectId/operating-takeovers/capability | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#fetchOperatingTakeoverCapability | — | not_applicable | — |
| GET | /projects/:projectId/operating-takeovers | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#fetchOperatingTakeoverBatches | — | not_applicable | — |
| GET | /projects/:projectId/operating-takeovers/scenes | external_takeover | none | — | — | not_applicable | — |
| GET | /projects/:projectId/operating-takeovers/workbook-template | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#downloadOperatingTakeoverTemplate | — | not_applicable | — |
| GET | /projects/:projectId/participating-company-options | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#fetchProjectParticipatingCompanyOptions | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId/final-preparation | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementFinalPreparation | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId/line-attachments | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#listSettlementDraftLineAttachments | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#executeSettlementDraftLifecycleAction<br>apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementDraftRecord | settlement-draft.abandon-application<br>settlement-draft.delete-pristine | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/capability | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementProjectCapability | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#listSettlementDraftRecords | — | not_applicable | — |
| GET | /projects/:projectId/update-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpdateCapability | — | not_applicable | — |
| GET | /projects/:projectId/upstream-fund-facts/:fundFactId/confirmation-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpstreamFundConfirmationCapability | — | not_applicable | — |
| GET | /projects/:projectId/upstream-fund-facts/record-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpstreamFundRecordCapability | — | not_applicable | — |
| GET | /projects/:projectId/upstream-fund-facts/reference-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpstreamFundReferenceOptions | — | not_applicable | — |
| GET | /projects/affiliate-mapping-report | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateMappingReport | — | not_applicable | — |
| GET | /projects/contract-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractCreateProjects | — | not_applicable | — |
| GET | /projects/create-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectCreateCapability | — | not_applicable | — |
| GET | /projects | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjects | — | not_applicable | — |
| GET | /projects/roster | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectRoster | — | not_applicable | — |
| GET | /settlement-templates/:templateId | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#getSettlementTemplate | — | not_applicable | — |
| GET | /settlement-templates | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#listSettlementTemplates | — | not_applicable | — |
| GET | /settlement-workbench/contract-versions/:contractVersionId/import-template | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#downloadSettlementImportTemplate | — | not_applicable | — |
| GET | /settlement-workbench/contract-versions/:contractVersionId/participant-options | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#fetchSettlementParticipantOptions | — | not_applicable | — |
| GET | /settlement-workbench/contract-versions/:contractVersionId/source-lines | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#fetchSettlementSourceLines | — | not_applicable | — |
| GET | /settlement-workbench/projects/:projectId/contract-versions/:contractVersionId/template-recommendations | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#fetchSettlementTemplateRecommendations | — | not_applicable | — |
| GET | /settlement-workbench/projects/:projectId/imports/:importId/errors.xlsx | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#downloadSettlementImportErrors | — | not_applicable | — |
| GET | /settlement-workbench/projects/:projectId/imports/:importId/result.xlsx | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#downloadSettlementImportResult | — | not_applicable | — |
| GET | /settlements/:settlementId/attachment-templates/:templateKey/download | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementAttachmentTemplate | — | not_applicable | — |
| GET | /settlements/:settlementId/capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementActionCapability | — | not_applicable | — |
| GET | /settlements/:settlementId/draft-excel | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementDraftExcel | — | not_applicable | — |
| GET | /settlements/:settlementId/recovery | page | web_api_wrapper | apps/web-admin/src/api/settlement-recovery.api.ts#fetchSettlementRecovery | — | not_applicable | — |
| GET | /settlements/:settlementId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementDetail<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareSettlementApprovalWithdrawalAction | — | not_applicable | — |
| GET | /settlements/ledger-export | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementLedgerExport | — | not_applicable | — |
| GET | /settlements/lifecycle-ledger | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementLifecycleLedger | — | not_applicable | — |
| GET | /settlements | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementLedger | — | not_applicable | — |
| GET | /settlements/workbench | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementWorkbenchLedger | — | not_applicable | — |
| GET | /spot-procurement-payments/:paymentId | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementInvoiceAppend<br>apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementPaymentDetail<br>apps/web-admin/src/api/spot-procurement.api.ts#prepareSpotProcurementPaymentReviewAction | spot-procurement.invoice-append | not_applicable | — |
| GET | /spot-procurement-payments | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementPayments | — | not_applicable | — |
| GET | /spot-procurements/:procurementId/receipt | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementInvoiceAppend<br>apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementReceipt | spot-procurement.invoice-append | not_applicable | — |
| GET | /spot-procurements/:procurementId | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementDetail<br>apps/web-admin/src/api/spot-procurement.api.ts#prepareSpotProcurementReviewAction<br>apps/web-admin/src/api/spot-procurement.api.ts#prepareSpotProcurementWithdrawalAction | — | not_applicable | — |
| GET | /spot-procurements/application-text-suggestions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementApplicationTextSuggestions | — | not_applicable | — |
| GET | /spot-procurements/capabilities | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementCapabilities | — | not_applicable | — |
| GET | /spot-procurements/create-project-options | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementCreateProjectOptions | — | not_applicable | — |
| GET | /spot-procurements | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurements | — | not_applicable | — |
| GET | /standard-clauses/history | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#listStandardClauseHistory | — | not_applicable | — |
| GET | /standard-clauses | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedStandardClauses | — | not_applicable | — |
| GET | /vat-rate-options | exit_candidate | none | — | — | not_applicable | — |
| PATCH | /auth/profile | page | auth_store | — | — | not_applicable | — |
| PATCH | /clearing-cases/events/:eventId/draft | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#reviseClearingEvent | clearing.event.revise | covered | — |
| PATCH | /company-entities/:id | exit_candidate | none | apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntity | — | not_applicable | — |
| PATCH | /contract-bills/:billId/rows/:rowKey | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#updateBillRow | — | not_applicable | — |
| PATCH | /contract-business-scenarios/:scenarioId | exit_candidate | none | apps/web-admin/src/api/contract-scenario.api.ts#updateContractBusinessScenario | — | not_applicable | — |
| PATCH | /contract-layout-template-versions/:versionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#updateLayoutTemplateVersion | — | not_applicable | — |
| PATCH | /contract-number-rules/:ruleId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#updateContractNumberRule | — | not_applicable | — |
| PATCH | /contract-scenario-template-mappings/:mappingId | exit_candidate | none | apps/web-admin/src/api/contract-scenario.api.ts#updateContractScenarioMapping | — | not_applicable | — |
| PATCH | /contract-template-versions/:versionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#updateContractTemplateVersion | — | not_applicable | — |
| PATCH | /contract-workbench/:contractVersionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraft | — | not_applicable | — |
| PATCH | /contract-workbench/:contractVersionId/parties/:partySnapshotId | exit_candidate | none | — | — | not_applicable | — |
| PATCH | /organization/departments/:departmentId | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#updateOrganizationDepartment | — | not_applicable | — |
| PATCH | /organization/users/:userId | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#updateOrganizationUser | — | not_applicable | — |
| PATCH | /projects/:projectId/contract-takeovers/:takeoverId | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#updateContractTakeover | contract-takeover.update | covered | — |
| PATCH | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#updateContractTaxFactRevision | contract-tax-fact.update-revision | covered | — |
| PATCH | /projects/:projectId/contract-takeovers/import-batches/:batchId/review-result | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverImportBatch | contract-takeover.review-import-batch | covered | — |
| PATCH | /projects/:projectId/operating-profile | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#updateProjectOperatingProfile | project-operating-profile.save | covered | — |
| PATCH | /projects/:projectId/operating-takeovers/:batchId/rows/:rowId | external_takeover | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#updateOperatingTakeoverRow | operating-takeover.update-row | covered | — |
| PATCH | /projects/:projectId/participating-companies/:participantId/deactivation | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#deactivateProjectParticipatingCompany | project-operating-profile.deactivate-participating-company | covered | — |
| PATCH | /projects/:projectId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#updateProject | project.update | covered | — |
| PATCH | /projects/:projectId/settlement-drafts/:draftId | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#updateSettlementDraftRecord | settlement-draft.update-local-gate | covered | — |
| PATCH | /settlement-template-versions/:versionId | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#updateSettlementTemplateVersion | — | not_applicable | — |
| PATCH | /spot-procurement-payments/:paymentId/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentDraft | spot-procurement-payment.draft.update | covered | — |
| PATCH | /spot-procurement-payments/:paymentId/payer | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentPayer | spot-procurement-payment.payer.update | covered | — |
| PATCH | /spot-procurements/:procurementId/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementDraft | spot-procurement.draft.update | covered | — |
| PATCH | /spot-procurements/:procurementId/receipt/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementReceiptDraft | spot-procurement-receipt.draft.update | covered | — |
| PATCH | /vat-rate-options/:optionId | exit_candidate | none | — | — | not_applicable | — |
| POST | /approval-delegations | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#createApprovalDelegation | — | not_applicable | — |
| POST | /approval-forms/:businessType/:businessId/download | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm | contract-approval.download-form<br>payment-detail.approval-pdf<br>spot-procurement-payment.pdf.download<br>spot-procurement.application-pdf.download | covered | — |
| POST | /auth/change-password | page | auth_store | — | — | not_applicable | — |
| POST | /auth/login | page | auth_store | — | — | not_applicable | — |
| POST | /auth/logout | page | auth_store | — | — | not_applicable | — |
| POST | /auth/refresh | page | auth_store | — | — | not_applicable | — |
| POST | /auth/wx-login | exit_candidate | none | — | — | not_applicable | — |
| POST | /business-entry-definitions/:sceneKey/create-target | external_takeover | none | apps/web-admin/src/api/business-entry.api.ts#issueBusinessEntryCreateTarget | — | not_applicable | — |
| POST | /business-entry-definitions/:sceneKey/excel-preview | external_takeover | none | apps/web-admin/src/api/business-entry.api.ts#previewBusinessEntryExcel | — | not_applicable | — |
| POST | /business-entry-definitions/:sceneKey/freeze | external_takeover | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#freezeBusinessEntrySnapshot | business-party.create | covered | — |
| POST | /business-entry-definitions/:sceneKey/submission-target | external_takeover | none | apps/web-admin/src/api/business-entry.api.ts#issueBusinessEntrySubmissionTarget | — | not_applicable | — |
| POST | /business-entry-definitions/:sceneKey/validate | external_takeover | none | apps/web-admin/src/api/business-entry.api.ts#validateBusinessEntryDraft | — | not_applicable | — |
| POST | /business-entry-definitions/business-party/create/probe | page | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#issueBusinessPartyDefinitionProbe | business-party.create.prepare | covered | — |
| POST | /business-entry-definitions/business-party/create/submission-target | page | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#issueBusinessPartySubmissionTarget | business-party.create.prepare | covered | — |
| POST | /business-entry-definitions/business-party/create/validate | page | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#validateBusinessPartyDraft | business-party.create.prepare | covered | — |
| POST | /business-parties/:partyId/versions | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createBusinessPartyVersion | — | not_applicable | — |
| POST | /business-parties | page | web_api_wrapper | apps/web-admin/src/api/business-entry.api.ts#submitBusinessPartyCreation | business-party.create | covered | — |
| POST | /clearing-cases/:caseId/events | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#createClearingEvent | clearing.event.prepare | covered | — |
| POST | /clearing-cases | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#createClearingCase | clearing.case.create | covered | — |
| POST | /clearing-cases/events/:eventId/attest | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#attestClearingEvent | clearing.event.attest | covered | — |
| POST | /clearing-cases/events/:eventId/confirm | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#confirmClearingEvent | clearing.event.confirm | covered | — |
| POST | /clearing-cases/events/:eventId/reopen | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#reopenClearingEvent | clearing.event.reopen | covered | — |
| POST | /clearing-cases/events/:eventId/return | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#returnClearingEvent | clearing.event.return | covered | — |
| POST | /clearing-cases/events/:eventId/submit | page | web_api_wrapper | apps/web-admin/src/api/clearing.api.ts#submitClearingEvent | clearing.event.submit | covered | — |
| POST | /company-entities/:id/status | exit_candidate | none | apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntityStatus | — | not_applicable | — |
| POST | /company-entities | exit_candidate | none | apps/web-admin/src/api/company-entity.api.ts#createCompanyEntity | — | not_applicable | — |
| POST | /contract-bill-imports/:importId/apply | exit_candidate | none | — | — | not_applicable | — |
| POST | /contract-bills/:billId/excel-imports | exit_candidate | none | — | — | not_applicable | — |
| POST | /contract-bills/:billId/rows/:rowKey/remainder-cancellation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#executeContractBillRemainderCancellation | contract-bill.remainder-cancellation | covered | — |
| POST | /contract-bills/:billId/rows | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#addBillRow | — | not_applicable | — |
| POST | /contract-bills/:billId/rows/reorder | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#reorderBillRows | — | not_applicable | — |
| POST | /contract-business-scenarios/:scenarioId/template-mappings | exit_candidate | none | apps/web-admin/src/api/contract-scenario.api.ts#createContractScenarioMapping | — | not_applicable | — |
| POST | /contract-business-scenarios | exit_candidate | none | apps/web-admin/src/api/contract-scenario.api.ts#createContractBusinessScenario | — | not_applicable | — |
| POST | /contract-document-differences/:differenceId/disposition | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#disposeContractDocumentDifference | — | not_applicable | — |
| POST | /contract-documents/:documentId/retry | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#retryContractDocument | contract-document.retry | covered | — |
| POST | /contract-drafts/:contractVersionId/bills/:billKey/import-preview | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#previewContractDraftBillExcelImport | contract-bill-import.preview | covered | — |
| POST | /contract-drafts/:contractVersionId/edit-lease | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#acquireContractDraftEditLease | contract-draft.lease-acquire | covered | — |
| POST | /contract-drafts/:contractVersionId/edit-lease/heartbeat | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#heartbeatContractDraftEditLease | contract-draft.lease-heartbeat | covered | — |
| POST | /contract-drafts/:contractVersionId/edit-lease/takeover | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#takeOverContractDraftEditLease | contract-draft.lease-takeover | covered | — |
| POST | /contract-drafts/:contractVersionId/files | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#uploadContractWorkbenchPrivateFile | contract-authorization.upload-file<br>contract-bill-import.upload-file<br>contract-counterparty-signed.upload-private-file<br>contract-document.upload-file<br>contract-party.upload-file | covered | — |
| POST | /contract-drafts/:contractVersionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueContractDraftPreview | contract-draft.preview-queue | covered | — |
| POST | /contract-drafts/:contractVersionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitContractDraft | contract-workbench.submit | covered | — |
| POST | /contract-ended-retention/:contractVersionId/hold-release | page | web_api_wrapper | apps/web-admin/src/api/contract-ended-retention.api.ts#releaseContractEndedApplicationRetentionHold | contract-ended-retention.release-hold | covered | — |
| POST | /contract-ended-retention/:contractVersionId/holds | page | web_api_wrapper | apps/web-admin/src/api/contract-ended-retention.api.ts#createContractEndedApplicationRetentionHold | contract-ended-retention.create-hold | covered | — |
| POST | /contract-layout-template-versions/:versionId/clone | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#cloneLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/discard | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#discardLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/inspection | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#inspectLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/preview-generation | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#queueLayoutTemplatePreview | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/publication | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#publishLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/revoke | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#revokeLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/stop | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#stopLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-template-versions/:versionId/submission | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#submitLayoutTemplateVersion | — | not_applicable | — |
| POST | /contract-layout-templates | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createLayoutTemplate | — | not_applicable | — |
| POST | /contract-negotiation-rounds/:roundId/close | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#closeContractNegotiationRound | — | not_applicable | — |
| POST | /contract-number-rules/:ruleId/stop | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#stopContractNumberRule | — | not_applicable | — |
| POST | /contract-number-rules | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createContractNumberRule | — | not_applicable | — |
| POST | /contract-offline-revisions/:revisionId/preview-download-ticket | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#openContractRevisionPreview | — | not_applicable | — |
| POST | /contract-offline-revisions/:revisionId/retry | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#retryContractOfflineRevision | — | not_applicable | — |
| POST | /contract-template-versions/:versionId/clone | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#cloneContractTemplateVersion | — | not_applicable | — |
| POST | /contract-template-versions/:versionId/discard | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#discardContractTemplateVersion | — | not_applicable | — |
| POST | /contract-template-versions/:versionId/publication | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#publishContractTemplateVersion | — | not_applicable | — |
| POST | /contract-template-versions/:versionId/revoke | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#revokeContractTemplateVersion | — | not_applicable | — |
| POST | /contract-template-versions/:versionId/stop | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#stopContractTemplateVersion | — | not_applicable | — |
| POST | /contract-template-versions/:versionId/submission | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#submitContractTemplateVersion | — | not_applicable | — |
| POST | /contract-templates | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createContractTemplate | — | not_applicable | — |
| POST | /contract-versions/:toContractVersionId/bill-transitions/confirm | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmContractBillTransitions | contract-bill-transition.confirm | covered | — |
| POST | /contract-workbench/:contractVersionId/checkpoints/:checkpointId/restore | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#restoreDraftCheckpoint | — | not_applicable | — |
| POST | /contract-workbench/:contractVersionId/checkpoints | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createDraftCheckpoint | — | not_applicable | — |
| POST | /contract-workbench/:contractVersionId/documents | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueContractDocument | contract-document.queue | covered | — |
| POST | /contract-workbench/:contractVersionId/negotiation-rounds | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#openContractNegotiationRound | — | not_applicable | — |
| POST | /contract-workbench/:contractVersionId/offline-revisions | exit_candidate | none | apps/web-admin/src/api/contract-negotiation.api.ts#uploadContractNegotiationRevision | — | not_applicable | — |
| POST | /contract-workbench/:contractVersionId/parties | exit_candidate | none | — | — | not_applicable | — |
| POST | /contract-workbench/:contractId/restore | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#restoreContractDraft | — | not_applicable | — |
| POST | /contract-workbench/:contractVersionId/settlement-mode/confirm | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmContractSettlementMode | contract-workbench.confirm-settlement-mode | covered | — |
| POST | /contract-workbench/:contractId/transfer | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#transferContractDraft | contract-draft.transfer | covered | — |
| POST | /contract-workbench/:contractVersionId/type-change-preview | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#previewContractTypeChange | contract-workbench.preview-type-change | covered | — |
| POST | /contract-workbench/:contractVersionId/type-change | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#applyContractTypeChange | contract-workbench.apply-type-change | covered | — |
| POST | /contract-workbench/:contractId/void | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#voidContractDraft | — | not_applicable | — |
| POST | /contracts/:contractVersionId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#abandonContractDraft<br>apps/web-admin/src/api/contract-workbench.api.ts#executeAbandonContractDraftAction | contract-draft.abandon-application | covered | — |
| POST | /contracts/:contractVersionId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegateContractApproval | contract-approval.delegate | covered | — |
| POST | /contracts/:contractVersionId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindContractApproval | contract-approval.remind | covered | — |
| POST | /contracts/:contractVersionId/approval-submission | exit_candidate | none | — | — | not_applicable | — |
| POST | /contracts/:contractVersionId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferContractApproval | contract-approval.transfer | covered | — |
| POST | /contracts/:contractVersionId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeContractApprovalWithdrawalAction | contract-approval.withdraw | covered | — |
| POST | /contracts/:contractVersionId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeContractApprovalReviewAction | contract-approval.review-approve<br>contract-approval.review-reject | covered | — |
| POST | /contracts/:contractVersionId/archive-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractArchive | contract-archive.confirm | covered | — |
| POST | /contracts/:contractVersionId/archive-files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadContractArchiveFile | contract-archive.associate | covered | — |
| POST | /contracts/:contractVersionId/authorizations | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#setContractAuthorization | contract-authorization.set | covered | — |
| POST | /contracts/:contractVersionId/change-drafts | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createContractChangeDraft | contract-change.create-draft | covered | — |
| POST | /contracts/:contractVersionId/copies | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedContractDraft | — | not_applicable | — |
| POST | /contracts/:contractVersionId/formal-files/approval | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#uploadContractFormalApprovalFile | — | not_applicable | — |
| POST | /contracts/:contractVersionId/formal-files/counterparty/confirmation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmCounterpartySignedFile | contract-counterparty-signed.confirm | covered | — |
| POST | /contracts/:contractVersionId/formal-files/counterparty | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#uploadCounterpartySignedFiles | contract-counterparty-signed.submit-files | covered | — |
| POST | /contracts/:contractVersionId/formal-files/final/confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmMutuallySignedContract | contract-final.confirm | covered | — |
| POST | /contracts/:contractVersionId/formal-files/final | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadMutuallySignedContract | contract-final.associate | covered | — |
| POST | /contracts/:contractVersionId/formal-files/final/return | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#returnMutuallySignedContractForCorrection | contract-final.return | covered | — |
| POST | /contracts/:contractVersionId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generateContractPdfArchive | contract-archive.generate-pdf | covered | — |
| POST | /contracts/:contractVersionId/readiness | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#checkContractSubmissionReadiness | contract-workbench.check-submission-readiness | covered | — |
| POST | /contracts/:contractVersionId/seal-approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#approveContractSeal | contract-seal.approve-legacy | covered | — |
| POST | /contracts/:contractVersionId/seal/approve | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#approveGovernedContractSeal | contract-seal.approve-governed | covered | — |
| POST | /contracts/:contractVersionId/seal/complete | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#completeContractSeal | contract-seal.complete | covered | — |
| POST | /contracts/:contractVersionId/signing/material-change | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeContractSigningMaterialChange | contract.signing-material-change | covered | — |
| POST | /contracts | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createWorkbenchDraft | contract-draft.create | covered | — |
| POST | /draft-retention/controlled-entry | internal_task | operator_endpoint | — | — | not_applicable | — |
| POST | /expense-claims/:claimId/append-attachment-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#uploadExpenseClaimAppendAttachmentFile | expense-claim.attachment.append-upload | covered | — |
| POST | /expense-claims/:claimId/approval | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#reviewExpenseClaim | expense-claim.review | covered | — |
| POST | /expense-claims/:claimId/attachments/:attachmentId/removal | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#removeExpenseClaimAttachment | expense-claim.attachment.remove | covered | — |
| POST | /expense-claims/:claimId/attachments/append | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#appendExpenseClaimAttachment | expense-claim.attachment.append | covered | — |
| POST | /expense-claims/:claimId/attachments | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#attachExpenseClaimAttachment | expense-claim.attachment.attach | covered | — |
| POST | /expense-claims/:claimId/disbursement-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#uploadExpenseClaimLoanDisbursementVoucherFile | expense-claim.loan.disbursement-voucher.upload | covered | — |
| POST | /expense-claims/:claimId/disbursements | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimLoanDisbursement | expense-claim.loan.disbursement.record | covered | — |
| POST | /expense-claims/:claimId/draft-attachment-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#uploadExpenseClaimDraftAttachmentFile | expense-claim.attachment.draft-upload | covered | — |
| POST | /expense-claims/:claimId/final-disbursement-pdf | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#generateExpenseClaimFinalDisbursementPdf | expense-claim.loan.final-disbursement-pdf.generate | covered | — |
| POST | /expense-claims/:claimId/final-payment-pdf | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#generateExpenseClaimFinalPaymentPdf | expense-claim.final-payment-pdf.generate | covered | — |
| POST | /expense-claims/:claimId/payment-subject | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#adjustExpenseClaimPaymentSubject | expense-claim.payment-subject.adjust | covered | — |
| POST | /expense-claims/:claimId/payment-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#uploadExpenseClaimPaymentVoucherFile | expense-claim.payment-voucher.upload | covered | — |
| POST | /expense-claims/:claimId/payments | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimPayment | expense-claim.payment.record | covered | — |
| POST | /expense-claims/:claimId/repayment-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#uploadExpenseClaimLoanRepaymentVoucherFile | expense-claim.loan.repayment-voucher.upload | covered | — |
| POST | /expense-claims/:claimId/repayments/:repaymentId/confirmation | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#confirmExpenseClaimLoanRepayment | expense-claim.loan.repayment.confirm | covered | — |
| POST | /expense-claims/:claimId/repayments/:repaymentId/reversal | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#reverseExpenseClaimLoanRepayment | expense-claim.loan.repayment.reverse | covered | — |
| POST | /expense-claims/:claimId/repayments | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimLoanRepayment | expense-claim.loan.repayment.record | covered | — |
| POST | /expense-claims/:claimId/submission | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#submitExpenseClaim | expense-claim.submit | covered | — |
| POST | /expense-claims | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#createExpenseClaim | expense-claim.create | covered | — |
| POST | /files/:fileId/download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket<br>apps/web-admin/src/api/core-flow-read.api.ts#downloadPrivateFileByTicket | archive.create-private-file-download-ticket<br>contract-document.download-ticket<br>contract-file.download-private-file-by-ticket<br>contract-file.download-ticket<br>contract-takeover.file-download-ticket<br>payment-detail.file-download-ticket<br>settlement-detail.file-download-ticket<br>settlement-draft.file-download-ticket | covered | — |
| POST | /files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile | contract-archive.upload-file<br>contract-final.upload-file<br>global-invoice.upload-file | covered | — |
| POST | /global-invoices/:invoiceRecordId/void | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#voidGlobalInvoice | global-invoice.void | covered | — |
| POST | /global-invoices | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#createGlobalInvoice | global-invoice.create | covered | — |
| POST | /global-invoices/red | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#createRedGlobalInvoice | global-invoice.red | covered | — |
| POST | /global-invoices/reissue | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#createReissueGlobalInvoice | global-invoice.reissue | covered | — |
| POST | /invoice-allocations/:allocationId/reversal | exit_candidate | none | — | — | not_applicable | — |
| POST | /invoice-clearing-allocations/:clearingAllocationId/reversal | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#reverseGlobalInvoiceAllocation | global-invoice.reverse-clearing-allocation | covered | — |
| POST | /invoice-clearing-allocations | page | web_api_wrapper | apps/web-admin/src/api/global-invoice.api.ts#allocateGlobalInvoice | global-invoice.allocate-clearing | covered | — |
| POST | /me/signature/canvas-handoffs/:token/complete | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#completeCanvasSignatureHandoff | signature.complete-canvas-handoff | covered | — |
| POST | /me/signature/canvas-handoffs | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createCanvasSignatureHandoff | signature.create-canvas-handoff | covered | — |
| POST | /me/signature/canvas | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadCanvasSignature | signature.upload-canvas | covered | — |
| POST | /me/signature | exit_candidate | none | — | — | not_applicable | — |
| POST | /organization/departments | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#createOrganizationDepartment | — | not_applicable | — |
| POST | /organization/role-additions/apply | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleAddition | — | not_applicable | — |
| POST | /organization/role-additions/preview | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleAddition | — | not_applicable | — |
| POST | /organization/role-changes/apply | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleRemoval | — | not_applicable | — |
| POST | /organization/role-changes/batch-preview | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemovalBatch | — | not_applicable | — |
| POST | /organization/role-changes/preview | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemoval | — | not_applicable | — |
| POST | /organization/users | exit_candidate | none | apps/web-admin/src/api/organization.api.ts#createOrganizationUser | — | not_applicable | — |
| POST | /payments/:paymentId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#abandonPaymentRequest | payment-detail.abandon | covered | — |
| POST | /payments/:paymentId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegatePaymentApproval | payment-detail.delegate | covered | — |
| POST | /payments/:paymentId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindPaymentApproval | payment-detail.remind | covered | — |
| POST | /payments/:paymentId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferPaymentApproval | payment-detail.transfer | covered | — |
| POST | /payments/:paymentId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawPaymentApproval | payment-detail.withdraw | covered | — |
| POST | /payments/:paymentId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executePaymentApprovalReviewAction | payment-approval.approve<br>payment-approval.reject | covered | — |
| POST | /payments/:paymentId/execution-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecutionWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#uploadPaymentExecutionPrivateFile | payment-execution.record | covered | — |
| POST | /payments/:paymentId/executions | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecution<br>apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecutionWithUpload | payment-execution.record | covered | — |
| POST | /payments/:paymentId/finance-records | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentFinance | payment-detail.finance-record | covered | — |
| POST | /payments/:paymentId/pdf-archive-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadPaymentPdfArchivePrivateFile | payment-detail.pdf-archive | covered | — |
| POST | /payments/:paymentId/pdf-archive | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentPdfArchive | payment-detail.pdf-archive | covered | — |
| POST | /payments/:paymentId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generatePaymentPdfArchive | payment-detail.pdf-generation | covered | — |
| POST | /payments | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createPaymentRequest | payment-request.create-local-form | covered | — |
| POST | /projects/:projectId/affiliate-assignment | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#assignProjectAffiliate | — | not_applicable | — |
| POST | /projects/:projectId/affiliate-business-facts/:factId/evidence-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateBusinessPrivateFile | project.affiliate-fact.supplement-evidence | covered | — |
| POST | /projects/:projectId/affiliate-business-facts/:factId/evidence | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#supplementProjectAffiliateBusinessEvidence | project.affiliate-fact.supplement-evidence | covered | — |
| POST | /projects/:projectId/affiliate-company-contracts/:contractId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateCompanyContract | affiliate-company-contract.confirm | covered | — |
| POST | /projects/:projectId/affiliate-company-contracts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContractWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateCompanyContractPrivateFile | affiliate-company-contract.record | covered | — |
| POST | /projects/:projectId/affiliate-company-contracts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContract<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContractWithUpload | affiliate-company-contract.record | covered | — |
| POST | /projects/:projectId/affiliate-contract-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateContractFact | project.affiliate-contract.confirm | covered | — |
| POST | /projects/:projectId/affiliate-contract-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateContractPrivateFile | project.affiliate-contract.evidence-upload | covered | — |
| POST | /projects/:projectId/affiliate-contract-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateContractFact | project.affiliate-contract.record | covered | — |
| POST | /projects/:projectId/affiliate-payment-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliatePaymentFact | project.affiliate-payment.confirm | covered | — |
| POST | /projects/:projectId/affiliate-payment-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliatePaymentPrivateFile | project.affiliate-payment.evidence-upload | covered | — |
| POST | /projects/:projectId/affiliate-payment-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliatePaymentFact | project.affiliate-payment.record | covered | — |
| POST | /projects/:projectId/affiliate-settlement-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateSettlementFact | project.affiliate-settlement.confirm | covered | — |
| POST | /projects/:projectId/affiliate-settlement-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateSettlementPrivateFile | project.affiliate-settlement.evidence-upload | covered | — |
| POST | /projects/:projectId/affiliate-settlement-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateSettlementFact | project.affiliate-settlement.record | covered | — |
| POST | /projects/:projectId/construction-enterprise | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#assignProjectConstructionEnterprise | project-operating-profile.set-construction-enterprise | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/abandonment | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#abandonContractTakeover | contract-takeover.abandon | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/change-baseline-confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverChangeBaseline | contract-takeover.confirm-change-baseline | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/company-entity-corrections/:correctionId/review | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCompanyEntityCorrection | contract-takeover.review-company-entity-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/company-entity-corrections | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCompanyEntityCorrection | contract-takeover.submit-company-entity-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/confirmation | exit_candidate | none | — | — | not_applicable | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/contract-side/confirmation-withdrawal | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverContractSideConfirmation | contract-takeover.withdraw-contract-side-confirmation | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/contract-side/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverContractSide | contract-takeover.confirm-contract-side | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/corrections/:correctionId/review | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCorrection | contract-takeover.review-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/corrections | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCorrection | contract-takeover.submit-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/evidence-files | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#attachContractTakeoverEvidenceFile | contract-takeover.attach-contract-evidence | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/finance-side/confirmation-withdrawal | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverFinanceSideConfirmation | contract-takeover.withdraw-finance-side-confirmation | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/finance-side/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverFinanceSide | contract-takeover.confirm-finance-side | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/payment-evidence-files | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#attachHistoricalPaymentVoucher | contract-takeover.attach-payment-voucher | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/review-submission | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverReview | contract-takeover.submit-review | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/supplement-return | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#returnContractTakeoverForSupplement | contract-takeover.return-for-supplement | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/abandonment | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#abandonContractTaxFactRevision | contract-tax-fact.abandon-revision | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/contract-confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#confirmContractTaxFactRevision | contract-tax-fact.contract-confirm | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/finance-review-submission | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#submitContractTaxFactRevisionForFinanceReview | contract-tax-fact.submit-finance-review | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/finance-review | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#reviewContractTaxFactRevisionByFinance | contract-tax-fact.finance-review | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#createContractTaxFactRevision | contract-tax-fact.create-revision | covered | — |
| POST | /projects/:projectId/contract-takeovers/files | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadContractTakeoverPrivateFile | contract-takeover.upload-file<br>contract-tax-fact.upload-evidence | covered | — |
| POST | /projects/:projectId/contract-takeovers/import-batches/:batchId/draft-abandonment-apply | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#applyContractTakeoverBatchAbandonment | contract-takeover.apply-batch-abandonment | covered | — |
| POST | /projects/:projectId/contract-takeovers/import-batches/:batchId/draft-abandonment-preview | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#previewContractTakeoverBatchAbandonment | contract-takeover.preview-batch-abandonment | covered | — |
| POST | /projects/:projectId/contract-takeovers/import-drafts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createContractTakeoverDraftsFromImport | contract-takeover.create-import-drafts | covered | — |
| POST | /projects/:projectId/contract-takeovers/import-precheck | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#precheckContractTakeoverImport | contract-takeover.precheck-import | covered | — |
| POST | /projects/:projectId/contract-takeovers/imports/apply | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#applyContractTakeoverExcelImport | contract-takeover.apply-excel-import | covered | — |
| POST | /projects/:projectId/contract-takeovers/imports/preview | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#previewContractTakeoverExcelImport | contract-takeover.preview-excel-import | covered | — |
| POST | /projects/:projectId/contract-takeovers | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createContractTakeover | contract-takeover.create | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/approval-pdf-download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadProjectExpenseApprovalPdf | project-expense.approval-pdf-download | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeProjectExpenseWithdrawalAction | project-expense.withdraw | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeProjectExpenseApprovalReviewAction | project-expense.review-approve<br>project-expense.review-reject | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/attachment-download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadProjectExpenseAttachment | project-expense.attachment-download | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/execution-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecutionWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectExpenseExecutionPrivateFile | project-expense.execution-local-status | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/executions | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecution<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecutionWithUpload | project-expense.execution-local-status | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/finance-records | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinance<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinanceWithPreflight | project-expense.finance-local-status | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/purchase-execution | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpensePurchaseExecution | project-expense.purchase-execution | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/receipt-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectExpenseReceiptWithPreflight | project-expense.receipt-confirm-local-status | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/voiding | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#voidProjectExpenseRequest | project-expense.void | covered | — |
| POST | /projects/:projectId/expense-requests/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectExpensePrivateFile | project-expense.attachment-upload | covered | — |
| POST | /projects/:projectId/expense-requests | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createProjectExpenseRequest | project-expense.create-local-role | covered | — |
| POST | /projects/:projectId/financing-quotas/:quotaId/approval | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaReviewAction | project-financing-quota.review-approve<br>project-financing-quota.review-reject | covered | — |
| POST | /projects/:projectId/financing-quotas/:quotaId/termination | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaTerminationAction | project-financing-quota.terminate | covered | — |
| POST | /projects/:projectId/financing-quotas/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#requestProjectFinancingQuotaWithUpload | project-financing-quota.request | covered | — |
| POST | /projects/:projectId/financing-quotas | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#requestProjectFinancingQuotaWithUpload | project-financing-quota.request | covered | — |
| POST | /projects/:projectId/operating-takeovers/:batchId/activation | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#activateOperatingTakeover | operating-takeover.activate | covered | — |
| POST | /projects/:projectId/operating-takeovers/:batchId/attachments | external_takeover | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#addOperatingTakeoverAttachmentGroup | operating-takeover.attach-files | covered | — |
| POST | /projects/:projectId/operating-takeovers/:batchId/confirmations | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#confirmOperatingTakeover | operating-takeover.confirm | covered | — |
| POST | /projects/:projectId/operating-takeovers/files | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#uploadOperatingTakeoverSourceFile | operating-takeover.upload-source-file | covered | — |
| POST | /projects/:projectId/operating-takeovers/precheck-xlsx | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#precheckOperatingTakeoverXlsx | operating-takeover.precheck-excel | covered | — |
| POST | /projects/:projectId/operating-takeovers/precheck | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#precheckOperatingTakeover | operating-takeover.precheck | covered | — |
| POST | /projects/:projectId/operating-takeovers | page | web_api_wrapper | apps/web-admin/src/api/operating-takeover.api.ts#createOperatingTakeoverBatch | operating-takeover.create-batch | covered | — |
| POST | /projects/:projectId/owner-contracts/:ownerContractId/confirmation | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectOwnerContract | — | not_applicable | — |
| POST | /projects/:projectId/owner-contracts | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectOwnerContract | — | not_applicable | — |
| POST | /projects/:projectId/participating-companies | page | web_api_wrapper | apps/web-admin/src/api/project-operating-profile.api.ts#addProjectParticipatingCompany | project-operating-profile.add-participating-company | covered | — |
| POST | /projects/:projectId/proxy-payments | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectProxyPayment | — | not_applicable | — |
| POST | /projects/:projectId/receipts | exit_candidate | none | — | — | not_applicable | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#abandonSettlementDraftRecord<br>apps/web-admin/src/api/settlement-drafts.api.ts#executeSettlementDraftLifecycleAction | settlement-draft.abandon-application<br>settlement-draft.delete-pristine | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/approval-submission | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#submitSettlementDraftRecord | settlement-draft.submit | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/copies | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedSettlementDraft | settlement-list.copy-abandoned-draft | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/counterparty-signed-documents | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#linkSettlementCounterpartySignedDocument | settlement-draft.link-signed-document | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/frozen-document | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#generateSettlementFrozenDocument | settlement-draft.generate-frozen-document | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/line-attachments/:attachmentId/invalidation | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#invalidateSettlementDraftLineAttachment | settlement-line-attachment.invalidate | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/lines/:lineKey/attachments | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#attachSettlementDraftLineFile | settlement-line-attachment.attach | covered | — |
| POST | /projects/:projectId/settlement-drafts/files | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#uploadSettlementDraftPrivateFile | settlement-draft.upload-signed-document<br>settlement-import.preview-local-gate<br>settlement-line-attachment.attach | covered | — |
| POST | /projects/:projectId/settlement-drafts | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#createSettlementDraftRecord | settlement-draft.save-local-gate | covered | — |
| POST | /projects/:projectId/settlement-exception-quotas/:quotaId/approval | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementExceptionQuota | — | not_applicable | — |
| POST | /projects/:projectId/settlement-exception-quotas | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#requestSettlementExceptionQuota | — | not_applicable | — |
| POST | /projects/:projectId/upstream-fund-facts/:fundFactId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamFundFact | project.upstream-fund.confirm | covered | — |
| POST | /projects/:projectId/upstream-fund-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectUpstreamFundPrivateFile | project.upstream-fund.evidence-upload | covered | — |
| POST | /projects/:projectId/upstream-fund-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamFundFact | project.upstream-fund.record | covered | — |
| POST | /projects/:projectId/upstream-settlements/:upstreamSettlementId/confirmation | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamSettlement | — | not_applicable | — |
| POST | /projects/:projectId/upstream-settlements | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamSettlement | — | not_applicable | — |
| POST | /projects | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createProject | project.create | covered | — |
| POST | /settlement-template-versions/:versionId/clone | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#cloneSettlementTemplateVersion | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/discard | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#discardSettlementTemplateVersion | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/inspection | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#inspectSettlementTemplateVersion | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/preview-generation | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#generateSettlementTemplatePreview | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/preview-pdf/download-ticket | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#downloadSettlementTemplatePreview | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/preview-xlsx/download-ticket | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#downloadSettlementTemplatePreview | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/publication | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#publishSettlementTemplateVersion | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/stop | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#stopSettlementTemplateVersion | — | not_applicable | — |
| POST | /settlement-template-versions/:versionId/submission | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#submitSettlementTemplateVersion | — | not_applicable | — |
| POST | /settlement-templates | exit_candidate | none | apps/web-admin/src/api/settlement-template.api.ts#createSettlementTemplate | — | not_applicable | — |
| POST | /settlement-workbench/contract-versions/:contractVersionId/imports/preview | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#previewSettlementImport | settlement-import.preview-local-gate | covered | — |
| POST | /settlement-workbench/contract-versions/:contractVersionId/preview | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#previewSettlementLines | settlement-preview.background-local-gate | covered | — |
| POST | /settlement-workbench/projects/:projectId/imports/:importId/apply | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#applySettlementImport | settlement-import.apply | covered | — |
| POST | /settlements/:settlementId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegateSettlementApproval | settlement-detail.delegate | covered | — |
| POST | /settlements/:settlementId/approval-pdf/latest | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementLatestApprovalPdf | settlement-detail.approval-pdf | covered | — |
| POST | /settlements/:settlementId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindSettlementApproval | settlement-detail.remind | covered | — |
| POST | /settlements/:settlementId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferSettlementApproval | settlement-detail.transfer | covered | — |
| POST | /settlements/:settlementId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeSettlementApprovalWithdrawalAction | settlement-approval.withdraw | covered | — |
| POST | /settlements/:settlementId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementApproval | settlement-detail.review | covered | — |
| POST | /settlements/:settlementId/archive-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmSettlementArchive | settlement-detail.archive-confirm-or-regenerate | covered | — |
| POST | /settlements/:settlementId/archive-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadSettlementArchivePrivateFile | settlement-detail.archive-upload | covered | — |
| POST | /settlements/:settlementId/archive-files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadSettlementArchiveFile | settlement-detail.archive-upload | covered | — |
| POST | /settlements/:settlementId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generateSettlementPdfArchive | settlement-detail.pdf-generation | covered | — |
| POST | /settlements/:settlementId/recovery-entries/:entryId/reversal | page | web_api_wrapper | apps/web-admin/src/api/settlement-recovery.api.ts#reverseSettlementRecovery | settlement-recovery.reverse | covered | — |
| POST | /settlements/:settlementId/recovery-entries | page | web_api_wrapper | apps/web-admin/src/api/settlement-recovery.api.ts#recordSettlementRecovery | settlement-recovery.record | covered | — |
| POST | /settlements/:settlementId/recovery-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadSettlementRecoveryPrivateFile | settlement-recovery.record<br>settlement-recovery.reverse | covered | — |
| POST | /settlements/:settlementId/signed-document-generation-retry | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#retrySettlementSignedDocumentGeneration | settlement-detail.generation-retry | covered | — |
| POST | /settlements/:settlementId/signed-document-regeneration | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#regenerateSettlementSignedDocument | settlement-detail.signed-document-regenerate | covered | — |
| POST | /settlements | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#createSettlementDraft | — | not_applicable | — |
| POST | /spot-procurement-payments/:paymentId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementPaymentDraft | spot-procurement-payment.draft.abandon | covered | — |
| POST | /spot-procurement-payments/:paymentId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurementPayment | spot-procurement-payment.withdraw | covered | — |
| POST | /spot-procurement-payments/:paymentId/approval | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementPaymentReviewAction | spot-procurement-payment.legacy-review-approve<br>spot-procurement-payment.legacy-review-return-to-applicant<br>spot-procurement-payment.review-approve<br>spot-procurement-payment.review-return-to-applicant | covered | — |
| POST | /spot-procurement-payments/:paymentId/balance-execution | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurement-payments/:paymentId/draft-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementPaymentDraftFile | spot-procurement-payment.draft-file.upload | covered | — |
| POST | /spot-procurement-payments/:paymentId/execution-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementExecutionVoucherFile | spot-procurement-payment.execution-voucher.upload | covered | — |
| POST | /spot-procurement-payments/:paymentId/executions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementPaymentExecution | spot-procurement-payment.execution.record | covered | — |
| POST | /spot-procurement-payments/:paymentId/invoices/:invoiceId/invalidation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#invalidateSpotProcurementPaymentInvoice | spot-procurement.invoice-invalidate | covered | — |
| POST | /spot-procurement-payments/:paymentId/invoices | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementInvoiceAppend | spot-procurement.invoice-append | covered | — |
| POST | /spot-procurement-payments/:paymentId/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementPayment | spot-procurement-payment.submit | covered | — |
| POST | /spot-procurement-payments/:paymentId/voiding | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurementPayment | spot-procurement-payment.void | covered | — |
| POST | /spot-procurements/:procurementId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementDraft | spot-procurement.draft.abandon-application<br>spot-procurement.draft.delete-pristine | covered | — |
| POST | /spot-procurements/:procurementId/abnormal-termination/confirmation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#confirmSpotProcurementAbnormalTermination | spot-procurement.abnormal-termination-confirm | covered | — |
| POST | /spot-procurements/:procurementId/abnormal-termination | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#requestSpotProcurementAbnormalTermination | spot-procurement.abnormal-termination-request | covered | — |
| POST | /spot-procurements/:procurementId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementWithdrawalAction | spot-procurement.withdraw | covered | — |
| POST | /spot-procurements/:procurementId/approval | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementReviewAction | spot-procurement.review-approve<br>spot-procurement.review-reject<br>spot-procurement.review-return-to-applicant | covered | — |
| POST | /spot-procurements/:procurementId/discrepancy | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDiscrepancy | spot-procurement-receipt.discrepancy.confirm<br>spot-procurement-receipt.discrepancy.initiate | covered | — |
| POST | /spot-procurements/:procurementId/draft-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementDraftFile | spot-procurement.draft-file.upload | covered | — |
| POST | /spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/invoice-exceptions | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/invoice-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementInvoiceFile | spot-procurement-receipt.invoice-file.upload | covered | — |
| POST | /spot-procurements/:procurementId/invoices | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/no-invoice-confirmations | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/payment-drafts | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recreateSpotProcurementPaymentDraft | spot-procurement.payment-draft.recreate | covered | — |
| POST | /spot-procurements/:procurementId/receipt-photo-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementReceiptPhotoFile | spot-procurement-receipt.photo-file.upload | covered | — |
| POST | /spot-procurements/:procurementId/receipt/delegations | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementReceiptDelegation | spot-procurement-receipt.delegate | covered | — |
| POST | /spot-procurements/:procurementId/receipt/draft-reset | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#resetSpotProcurementReceiptDraft | spot-procurement-receipt.draft.reset | covered | — |
| POST | /spot-procurements/:procurementId/receipt/pdf-refresh | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#refreshSpotProcurementReceiptPdf | spot-procurement.receipt-pdf-refresh | covered | — |
| POST | /spot-procurements/:procurementId/receipt/photos | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#attachSpotProcurementReceiptPhoto | spot-procurement-receipt.photo.attach | covered | — |
| POST | /spot-procurements/:procurementId/receipt/review-revocation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#revokeSpotProcurementReceiptReview | spot-procurement-receipt.review.revoke | covered | — |
| POST | /spot-procurements/:procurementId/receipt/review | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementReceipt | spot-procurement-receipt.review | covered | — |
| POST | /spot-procurements/:procurementId/receipt/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementReceipt | spot-procurement-receipt.submit | covered | — |
| POST | /spot-procurements/:procurementId/refund-voucher-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementRefundVoucherFile | spot-procurement-receipt.refund-voucher.upload | covered | — |
| POST | /spot-procurements/:procurementId/refunds | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementRefund | spot-procurement-receipt.refund.record | covered | — |
| POST | /spot-procurements/:procurementId/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurement | spot-procurement.submit | covered | — |
| POST | /spot-procurements/:procurementId/supplier-balance-credit | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/versions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementVersion | spot-procurement.version.create | covered | — |
| POST | /spot-procurements/:procurementId/voiding | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurement | spot-procurement.void | covered | — |
| POST | /spot-procurements/projects/:projectId/draft-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#uploadSpotProcurementCreateFile | spot-procurement.create-file.upload | covered | — |
| POST | /spot-procurements | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDraft | spot-procurement.create | covered | — |
| POST | /standard-clause-versions/:versionId/discard | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#discardStandardClauseVersion | — | not_applicable | — |
| POST | /standard-clause-versions/:versionId/publication | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#publishStandardClauseVersion | — | not_applicable | — |
| POST | /standard-clause-versions/:versionId/submission | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#submitStandardClauseVersion | — | not_applicable | — |
| POST | /standard-clauses | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createStandardClause | — | not_applicable | — |
| POST | /vat-rate-options | exit_candidate | none | — | — | not_applicable | — |
| PUT | /contract-bills/:billId/rows | exit_candidate | none | — | — | not_applicable | — |
| PUT | /contract-drafts/:contractVersionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraftAggregate | contract-draft.aggregate-autosave<br>contract-draft.manual-save | covered | — |
| PUT | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#saveContractBillTransitions | contract-bill-transition.save | covered | — |
| PUT | /projects/:projectId/contract-takeovers/:takeoverId/contract-side | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverContractSide | contract-takeover.save-contract-side | covered | — |
| PUT | /projects/:projectId/contract-takeovers/:takeoverId/finance-side | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverFinanceSide | contract-takeover.save-finance-side | covered | — |

## 阻塞附录

### 无后端路由的 Web 请求

- 无

### 无后端路由的 Auth transport

- 无

### 孤儿 wrapper

- 无

### 未覆盖写入消费者

- 无

### 未解决动作绑定

- 无

# 整站能力矩阵

状态：`blocked`。本表仅交叉核验四份实施清单，不构成删除或生产写入授权。

## 输入证据

| 输入 | 状态 | SHA-256 |
| --- | --- | --- |
| nestRoutes | ready | `5a94d8072bdb5bbb966b0b32eb0f10ae9402dfbe5705aa05969ec89b53285b7a` |
| webApiWrappers | blocked | `0bae163baf24b3adb29dbccf87676e56904c226493444ab3174ca628343e8d04` |
| webPageActions | blocked | `b612e8a8ff7165d5a533810b034abedad268de8e4261a7b4b1e898343b6931f7` |
| routeUsage | ready | `3c7cc8e312a93363708329abe4539650cdd4461de40410cfe75429b19cea49e8` |

## 汇总

| 指标 | 数量 |
| --- | ---: |
| routeCount | 428 |
| pageRouteCount | 321 |
| externalTakeoverRouteCount | 61 |
| exitCandidateRouteCount | 43 |
| internalTaskRouteCount | 3 |
| unclassifiedRouteCount | 0 |
| mainRequestBindingCount | 438 |
| webRequestWithoutNestCount | 1 |
| authRequestWithoutNestCount | 0 |
| orphanWrapperCount | 37 |
| duplicateMutationRouteCount | 3 |
| registeredActionCount | 191 |
| actionBindingCount | 221 |
| acceptedActionBindingCount | 201 |
| unresolvedActionBindingCount | 1 |
| productionMutationConsumerPairCount | 281 |
| coveredProductionMutationConsumerPairCount | 182 |
| uncoveredProductionMutationConsumerPairCount | 99 |
| blockerCount | 143 |

## 路由矩阵

| 方法 | 路径 | 用途 | 消费面 | Web wrapper | 动作 | 写入覆盖 | 阻塞 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DELETE | /approval-delegations/:delegationId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#revokeApprovalDelegation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| DELETE | /contract-bills/:billId/rows/:rowKey | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#deleteBillRow | — | not_applicable | ORPHAN_WRAPPER |
| DELETE | /contract-drafts/:contractVersionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#deletePristineContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| DELETE | /contract-drafts/:contractVersionId/edit-lease | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#releaseContractDraftEditLease | contract-draft.lease-release | covered | — |
| DELETE | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardContractBillTransitions | contract-bill-transition.discard | covered | — |
| DELETE | /contract-workbench/:contractVersionId/parties/:partySnapshotId | exit_candidate | none | — | — | not_applicable | — |
| DELETE | /spot-procurements/:procurementId/receipt/photos/:photoId | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#deleteSpotProcurementReceiptPhoto | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| GET | /approval-delegations | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listApprovalDelegations | — | not_applicable | — |
| GET | /approval-delegations/user-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchApprovalDelegationUserOptions | — | not_applicable | — |
| GET | /archives | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchArchives | — | not_applicable | — |
| GET | /audit-logs | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchAuditLogs | — | not_applicable | — |
| GET | /audit-logs/file-downloads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchFileDownloadAudits | — | not_applicable | — |
| GET | /business-parties/:partyId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getBusinessParty | — | not_applicable | — |
| GET | /business-parties | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listBusinessParties | — | not_applicable | — |
| GET | /company-entities/:id/history | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#fetchCompanyEntityHistory | — | not_applicable | — |
| GET | /company-entities | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#fetchActiveCompanyEntities | — | not_applicable | — |
| GET | /company-entities/management | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#fetchCompanyEntityManagement | — | not_applicable | — |
| GET | /contract-bills/:billId/excel-template | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#downloadBillExcelTemplate | — | not_applicable | — |
| GET | /contract-business-scenarios/available | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#listAvailableContractBusinessScenarios | — | not_applicable | — |
| GET | /contract-business-scenarios | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#listContractScenarioGovernance | — | not_applicable | — |
| GET | /contract-business-scenarios/recommendations | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#recommendContractScenarioTemplates | — | not_applicable | — |
| GET | /contract-drafts/:contractVersionId/bills/:billKey/template | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#downloadContractDraftBillExcelTemplate | — | not_applicable | — |
| GET | /contract-drafts/:contractVersionId/workbench | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#executeContractBillRemainderCancellation<br>apps/web-admin/src/api/contract-workbench.api.ts#executeContractDraftLifecycleAction<br>apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftOperationCapabilities<br>apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftWorkbench | contract-bill.remainder-cancellation<br>contract-draft.abandon-application<br>contract-draft.delete-pristine | not_applicable | — |
| GET | /contract-layout-template-versions/:versionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getLatestLayoutTemplatePreview | — | not_applicable | — |
| GET | /contract-layout-templates/:templateId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getLayoutTemplate | — | not_applicable | — |
| GET | /contract-layout-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedLayoutTemplates | — | not_applicable | — |
| GET | /contract-number-rules | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listContractNumberRules<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchActiveContractNumberRules | — | not_applicable | ORPHAN_WRAPPER |
| GET | /contract-templates/:templateId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#getContractTemplate | — | not_applicable | — |
| GET | /contract-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedContractTemplates | — | not_applicable | — |
| GET | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractBillTransitions | — | not_applicable | — |
| GET | /contract-versions/:toContractVersionId/bill-transitions/options | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractBillTransitionOptions | — | not_applicable | — |
| GET | /contract-workbench/:contractId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractWorkbench | — | not_applicable | ORPHAN_WRAPPER |
| GET | /contract-workbench/:contractVersionId/documents | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listContractDocuments | — | not_applicable | — |
| GET | /contract-workbench/:contractVersionId/negotiation-rounds | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#listContractNegotiationRounds | — | not_applicable | — |
| GET | /contract-workbench/:contractVersionId/offline-revisions | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#listContractOfflineRevisionHistory | — | not_applicable | — |
| GET | /contract-workbench/:contractId/transfer-capability | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftTransferCapabilities | — | not_applicable | — |
| GET | /contract-workbench | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#listContractDrafts | — | not_applicable | ORPHAN_WRAPPER |
| GET | /contracts/:contractVersionId/authorizations/readiness | exit_candidate | none | — | — | not_applicable | — |
| GET | /contracts/:contractVersionId/change-eligibility | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractChangeEligibility | — | not_applicable | — |
| GET | /contracts/:contractId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeContractSigningMaterialChange<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchContractDetail<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareContractApprovalReviewAction<br>apps/web-admin/src/api/core-flow-read.api.ts#prepareContractApprovalWithdrawalAction | contract.signing-material-change | not_applicable | — |
| GET | /contracts | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLedger | — | not_applicable | — |
| GET | /contracts/create-capability | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractCreateCapabilities | — | not_applicable | — |
| GET | /contracts/ledger-export | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractLedgerExport | — | not_applicable | — |
| GET | /contracts/lifecycle-ledger | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLifecycleLedger | — | not_applicable | ORPHAN_WRAPPER |
| GET | /contracts/payment-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentContractOptions | — | not_applicable | — |
| GET | /contracts/settlement-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementContractOptions | — | not_applicable | — |
| GET | /contracts/workbench | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractWorkbenchLedger | — | not_applicable | — |
| GET | /draft-retention/preview | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchDraftRetentionPreview | — | not_applicable | — |
| GET | /expense-claims/:claimId | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimDetail | — | not_applicable | — |
| GET | /expense-claims/create-options | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimCreateOptions | — | not_applicable | — |
| GET | /expense-claims | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaims | — | not_applicable | — |
| GET | /files/:fileId/download-ticket-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getPrivateFileDownloadTicketCapability | — | not_applicable | — |
| GET | /files/:fileId/download | page | signed_ticket_delivery | — | — | not_applicable | — |
| GET | /funds-workbench | page | web_api_wrapper | apps/web-admin/src/api/funds-workbench.api.ts#fetchFundsWorkbench | — | not_applicable | — |
| GET | /health | internal_task | machine_probe | — | — | not_applicable | — |
| GET | /health/readiness | internal_task | machine_probe | — | — | not_applicable | — |
| GET | /me/signature/canvas-capabilities | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getCanvasSignatureCapabilities | — | not_applicable | — |
| GET | /me/signature/canvas-handoffs/:token | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getCanvasSignatureHandoff | — | not_applicable | — |
| GET | /me/signature/ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getSignatureTicket | — | not_applicable | — |
| GET | /me/work-items | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkItems | — | not_applicable | — |
| GET | /me/workbench-summary | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkbenchSummary | — | not_applicable | ORPHAN_WRAPPER |
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
| GET | /projects/:projectId/settlement-drafts/:draftId/final-preparation | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementFinalPreparation | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId/line-attachments | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#listSettlementDraftLineAttachments | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#executeSettlementDraftLifecycleAction<br>apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementDraftRecord | settlement-draft.abandon-application<br>settlement-draft.delete-pristine | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/capability | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementProjectCapability | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#listSettlementDraftRecords | — | not_applicable | — |
| GET | /projects/:projectId/update-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpdateCapability | — | not_applicable | — |
| GET | /projects/:projectId/upstream-fund-facts/:fundFactId/confirmation-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpstreamFundConfirmationCapability | — | not_applicable | — |
| GET | /projects/:projectId/upstream-fund-facts/record-capability | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectUpstreamFundRecordCapability | — | not_applicable | — |
| GET | /projects/affiliate-mapping-report | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateMappingReport | — | not_applicable | ORPHAN_WRAPPER |
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
| GET | /settlements/lifecycle-ledger | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementLifecycleLedger | — | not_applicable | ORPHAN_WRAPPER |
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
| GET | /standard-clauses/history | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listStandardClauseHistory | — | not_applicable | — |
| GET | /standard-clauses | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedStandardClauses | — | not_applicable | — |
| GET | /vat-rate-options | exit_candidate | none | — | — | not_applicable | — |
| PATCH | /auth/profile | page | auth_store | — | — | not_applicable | — |
| PATCH | /company-entities/:id | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntity | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-bills/:billId/rows/:rowKey | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#updateBillRow | — | not_applicable | ORPHAN_WRAPPER |
| PATCH | /contract-business-scenarios/:scenarioId | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#updateContractBusinessScenario | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-layout-template-versions/:versionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#updateLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-number-rules/:ruleId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#updateContractNumberRule | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-scenario-template-mappings/:mappingId | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#updateContractScenarioMapping | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-template-versions/:versionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#updateContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-workbench/:contractVersionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| PATCH | /contract-workbench/:contractVersionId/parties/:partySnapshotId | exit_candidate | none | — | — | not_applicable | — |
| PATCH | /organization/departments/:departmentId | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#updateOrganizationDepartment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /organization/users/:userId | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#updateOrganizationUser | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /projects/:projectId/contract-takeovers/:takeoverId | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#updateContractTakeover | contract-takeover.update | covered | — |
| PATCH | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#updateContractTaxFactRevision | contract-tax-fact.update-revision | covered | — |
| PATCH | /projects/:projectId/contract-takeovers/import-batches/:batchId/review-result | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverImportBatch | contract-takeover.review-import-batch | covered | — |
| PATCH | /projects/:projectId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#updateProject | project.update | covered | — |
| PATCH | /projects/:projectId/settlement-drafts/:draftId | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#updateSettlementDraftRecord | settlement-draft.update-local-gate | covered | — |
| PATCH | /settlement-template-versions/:versionId | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#updateSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurement-payments/:paymentId/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurement-payments/:paymentId/payer | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentPayer | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurements/:procurementId/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurements/:procurementId/receipt/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementReceiptDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /vat-rate-options/:optionId | exit_candidate | none | — | — | not_applicable | — |
| POST | /approval-delegations | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createApprovalDelegation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /approval-forms/:businessType/:businessId/download | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm | contract-approval.download-form<br>payment-detail.approval-pdf | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /auth/change-password | page | auth_store | — | — | not_applicable | — |
| POST | /auth/login | page | auth_store | — | — | not_applicable | — |
| POST | /auth/logout | page | auth_store | — | — | not_applicable | — |
| POST | /auth/refresh | page | auth_store | — | — | not_applicable | — |
| POST | /auth/wx-login | exit_candidate | none | — | — | not_applicable | — |
| POST | /business-parties/:partyId/versions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createBusinessPartyVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /business-parties | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createBusinessParty | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /company-entities/:id/status | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntityStatus | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /company-entities | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#createCompanyEntity | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-bill-imports/:importId/apply | exit_candidate | none | — | — | not_applicable | — |
| POST | /contract-bills/:billId/excel-imports | exit_candidate | none | — | — | not_applicable | — |
| POST | /contract-bills/:billId/rows/:rowKey/remainder-cancellation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#executeContractBillRemainderCancellation | contract-bill.remainder-cancellation | covered | — |
| POST | /contract-bills/:billId/rows | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#addBillRow | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-bills/:billId/rows/reorder | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#reorderBillRows | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-business-scenarios/:scenarioId/template-mappings | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#createContractScenarioMapping | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-business-scenarios | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#createContractBusinessScenario | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-document-differences/:differenceId/disposition | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#disposeContractDocumentDifference | contract-negotiation.dispose-difference | covered | — |
| POST | /contract-documents/:documentId/retry | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#retryContractDocument | contract-document.retry | covered | — |
| POST | /contract-drafts/:contractVersionId/bills/:billKey/import-preview | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#previewContractDraftBillExcelImport | contract-bill-import.preview | covered | — |
| POST | /contract-drafts/:contractVersionId/edit-lease | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#acquireContractDraftEditLease | contract-draft.lease-acquire | covered | — |
| POST | /contract-drafts/:contractVersionId/edit-lease/heartbeat | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#heartbeatContractDraftEditLease | contract-draft.lease-heartbeat | covered | — |
| POST | /contract-drafts/:contractVersionId/edit-lease/takeover | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#takeOverContractDraftEditLease | contract-draft.lease-takeover | covered | — |
| POST | /contract-drafts/:contractVersionId/files | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#uploadContractWorkbenchPrivateFile | contract-authorization.upload-file<br>contract-bill-import.upload-file<br>contract-document.upload-file<br>contract-formal-document.upload-file<br>contract-negotiation.upload-file<br>contract-party.upload-file | covered | — |
| POST | /contract-drafts/:contractVersionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueContractDraftPreview | contract-draft.preview-queue | covered | — |
| POST | /contract-drafts/:contractVersionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitContractDraft | contract-workbench.submit | covered | — |
| POST | /contract-layout-template-versions/:versionId/clone | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#cloneLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/inspection | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#inspectLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueLayoutTemplatePreview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#publishLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/revoke | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#revokeLayoutTemplateVersion | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-layout-template-versions/:versionId/stop | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#stopLayoutTemplateVersion | layout-template.risk-stop | covered | — |
| POST | /contract-layout-template-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createLayoutTemplate | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-negotiation-rounds/:roundId/close | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#closeContractNegotiationRound | contract-negotiation.close-round | covered | — |
| POST | /contract-number-rules/:ruleId/stop | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#stopContractNumberRule | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-number-rules | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createContractNumberRule | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-offline-revisions/:revisionId/preview-download-ticket | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#openContractRevisionPreview | contract-negotiation.open-revision-preview | covered | — |
| POST | /contract-offline-revisions/:revisionId/retry | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#retryContractOfflineRevision | contract-negotiation.retry-revision | covered | — |
| POST | /contract-template-versions/:versionId/clone | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#cloneContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#publishContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/revoke | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#revokeContractTemplateVersion | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-template-versions/:versionId/stop | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#stopContractTemplateVersion | contract-template.risk-stop | covered | — |
| POST | /contract-template-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createContractTemplate | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-versions/:toContractVersionId/bill-transitions/confirm | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmContractBillTransitions | contract-bill-transition.confirm | covered | — |
| POST | /contract-workbench/:contractVersionId/checkpoints/:checkpointId/restore | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#restoreDraftCheckpoint | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-workbench/:contractVersionId/checkpoints | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createDraftCheckpoint | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-workbench/:contractVersionId/documents | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueContractDocument | contract-document.queue | covered | — |
| POST | /contract-workbench/:contractVersionId/negotiation-rounds | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#openContractNegotiationRound | contract-negotiation.open-round | covered | — |
| POST | /contract-workbench/:contractVersionId/offline-revisions | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#uploadContractNegotiationRevision | contract-negotiation.upload-revision | covered | — |
| POST | /contract-workbench/:contractVersionId/parties | exit_candidate | none | — | — | not_applicable | — |
| POST | /contract-workbench/:contractId/restore | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#restoreContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-workbench/:contractVersionId/settlement-mode/confirm | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmContractSettlementMode | contract-workbench.confirm-settlement-mode | covered | — |
| POST | /contract-workbench/:contractId/transfer | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#transferContractDraft | contract-draft.transfer | covered | — |
| POST | /contract-workbench/:contractVersionId/type-change-preview | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#previewContractTypeChange | contract-workbench.preview-type-change | covered | — |
| POST | /contract-workbench/:contractVersionId/type-change | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#applyContractTypeChange | contract-workbench.apply-type-change | covered | — |
| POST | /contract-workbench/:contractId/void | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#voidContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contracts/:contractVersionId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#abandonContractDraft<br>apps/web-admin/src/api/contract-workbench.api.ts#executeContractDraftLifecycleAction | contract-draft.abandon-application<br>contract-draft.delete-pristine | covered | ORPHAN_WRAPPER |
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
| POST | /contracts/:contractVersionId/copies | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedContractDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/formal-files/approval | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#uploadContractFormalApprovalFile | contract-formal-document.associate-approval | covered | — |
| POST | /contracts/:contractVersionId/formal-files/final/confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmMutuallySignedContract | contract-final.confirm | covered | — |
| POST | /contracts/:contractVersionId/formal-files/final | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadMutuallySignedContract | contract-final.associate | covered | — |
| POST | /contracts/:contractVersionId/formal-files/final/return | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#returnMutuallySignedContractForCorrection | contract-final.return | covered | — |
| POST | /contracts/:contractVersionId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generateContractPdfArchive | contract-archive.generate-pdf | covered | — |
| POST | /contracts/:contractVersionId/readiness | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#checkContractSubmissionReadiness | contract-workbench.check-submission-readiness | covered | — |
| POST | /contracts/:contractVersionId/seal-approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#approveContractSeal | contract-seal.approve-legacy | covered | — |
| POST | /contracts/:contractVersionId/seal/approve | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#approveGovernedContractSeal | contract-seal.approve-governed | covered | — |
| POST | /contracts/:contractVersionId/seal/complete | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#completeContractSeal | contract-seal.complete | covered | — |
| POST | /contracts/:contractVersionId/signing/material-change | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executeContractSigningMaterialChange | contract.signing-material-change | covered | — |
| POST | /contracts | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createWorkbenchDraft<br>apps/web-admin/src/api/core-flow-read.api.ts#createContractDraft | contract-draft.create | covered | DUPLICATE_MUTATION_ROUTE<br>ORPHAN_WRAPPER |
| POST | /draft-retention/controlled-entry | internal_task | operator_endpoint | — | — | not_applicable | — |
| POST | /expense-claims/:claimId/approval | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#reviewExpenseClaim | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/attachments/:attachmentId/removal | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#removeExpenseClaimAttachment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/attachments/append | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#appendExpenseClaimAttachment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/attachments | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#attachExpenseClaimAttachment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/disbursements | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimLoanDisbursement | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/final-disbursement-pdf | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#generateExpenseClaimFinalDisbursementPdf | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/final-payment-pdf | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#generateExpenseClaimFinalPaymentPdf | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/payment-subject | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#adjustExpenseClaimPaymentSubject | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/payments | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/repayments/:repaymentId/confirmation | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#confirmExpenseClaimLoanRepayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/repayments/:repaymentId/reversal | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#reverseExpenseClaimLoanRepayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/repayments | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimLoanRepayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims/:claimId/submission | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#submitExpenseClaim | expense-claim.submit-local-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /expense-claims | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#createExpenseClaim | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /files/:fileId/download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket | archive.create-private-file-download-ticket<br>contract-document.download-ticket<br>contract-file.download-ticket<br>contract-takeover.file-download-ticket<br>payment-detail.file-download-ticket<br>settlement-detail.file-download-ticket<br>settlement-draft.file-download-ticket | covered | — |
| POST | /files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecutionWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContractWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecutionWithUpload<br>apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile<br>apps/web-admin/src/api/project-financing-quota.api.ts#requestProjectFinancingQuotaWithUpload | affiliate-company-contract.record<br>contract-archive.upload-file<br>contract-final.upload-file<br>payment-execution.record<br>project-expense.execution-local-status<br>project-financing-quota.request | uncovered | DUPLICATE_MUTATION_ROUTE<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /invoice-allocations/:allocationId/reversal | exit_candidate | none | — | — | not_applicable | — |
| POST | /me/signature/canvas-handoffs/:token/complete | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#completeCanvasSignatureHandoff | signature.complete-canvas-handoff | covered | — |
| POST | /me/signature/canvas-handoffs | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createCanvasSignatureHandoff | signature.create-canvas-handoff | covered | — |
| POST | /me/signature/canvas | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadCanvasSignature | signature.upload-canvas | covered | — |
| POST | /me/signature | exit_candidate | none | — | — | not_applicable | — |
| POST | /organization/departments | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#createOrganizationDepartment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-additions/apply | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleAddition | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-additions/preview | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleAddition | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-changes/apply | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleRemoval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-changes/batch-preview | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemovalBatch | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-changes/preview | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemoval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/users | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#createOrganizationUser | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#abandonPaymentRequest | payment-detail.abandon | covered | — |
| POST | /payments/:paymentId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegatePaymentApproval | payment-detail.delegate | covered | — |
| POST | /payments/:paymentId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindPaymentApproval | payment-detail.remind | covered | — |
| POST | /payments/:paymentId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferPaymentApproval | payment-detail.transfer | covered | — |
| POST | /payments/:paymentId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawPaymentApproval | payment-detail.withdraw | covered | — |
| POST | /payments/:paymentId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#executePaymentApprovalReviewAction | payment-approval.approve<br>payment-approval.reject | covered | — |
| POST | /payments/:paymentId/executions | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecution<br>apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecutionWithUpload | payment-execution.record | covered | ORPHAN_WRAPPER |
| POST | /payments/:paymentId/finance-records | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentFinance | payment-detail.finance-record | covered | — |
| POST | /payments/:paymentId/pdf-archive-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadPaymentPdfArchivePrivateFile | payment-detail.pdf-archive | covered | — |
| POST | /payments/:paymentId/pdf-archive | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentPdfArchive | payment-detail.pdf-archive | covered | — |
| POST | /payments/:paymentId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generatePaymentPdfArchive | payment-detail.pdf-generation | covered | — |
| POST | /payments | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createPaymentRequest | payment-request.create-local-form | covered | — |
| POST | /projects/:projectId/affiliate-assignment | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#assignProjectAffiliate | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/affiliate-business-facts/:factId/evidence-file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateBusinessPrivateFile | project.affiliate-fact.supplement-evidence | covered | — |
| POST | /projects/:projectId/affiliate-business-facts/:factId/evidence | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#supplementProjectAffiliateBusinessEvidence | project.affiliate-fact.supplement-evidence | covered | — |
| POST | /projects/:projectId/affiliate-company-contracts/:contractId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateCompanyContract | affiliate-company-contract.confirm | covered | — |
| POST | /projects/:projectId/affiliate-company-contracts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContract<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContractWithUpload | affiliate-company-contract.record | covered | ORPHAN_WRAPPER |
| POST | /projects/:projectId/affiliate-contract-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateContractFact | project.affiliate-contract.confirm | covered | — |
| POST | /projects/:projectId/affiliate-contract-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateContractPrivateFile | project.affiliate-contract.evidence-upload | covered | — |
| POST | /projects/:projectId/affiliate-contract-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateContractFact | project.affiliate-contract.record | covered | — |
| POST | /projects/:projectId/affiliate-payment-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliatePaymentFact | project.affiliate-payment.confirm | covered | — |
| POST | /projects/:projectId/affiliate-payment-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliatePaymentPrivateFile | project.affiliate-payment.evidence-upload | covered | — |
| POST | /projects/:projectId/affiliate-payment-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliatePaymentFact | project.affiliate-payment.record | covered | — |
| POST | /projects/:projectId/affiliate-settlement-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateSettlementFact | project.affiliate-settlement.confirm | covered | — |
| POST | /projects/:projectId/affiliate-settlement-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectAffiliateSettlementPrivateFile | project.affiliate-settlement.evidence-upload | covered | — |
| POST | /projects/:projectId/affiliate-settlement-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateSettlementFact | project.affiliate-settlement.record | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/abandonment | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#abandonContractTakeover | contract-takeover.abandon | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/change-baseline-confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverChangeBaseline | contract-takeover.confirm-change-baseline | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/company-entity-corrections/:correctionId/review | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCompanyEntityCorrection | contract-takeover.review-company-entity-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/company-entity-corrections | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCompanyEntityCorrection | contract-takeover.submit-company-entity-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeover | contract-takeover.confirm | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/contract-side/confirmation-withdrawal | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverContractSideConfirmation | contract-takeover.withdraw-contract-side-confirmation | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/contract-side/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverContractSide | contract-takeover.confirm-contract-side | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/corrections/:correctionId/review | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCorrection | contract-takeover.review-correction | covered | — |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/corrections | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordContractTakeoverCorrection<br>apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCorrection | contract-takeover.submit-correction | covered | DUPLICATE_MUTATION_ROUTE<br>ORPHAN_WRAPPER |
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
| POST | /projects/:projectId/expense-requests/:expenseRequestId/executions | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecution<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecutionWithUpload | project-expense.execution-local-status | covered | ORPHAN_WRAPPER |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/finance-records | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinance<br>apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinanceWithPreflight | project-expense.finance-local-status | covered | ORPHAN_WRAPPER |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/purchase-execution | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpensePurchaseExecution | project-expense.purchase-execution | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/receipt-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectExpenseReceiptWithPreflight | project-expense.receipt-confirm-local-status | covered | — |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/voiding | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#voidProjectExpenseRequest | project-expense.void | covered | — |
| POST | /projects/:projectId/expense-requests/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectExpensePrivateFile | project-expense.attachment-upload | covered | — |
| POST | /projects/:projectId/expense-requests | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createProjectExpenseRequest | project-expense.create-local-role | covered | — |
| POST | /projects/:projectId/financing-quotas/:quotaId/approval | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaReviewAction | project-financing-quota.review-approve<br>project-financing-quota.review-reject | covered | — |
| POST | /projects/:projectId/financing-quotas/:quotaId/termination | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#executeProjectFinancingQuotaTerminationAction | project-financing-quota.terminate | covered | — |
| POST | /projects/:projectId/financing-quotas | page | web_api_wrapper | apps/web-admin/src/api/project-financing-quota.api.ts#requestProjectFinancingQuotaWithUpload | project-financing-quota.request | covered | — |
| POST | /projects/:projectId/owner-contracts/:ownerContractId/confirmation | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectOwnerContract | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/owner-contracts | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectOwnerContract | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/proxy-payments | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectProxyPayment | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/receipts | exit_candidate | none | — | — | not_applicable | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#abandonSettlementDraftRecord<br>apps/web-admin/src/api/settlement-drafts.api.ts#executeSettlementDraftLifecycleAction | settlement-draft.abandon-application<br>settlement-draft.delete-pristine | covered | ORPHAN_WRAPPER |
| POST | /projects/:projectId/settlement-drafts/:draftId/approval-submission | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#submitSettlementDraftRecord | settlement-draft.submit | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/copies | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedSettlementDraft | settlement-list.copy-abandoned-draft | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/counterparty-signed-documents | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#linkSettlementCounterpartySignedDocument | settlement-draft.link-signed-document | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/frozen-document | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#generateSettlementFrozenDocument | settlement-draft.generate-frozen-document | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/line-attachments/:attachmentId/invalidation | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#invalidateSettlementDraftLineAttachment | settlement-line-attachment.invalidate | covered | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/lines/:lineKey/attachments | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#attachSettlementDraftLineFile | settlement-line-attachment.attach | covered | — |
| POST | /projects/:projectId/settlement-drafts/files | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#uploadSettlementDraftPrivateFile | settlement-draft.upload-signed-document<br>settlement-import.preview-local-gate<br>settlement-line-attachment.attach | covered | — |
| POST | /projects/:projectId/settlement-drafts | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#createSettlementDraftRecord | settlement-draft.save-local-gate | covered | — |
| POST | /projects/:projectId/settlement-exception-quotas/:quotaId/approval | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementExceptionQuota | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/settlement-exception-quotas | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#requestSettlementExceptionQuota | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/upstream-fund-facts/:fundFactId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamFundFact | project.upstream-fund.confirm | covered | — |
| POST | /projects/:projectId/upstream-fund-facts/file-uploads | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadProjectUpstreamFundPrivateFile | project.upstream-fund.evidence-upload | covered | — |
| POST | /projects/:projectId/upstream-fund-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamFundFact | project.upstream-fund.record | covered | — |
| POST | /projects/:projectId/upstream-settlements/:upstreamSettlementId/confirmation | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamSettlement | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/upstream-settlements | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamSettlement | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createProject | project.create | covered | — |
| POST | /settlement-template-versions/:versionId/clone | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#cloneSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#discardSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/inspection | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#inspectSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#generateSettlementTemplatePreview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/preview-pdf/download-ticket | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#downloadSettlementTemplatePreview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/preview-xlsx/download-ticket | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#downloadSettlementTemplatePreview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#publishSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/stop | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#stopSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-template-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#submitSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-templates | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#createSettlementTemplate | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
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
| POST | /settlements | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#createSettlementDraft | — | not_applicable | ORPHAN_WRAPPER |
| POST | /spot-procurement-payments/:paymentId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementPaymentDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurementPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/approval | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementPaymentReviewAction | spot-procurement-payment.legacy-review-approve<br>spot-procurement-payment.legacy-review-return-to-applicant<br>spot-procurement-payment.review-approve<br>spot-procurement-payment.review-return-to-applicant | covered | — |
| POST | /spot-procurement-payments/:paymentId/balance-execution | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurement-payments/:paymentId/executions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementPaymentExecution | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/invoices/:invoiceId/invalidation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#invalidateSpotProcurementPaymentInvoice | spot-procurement.invoice-invalidate | covered | — |
| POST | /spot-procurement-payments/:paymentId/invoices | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementInvoiceAppend | spot-procurement.invoice-append | covered | — |
| POST | /spot-procurement-payments/:paymentId/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/voiding | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurementPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/abnormal-termination/confirmation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#confirmSpotProcurementAbnormalTermination | spot-procurement.abnormal-termination-confirm | covered | — |
| POST | /spot-procurements/:procurementId/abnormal-termination | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#requestSpotProcurementAbnormalTermination | spot-procurement.abnormal-termination-request | covered | — |
| POST | /spot-procurements/:procurementId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementWithdrawalAction | spot-procurement.withdraw | covered | — |
| POST | /spot-procurements/:procurementId/approval | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#executeSpotProcurementReviewAction | spot-procurement.review-approve<br>spot-procurement.review-reject<br>spot-procurement.review-return-to-applicant | covered | — |
| POST | /spot-procurements/:procurementId/discrepancy | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDiscrepancy | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/invoice-exceptions | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/invoices | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/no-invoice-confirmations | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/payment-drafts | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recreateSpotProcurementPaymentDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/delegations | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementReceiptDelegation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/draft-reset | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#resetSpotProcurementReceiptDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/pdf-refresh | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#refreshSpotProcurementReceiptPdf | spot-procurement.receipt-pdf-refresh | covered | — |
| POST | /spot-procurements/:procurementId/receipt/photos | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#attachSpotProcurementReceiptPhoto | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/review-revocation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#revokeSpotProcurementReceiptReview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/review | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementReceipt | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementReceipt | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/refunds | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementRefund | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurement | spot-procurement.submit | covered | — |
| POST | /spot-procurements/:procurementId/supplier-balance-credit | exit_candidate | none | — | — | not_applicable | — |
| POST | /spot-procurements/:procurementId/versions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/voiding | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurement | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clause-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardStandardClauseVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clause-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#publishStandardClauseVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clause-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitStandardClauseVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clauses | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createStandardClause | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /vat-rate-options | exit_candidate | none | — | — | not_applicable | — |
| PUT | /contract-bills/:billId/rows | exit_candidate | none | — | — | not_applicable | — |
| PUT | /contract-drafts/:contractVersionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraftAggregate | contract-draft.aggregate-autosave<br>contract-draft.manual-save | covered | — |
| PUT | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#saveContractBillTransitions | contract-bill-transition.save | covered | — |
| PUT | /projects/:projectId/contract-takeovers/:takeoverId/contract-side | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverContractSide | contract-takeover.save-contract-side | covered | — |
| PUT | /projects/:projectId/contract-takeovers/:takeoverId/finance-side | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverFinanceSide | contract-takeover.save-finance-side | covered | — |

## 阻塞附录

### 无后端路由的 Web 请求

- `POST /spot-procurements/:param/payments` — apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementPaymentDraft

### 无后端路由的 Auth transport

- 无

### 孤儿 wrapper

- apps/web-admin/src/api/contract-workbench.api.ts#abandonContractDraft（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#addBillRow（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#createDraftCheckpoint（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#deleteBillRow（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#deletePristineContractDraft（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#fetchContractWorkbench（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#listContractDrafts（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#reorderBillRows（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#restoreContractDraft（unreferenced）
- apps/web-admin/src/api/contract-workbench.api.ts#restoreDraftCheckpoint（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#revokeContractTemplateVersion（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#revokeLayoutTemplateVersion（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraft（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#updateBillRow（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#voidContractDraft（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#assignProjectAffiliate（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectOwnerContract（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamSettlement（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#createContractDraft（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#createSettlementDraft（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#fetchActiveContractNumberRules（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLifecycleLedger（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateMappingReport（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementLifecycleLedger（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkbenchSummary（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordContractTakeoverCorrection（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecution（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContract（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecution（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinance（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectOwnerContract（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectProxyPayment（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamSettlement（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#requestSettlementExceptionQuota（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementExceptionQuota（test_only）
- apps/web-admin/src/api/settlement-drafts.api.ts#abandonSettlementDraftRecord（test_only）
- apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementPaymentDraft（test_only）

### 未覆盖写入消费者

- apps/web-admin/src/api/company-entity.api.ts#createCompanyEntity → apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue
- apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntity → apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue
- apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntityStatus → apps/web-admin/src/pages/company-entities/CompanyEntityListPage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#createContractBusinessScenario → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#createContractScenarioMapping → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#updateContractBusinessScenario → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#updateContractScenarioMapping → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#cloneContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#cloneLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createBusinessParty → apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createBusinessPartyVersion → apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createContractNumberRule → apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createContractTemplate → apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createLayoutTemplate → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createStandardClause → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#discardContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#discardLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#discardStandardClauseVersion → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#inspectLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#publishContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#publishLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#publishStandardClauseVersion → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#queueLayoutTemplatePreview → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#stopContractNumberRule → apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#submitContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#submitLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#submitStandardClauseVersion → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#updateContractNumberRule → apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#updateContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#updateLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedContractDraft → apps/web-admin/src/pages/contracts/ContractListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createApprovalDelegation → apps/web-admin/src/pages/delegations/DelegationListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#revokeApprovalDelegation → apps/web-admin/src/pages/delegations/DelegationListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#adjustExpenseClaimPaymentSubject → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#appendExpenseClaimAttachment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#attachExpenseClaimAttachment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#confirmExpenseClaimLoanRepayment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#createExpenseClaim → apps/web-admin/src/pages/expense-claims/components/ExpenseClaimCreateDrawer.vue
- apps/web-admin/src/api/expense-claim.api.ts#generateExpenseClaimFinalDisbursementPdf → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#generateExpenseClaimFinalPaymentPdf → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimLoanDisbursement → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimLoanRepayment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#recordExpenseClaimPayment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#removeExpenseClaimAttachment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#reverseExpenseClaimLoanRepayment → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#reviewExpenseClaim → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/expense-claim.api.ts#submitExpenseClaim → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleAddition → apps/web-admin/src/pages/organization/components/OrganizationRoleAdditionDrawer.vue
- apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleRemoval → apps/web-admin/src/pages/organization/components/OrganizationRoleRemovalDrawer.vue
- apps/web-admin/src/api/organization.api.ts#createOrganizationDepartment → apps/web-admin/src/pages/organization/OrganizationManagementPage.vue
- apps/web-admin/src/api/organization.api.ts#createOrganizationUser → apps/web-admin/src/pages/organization/components/OrganizationUserCreationDrawer.vue
- apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleAddition → apps/web-admin/src/pages/organization/components/OrganizationRoleAdditionDrawer.vue
- apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemoval → apps/web-admin/src/pages/organization/components/OrganizationRoleRemovalDrawer.vue
- apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemovalBatch → apps/web-admin/src/pages/organization/components/OrganizationBatchRoleRemovalDrawer.vue
- apps/web-admin/src/api/organization.api.ts#updateOrganizationDepartment → apps/web-admin/src/pages/organization/OrganizationManagementPage.vue
- apps/web-admin/src/api/organization.api.ts#updateOrganizationUser → apps/web-admin/src/pages/organization/OrganizationManagementPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#cloneSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#createSettlementTemplate → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#discardSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#downloadSettlementTemplatePreview → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#generateSettlementTemplatePreview → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#inspectSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#publishSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#stopSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#submitSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/settlement-template.api.ts#updateSettlementTemplateVersion → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementPaymentDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#attachSpotProcurementReceiptPhoto → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDiscrepancy → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementReceiptDelegation → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementVersion → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#deleteSpotProcurementReceiptPhoto → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementPaymentExecution → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementRefund → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#recreateSpotProcurementPaymentDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#resetSpotProcurementReceiptDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementReceipt → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#revokeSpotProcurementReceiptReview → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementReceipt → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentPayer → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementReceiptDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurement → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue

### 未解决动作绑定

- expense-claim.submit-local-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger

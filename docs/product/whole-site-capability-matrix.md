# 整站能力矩阵

状态：`blocked`。本表仅交叉核验四份实施清单，不构成删除或生产写入授权。

## 输入证据

| 输入 | 状态 | SHA-256 |
| --- | --- | --- |
| nestRoutes | ready | `62580430a97217233e458e2246bf76144c9f2c83e62ab8dce56d6cecc68a3a80` |
| webApiWrappers | blocked | `560ab05970a24830add6a3fec03292a8cd63a1b6c0ba60f9947f2e55caeb22bf` |
| webPageActions | blocked | `6fe8ee6f8fa649c6d48f41ec0989fd43c32eb64ed41165e29bc9a590e8a98764` |
| routeUsage | blocked | `18889b8b15be66c4fd15822f3fcf64de0ffa8f1e006505c964039bd549dc308d` |

## 汇总

| 指标 | 数量 |
| --- | ---: |
| routeCount | 395 |
| pageRouteCount | 285 |
| externalTakeoverRouteCount | 59 |
| exitCandidateRouteCount | 23 |
| internalTaskRouteCount | 2 |
| unclassifiedRouteCount | 26 |
| mainRequestBindingCount | 376 |
| webRequestWithoutNestCount | 1 |
| authRequestWithoutNestCount | 0 |
| orphanWrapperCount | 42 |
| duplicateMutationRouteCount | 4 |
| registeredActionCount | 42 |
| actionBindingCount | 45 |
| acceptedActionBindingCount | 6 |
| unresolvedActionBindingCount | 39 |
| productionMutationConsumerPairCount | 275 |
| coveredProductionMutationConsumerPairCount | 6 |
| uncoveredProductionMutationConsumerPairCount | 269 |
| blockerCount | 384 |

## 路由矩阵

| 方法 | 路径 | 用途 | 消费面 | Web wrapper | 动作 | 写入覆盖 | 阻塞 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DELETE | /approval-delegations/:delegationId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#revokeApprovalDelegation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| DELETE | /contract-bills/:billId/rows/:rowKey | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#deleteBillRow | — | not_applicable | ORPHAN_WRAPPER |
| DELETE | /contract-drafts/:contractVersionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#deletePristineContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| DELETE | /contract-drafts/:contractVersionId/edit-lease | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#releaseContractDraftEditLease | contract-draft.lease-release | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| DELETE | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardContractBillTransitions | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| DELETE | /contract-workbench/:contractVersionId/parties/:partySnapshotId | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
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
| GET | /contract-drafts/:contractVersionId/workbench | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#fetchContractDraftWorkbench | — | not_applicable | — |
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
| GET | /contract-workbench/:contractVersionId/offline-revisions | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| GET | /contract-workbench | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#listContractDrafts | — | not_applicable | ORPHAN_WRAPPER |
| GET | /contracts/:contractVersionId/authorizations/readiness | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| GET | /contracts/:contractVersionId/change-eligibility | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractChangeEligibility | — | not_applicable | — |
| GET | /contracts/:contractId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractDetail | — | not_applicable | — |
| GET | /contracts | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLedger | — | not_applicable | — |
| GET | /contracts/ledger-export | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractLedgerExport | — | not_applicable | — |
| GET | /contracts/lifecycle-ledger | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractLifecycleLedger | — | not_applicable | ORPHAN_WRAPPER |
| GET | /contracts/payment-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentContractOptions | — | not_applicable | — |
| GET | /contracts/settlement-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementContractOptions | — | not_applicable | — |
| GET | /contracts/workbench | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractWorkbenchLedger | — | not_applicable | — |
| GET | /draft-retention/preview | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchDraftRetentionPreview | — | not_applicable | — |
| GET | /expense-claims/:claimId | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimDetail | — | not_applicable | — |
| GET | /expense-claims/create-options | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaimCreateOptions | — | not_applicable | — |
| GET | /expense-claims | page | web_api_wrapper | apps/web-admin/src/api/expense-claim.api.ts#fetchExpenseClaims | — | not_applicable | — |
| GET | /files/:fileId/download | page | signed_ticket_delivery | — | — | not_applicable | — |
| GET | /funds-workbench | page | web_api_wrapper | apps/web-admin/src/api/funds-workbench.api.ts#fetchFundsWorkbench | — | not_applicable | — |
| GET | /health | internal_task | machine_probe | — | — | not_applicable | — |
| GET | /me/signature/canvas-handoffs/:token | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getCanvasSignatureHandoff | — | not_applicable | — |
| GET | /me/signature/ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getSignatureTicket | — | not_applicable | — |
| GET | /me/work-items | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkItems | — | not_applicable | — |
| GET | /me/workbench-summary | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchWorkbenchSummary | — | not_applicable | ORPHAN_WRAPPER |
| GET | /organization/directory | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#fetchOrganizationDirectory | — | not_applicable | — |
| GET | /organization/permission-integrity | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#fetchPermissionIntegrity | — | not_applicable | — |
| GET | /payments/:paymentId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentDetail | — | not_applicable | — |
| GET | /payments/contract-application | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractPaymentApplication | — | not_applicable | — |
| GET | /payments | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentLedger<br>apps/web-admin/src/api/core-flow-read.api.ts#fetchPaymentLifecycleLedger | — | not_applicable | — |
| GET | /projects/:projectId/affiliate-business-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateBusinessFacts | — | not_applicable | — |
| GET | /projects/:projectId/affiliate-company-contracts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateCompanyContracts | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/:takeoverId/detail-export | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractTakeoverDetailExport | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/:takeoverId | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#getContractTakeover | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#fetchContractTaxFactRevisions | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/company-entity-candidates | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listHistoricalCompanyEntityCandidates | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/import-batches | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listContractTakeoverImportBatches | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/import-template | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractTakeoverImportTemplate | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers/ledger-export | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadContractTakeoverLedgerExport | — | not_applicable | — |
| GET | /projects/:projectId/contract-takeovers | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#listContractTakeovers | — | not_applicable | — |
| GET | /projects/:projectId/expense-requests/:expenseRequestId/approval-detail | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectExpenseApprovalDetail | — | not_applicable | — |
| GET | /projects/:projectId/expense-requests | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectExpenseRequests | — | not_applicable | — |
| GET | /projects/:projectId/operating-funds-overview | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectOperatingOverview | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId/final-preparation | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementFinalPreparation | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId/line-attachments | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#listSettlementDraftLineAttachments | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts/:draftId | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#fetchSettlementDraftRecord | — | not_applicable | — |
| GET | /projects/:projectId/settlement-drafts | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#listSettlementDraftRecords | — | not_applicable | — |
| GET | /projects/affiliate-mapping-report | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchProjectAffiliateMappingReport | — | not_applicable | ORPHAN_WRAPPER |
| GET | /projects/contract-create-options | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchContractCreateProjects | — | not_applicable | — |
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
| GET | /settlements/:settlementId/draft-excel | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementDraftExcel | — | not_applicable | — |
| GET | /settlements/:settlementId/recovery | page | web_api_wrapper | apps/web-admin/src/api/settlement-recovery.api.ts#fetchSettlementRecovery | — | not_applicable | — |
| GET | /settlements/:settlementId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementDetail | — | not_applicable | — |
| GET | /settlements/ledger-export | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementLedgerExport | — | not_applicable | — |
| GET | /settlements/lifecycle-ledger | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementLifecycleLedger | — | not_applicable | ORPHAN_WRAPPER |
| GET | /settlements | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementLedger | — | not_applicable | — |
| GET | /settlements/workbench | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#fetchSettlementWorkbenchLedger | — | not_applicable | — |
| GET | /spot-procurement-payments/:paymentId | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementPaymentDetail | — | not_applicable | — |
| GET | /spot-procurement-payments | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementPayments | — | not_applicable | — |
| GET | /spot-procurements/:procurementId/receipt | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementReceipt | — | not_applicable | — |
| GET | /spot-procurements/:procurementId | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementDetail | — | not_applicable | — |
| GET | /spot-procurements/application-text-suggestions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementApplicationTextSuggestions | — | not_applicable | — |
| GET | /spot-procurements/capabilities | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementCapabilities | — | not_applicable | — |
| GET | /spot-procurements/create-project-options | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurementCreateProjectOptions | — | not_applicable | — |
| GET | /spot-procurements | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#fetchSpotProcurements | — | not_applicable | — |
| GET | /standard-clauses/history | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listStandardClauseHistory | — | not_applicable | — |
| GET | /standard-clauses | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#listPublishedStandardClauses | — | not_applicable | — |
| GET | /vat-rate-options | unclassified | none | apps/web-admin/src/api/spot-procurement.api.ts#fetchVatRateOptions | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| PATCH | /auth/profile | page | auth_store | — | — | not_applicable | — |
| PATCH | /company-entities/:id | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntity | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-bills/:billId/rows/:rowKey | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#updateBillRow | — | not_applicable | ORPHAN_WRAPPER |
| PATCH | /contract-business-scenarios/:scenarioId | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#updateContractBusinessScenario | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-layout-template-versions/:versionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#updateLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-number-rules/:ruleId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#updateContractNumberRule | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-scenario-template-mappings/:mappingId | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#updateContractScenarioMapping | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-template-versions/:versionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#updateContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /contract-workbench/:contractVersionId | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| PATCH | /contract-workbench/:contractVersionId/parties/:partySnapshotId | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| PATCH | /organization/departments/:departmentId | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#updateOrganizationDepartment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /organization/users/:userId | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#updateOrganizationUser | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /projects/:projectId/contract-takeovers/:takeoverId | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#updateContractTakeover | contract-takeover.update-local-role-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| PATCH | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#updateContractTaxFactRevision | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /projects/:projectId/contract-takeovers/import-batches/:batchId/review-result | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverImportBatch | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /projects/:projectId | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#updateProject | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /projects/:projectId/settlement-drafts/:draftId | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#updateSettlementDraftRecord | settlement-draft.save-local-gate | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| PATCH | /settlement-template-versions/:versionId | page | web_api_wrapper | apps/web-admin/src/api/settlement-template.api.ts#updateSettlementTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurement-payments/:paymentId/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurement-payments/:paymentId/payer | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentPayer | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurements/:procurementId/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /spot-procurements/:procurementId/receipt/draft | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementReceiptDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PATCH | /vat-rate-options/:optionId | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /approval-delegations | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createApprovalDelegation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /approval-forms/:businessType/:businessId/download | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /auth/change-password | page | auth_store | — | — | not_applicable | — |
| POST | /auth/login | page | auth_store | — | — | not_applicable | — |
| POST | /auth/logout | page | auth_store | — | — | not_applicable | — |
| POST | /auth/refresh | page | auth_store | — | — | not_applicable | — |
| POST | /auth/wx-login | exit_candidate | none | — | — | not_applicable | — |
| POST | /business-parties/:partyId/versions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createBusinessPartyVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /business-parties | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createBusinessParty | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /company-entities/:id/status | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntityStatus | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /company-entities | page | web_api_wrapper | apps/web-admin/src/api/company-entity.api.ts#createCompanyEntity | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-bill-imports/:importId/apply | unclassified | none | apps/web-admin/src/api/contract-workbench.api.ts#applyBillExcelImport | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /contract-bills/:billId/excel-imports | unclassified | none | apps/web-admin/src/api/contract-workbench.api.ts#previewBillExcelImport | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /contract-bills/:billId/rows/:rowKey/remainder-cancellation | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /contract-bills/:billId/rows | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#addBillRow | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-bills/:billId/rows/reorder | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#reorderBillRows | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-business-scenarios/:scenarioId/template-mappings | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#createContractScenarioMapping | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-business-scenarios | page | web_api_wrapper | apps/web-admin/src/api/contract-scenario.api.ts#createContractBusinessScenario | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-document-differences/:differenceId/disposition | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#disposeContractDocumentDifference | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-documents/:documentId/retry | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#retryContractDocument | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-drafts/:contractVersionId/bills/:billKey/import-preview | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#previewContractDraftBillExcelImport | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-drafts/:contractVersionId/edit-lease | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#acquireContractDraftEditLease | contract-draft.lease-acquire | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-drafts/:contractVersionId/edit-lease/heartbeat | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#heartbeatContractDraftEditLease | contract-draft.lease-heartbeat | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-drafts/:contractVersionId/edit-lease/takeover | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#takeOverContractDraftEditLease | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-drafts/:contractVersionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueContractDraftPreview | contract-draft.preview-queue | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-drafts/:contractVersionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitContractDraft | contract-workbench.submit-local-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/clone | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#cloneLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/inspection | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#inspectLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/preview-generation | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueLayoutTemplatePreview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#publishLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-template-versions/:versionId/revoke | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#revokeLayoutTemplateVersion | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-layout-template-versions/:versionId/stop | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#stopLayoutTemplateVersion | layout-template.risk-stop | covered | — |
| POST | /contract-layout-template-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitLayoutTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-layout-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createLayoutTemplate | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-negotiation-rounds/:roundId/close | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#closeContractNegotiationRound | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-number-rules/:ruleId/stop | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#stopContractNumberRule | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-number-rules | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createContractNumberRule | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-offline-revisions/:revisionId/preview-download-ticket | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#openContractRevisionPreview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-offline-revisions/:revisionId/retry | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#retryContractOfflineRevision | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/clone | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#cloneContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#publishContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-template-versions/:versionId/revoke | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#revokeContractTemplateVersion | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-template-versions/:versionId/stop | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#stopContractTemplateVersion | contract-template.risk-stop | covered | — |
| POST | /contract-template-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitContractTemplateVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-templates | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createContractTemplate | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-versions/:toContractVersionId/bill-transitions/confirm | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmContractBillTransitions | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractVersionId/checkpoints/:checkpointId/restore | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#restoreDraftCheckpoint | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-workbench/:contractVersionId/checkpoints | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#createDraftCheckpoint | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-workbench/:contractVersionId/documents | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#queueContractDocument | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractVersionId/negotiation-rounds | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#openContractNegotiationRound | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractVersionId/offline-revisions | page | web_api_wrapper | apps/web-admin/src/api/contract-negotiation.api.ts#uploadContractNegotiationRevision | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractVersionId/parties | unclassified | none | apps/web-admin/src/api/contract-workbench.api.ts#addContractParty | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /contract-workbench/:contractId/restore | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#restoreContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contract-workbench/:contractVersionId/settlement-mode/confirm | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#confirmContractSettlementMode | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractId/transfer | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#transferContractDraft | contract-draft.transfer-local-gate | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractVersionId/type-change-preview | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#previewContractTypeChange | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractVersionId/type-change | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#applyContractTypeChange | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contract-workbench/:contractId/void | exit_candidate | none | apps/web-admin/src/api/contract-workbench.api.ts#voidContractDraft | — | not_applicable | ORPHAN_WRAPPER |
| POST | /contracts/:contractVersionId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#abandonContractDraft | contract-draft.abandon-application<br>contract-draft.delete-pristine | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegateContractApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindContractApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/approval-submission | unclassified | none | apps/web-admin/src/api/contract-workbench.api.ts#submitContractFromWorkbench<br>apps/web-admin/src/api/core-flow-read.api.ts#submitContractApproval | — | not_applicable | DUPLICATE_MUTATION_ROUTE<br>ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /contracts/:contractVersionId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferContractApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/archive-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractArchive | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/archive-files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadContractArchiveFile | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/authorizations | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#setContractAuthorization | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/change-drafts | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createContractChangeDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/copies | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedContractDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/formal-files/approval | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#uploadContractFormalApprovalFile | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/formal-files/final/confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmMutuallySignedContract | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/formal-files/final | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadMutuallySignedContract | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/formal-files/final/return | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#returnMutuallySignedContractForCorrection | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generateContractPdfArchive | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/readiness | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#checkContractSubmissionReadiness | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/seal-approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#approveContractSeal | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/seal/approve | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#approveGovernedContractSeal | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/seal/complete | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#completeContractSeal | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /contracts/:contractVersionId/signing/material-change | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /contracts | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createWorkbenchDraft<br>apps/web-admin/src/api/core-flow-read.api.ts#createContractDraft | — | uncovered | DUPLICATE_MUTATION_ROUTE<br>MUTATION_CONSUMER_UNCOVERED<br>ORPHAN_WRAPPER |
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
| POST | /files/:fileId/download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile | payment-execution.record<br>settlement-import.preview-local-gate | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /invoice-allocations/:allocationId/reversal | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /me/signature/canvas-handoffs/:token/complete | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#completeCanvasSignatureHandoff | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /me/signature/canvas-handoffs | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createCanvasSignatureHandoff | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /me/signature/canvas | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadCanvasSignature | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /me/signature | unclassified | none | apps/web-admin/src/api/core-flow-read.api.ts#uploadSignature | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /organization/departments | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#createOrganizationDepartment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-additions/apply | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleAddition | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-additions/preview | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleAddition | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-changes/apply | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#applyOrganizationRoleRemoval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-changes/batch-preview | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemovalBatch | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/role-changes/preview | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#previewOrganizationRoleRemoval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /organization/users | page | web_api_wrapper | apps/web-admin/src/api/organization.api.ts#createOrganizationUser | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#abandonPaymentRequest | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegatePaymentApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindPaymentApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferPaymentApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawPaymentApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewPaymentApproval | payment-approval.approve<br>payment-approval.reject | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/executions | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecution | payment-execution.record | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/finance-records | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentFinance | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/pdf-archive | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentPdfArchive | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments/:paymentId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generatePaymentPdfArchive | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /payments | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createPaymentRequest | payment-request.create-local-form | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-assignment | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#assignProjectAffiliate | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/affiliate-business-facts/:factId/evidence | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#supplementProjectAffiliateBusinessEvidence | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-company-contracts/:contractId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateCompanyContract | affiliate-company-contract.confirm | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-company-contracts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContract | affiliate-company-contract.record | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-contract-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateContractFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-contract-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateContractFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-payment-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliatePaymentFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-payment-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliatePaymentFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-settlement-facts/:factId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateSettlementFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/affiliate-settlement-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateSettlementFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/abandonment | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#abandonContractTakeover | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/change-baseline-confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverChangeBaseline | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/company-entity-corrections/:correctionId/review | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCompanyEntityCorrection | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/company-entity-corrections | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCompanyEntityCorrection | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeover | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/contract-side/confirmation-withdrawal | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverContractSideConfirmation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/contract-side/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverContractSide | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/corrections/:correctionId/review | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCorrection | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/corrections | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordContractTakeoverCorrection<br>apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCorrection | — | uncovered | DUPLICATE_MUTATION_ROUTE<br>MUTATION_CONSUMER_UNCOVERED<br>ORPHAN_WRAPPER |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/evidence-files | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#attachContractTakeoverEvidenceFile | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/finance-side/confirmation-withdrawal | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverFinanceSideConfirmation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/finance-side/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverFinanceSide | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/payment-evidence-files | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#attachHistoricalPaymentVoucher | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/review-submission | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverReview | contract-takeover.submit-review-local-role-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/supplement-return | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#returnContractTakeoverForSupplement | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/abandonment | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#abandonContractTaxFactRevision | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/contract-confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#confirmContractTaxFactRevision | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/finance-review-submission | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#submitContractTaxFactRevisionForFinanceReview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions/:revisionId/finance-review | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#reviewContractTaxFactRevisionByFinance | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/:takeoverId/tax-fact-revisions | external_takeover | web_api_wrapper | apps/web-admin/src/api/contract-tax-facts.api.ts#createContractTaxFactRevision | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/import-batches/:batchId/draft-abandonment-apply | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#applyContractTakeoverBatchAbandonment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/import-batches/:batchId/draft-abandonment-preview | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#previewContractTakeoverBatchAbandonment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/import-drafts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createContractTakeoverDraftsFromImport | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/import-precheck | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#precheckContractTakeoverImport | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/imports/apply | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#applyContractTakeoverExcelImport | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers/imports/preview | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#previewContractTakeoverExcelImport | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/contract-takeovers | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createContractTakeover | contract-takeover.create-local-role | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/approval-pdf-download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadProjectExpenseApprovalPdf | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawProjectExpenseApproval | project-expense.withdraw | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewProjectExpenseApproval | project-expense.review-approve<br>project-expense.review-reject | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/attachment-download-ticket | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadProjectExpenseAttachment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/executions | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecution | project-expense.execution-local-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/finance-records | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinance | project-expense.finance-local-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/purchase-execution | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpensePurchaseExecution | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/receipt-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectExpenseReceipt | project-expense.receipt-confirm-local-status | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests/:expenseRequestId/voiding | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#voidProjectExpenseRequest | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/expense-requests | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createProjectExpenseRequest | project-expense.create-local-role | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/financing-quotas/:quotaId/approval | unclassified | none | apps/web-admin/src/api/core-flow-read.api.ts#reviewProjectFinancingQuota | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /projects/:projectId/financing-quotas/:quotaId/termination | unclassified | none | apps/web-admin/src/api/core-flow-read.api.ts#terminateProjectFinancingQuota | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /projects/:projectId/financing-quotas | unclassified | none | apps/web-admin/src/api/core-flow-read.api.ts#requestProjectFinancingQuota | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| POST | /projects/:projectId/owner-contracts/:ownerContractId/confirmation | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectOwnerContract | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/owner-contracts | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectOwnerContract | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/proxy-payments | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectProxyPayment | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/receipts | exit_candidate | none | — | — | not_applicable | — |
| POST | /projects/:projectId/settlement-drafts/:draftId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#abandonSettlementDraftRecord | settlement-draft.abandon-application<br>settlement-draft.delete-pristine | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts/:draftId/approval-submission | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#submitSettlementDraftRecord | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts/:draftId/copies | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedSettlementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts/:draftId/counterparty-signed-documents | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#linkSettlementCounterpartySignedDocument | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts/:draftId/frozen-document | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#generateSettlementFrozenDocument | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts/:draftId/line-attachments/:attachmentId/invalidation | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#invalidateSettlementDraftLineAttachment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts/:draftId/lines/:lineKey/attachments | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#attachSettlementDraftLineFile | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-drafts | page | web_api_wrapper | apps/web-admin/src/api/settlement-drafts.api.ts#createSettlementDraftRecord | settlement-draft.save-local-gate | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/settlement-exception-quotas/:quotaId/approval | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementExceptionQuota | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/settlement-exception-quotas | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#requestSettlementExceptionQuota | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/upstream-fund-facts/:fundFactId/confirmation | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamFundFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/upstream-fund-facts | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamFundFact | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /projects/:projectId/upstream-settlements/:upstreamSettlementId/confirmation | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamSettlement | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects/:projectId/upstream-settlements | external_takeover | none | apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamSettlement | — | not_applicable | ORPHAN_WRAPPER |
| POST | /projects | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#createProject | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
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
| POST | /settlement-workbench/contract-versions/:contractVersionId/imports/preview | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#previewSettlementImport | settlement-import.preview-local-gate | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-workbench/contract-versions/:contractVersionId/preview | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#previewSettlementLines | settlement-preview.background-local-gate<br>settlement-preview.manual-local-gate | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /settlement-workbench/projects/:projectId/imports/:importId/apply | page | web_api_wrapper | apps/web-admin/src/api/settlement-workbench.api.ts#applySettlementImport | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/approval-delegation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#delegateSettlementApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/approval-pdf/latest | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementLatestApprovalPdf | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/approval-reminder | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#remindSettlementApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/approval-transfer | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#transferSettlementApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#withdrawSettlementApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/approval | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementApproval | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/archive-confirmation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#confirmSettlementArchive | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/archive-files | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#uploadSettlementArchiveFile | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/pdf-generation | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#generateSettlementPdfArchive | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/recovery-entries/:entryId/reversal | page | web_api_wrapper | apps/web-admin/src/api/settlement-recovery.api.ts#reverseSettlementRecovery | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/recovery-entries | page | web_api_wrapper | apps/web-admin/src/api/settlement-recovery.api.ts#recordSettlementRecovery | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/signed-document-generation-retry | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#retrySettlementSignedDocumentGeneration | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements/:settlementId/signed-document-regeneration | page | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#regenerateSettlementSignedDocument | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /settlements | exit_candidate | none | apps/web-admin/src/api/core-flow-read.api.ts#createSettlementDraft | — | not_applicable | ORPHAN_WRAPPER |
| POST | /spot-procurement-payments/:paymentId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementPaymentDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurementPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/approval | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementA5Payment<br>apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementPayment | — | uncovered | DUPLICATE_MUTATION_ROUTE<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/balance-execution | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurement-payments/:paymentId/executions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementPaymentExecution | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/invoices/:invoiceId/invalidation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#invalidateSpotProcurementPaymentInvoice | spot-procurement.invoice-invalidate | covered | — |
| POST | /spot-procurement-payments/:paymentId/invoices | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#appendSpotProcurementPaymentInvoice | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurement-payments/:paymentId/voiding | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurementPayment | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/abandonment | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/abnormal-termination/confirmation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#confirmSpotProcurementAbnormalTermination | spot-procurement.abnormal-termination-confirm | covered | — |
| POST | /spot-procurements/:procurementId/abnormal-termination | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#requestSpotProcurementAbnormalTermination | spot-procurement.abnormal-termination-request | covered | — |
| POST | /spot-procurements/:procurementId/approval-withdrawal | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurement | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/approval | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurement | spot-procurement.review-approve<br>spot-procurement.review-reject | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/discrepancy | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDiscrepancy | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurements/:procurementId/invoice-exceptions | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurements/:procurementId/invoices | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurements/:procurementId/no-invoice-confirmations | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurements/:procurementId/payment-drafts | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recreateSpotProcurementPaymentDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/delegations | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementReceiptDelegation | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/draft-reset | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#resetSpotProcurementReceiptDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/pdf-refresh | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#refreshSpotProcurementReceiptPdf | spot-procurement.receipt-pdf-refresh | covered | — |
| POST | /spot-procurements/:procurementId/receipt/photos | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#attachSpotProcurementReceiptPhoto | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/review-revocation | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#revokeSpotProcurementReceiptReview | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/review | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementReceipt | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/receipt/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementReceipt | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/refunds | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#recordSpotProcurementRefund | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/submission | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurement | spot-procurement.submit | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/supplier-balance-credit | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| POST | /spot-procurements/:procurementId/versions | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements/:procurementId/voiding | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurement | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /spot-procurements | page | web_api_wrapper | apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementDraft | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clause-versions/:versionId/discard | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#discardStandardClauseVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clause-versions/:versionId/publication | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#publishStandardClauseVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clause-versions/:versionId/submission | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#submitStandardClauseVersion | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /standard-clauses | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#createStandardClause | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| POST | /vat-rate-options | unclassified | none | — | — | not_applicable | ROUTE_USAGE_UNCLASSIFIED |
| PUT | /contract-bills/:billId/rows | unclassified | none | apps/web-admin/src/api/contract-workbench.api.ts#replaceContractBillRows | — | not_applicable | ORPHAN_WRAPPER<br>ROUTE_USAGE_UNCLASSIFIED |
| PUT | /contract-drafts/:contractVersionId | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraftAggregate | contract-draft.aggregate-autosave<br>contract-draft.manual-save | uncovered | ACTION_BINDING_UNRESOLVED<br>MUTATION_CONSUMER_UNCOVERED |
| PUT | /contract-versions/:toContractVersionId/bill-transitions | page | web_api_wrapper | apps/web-admin/src/api/contract-workbench.api.ts#saveContractBillTransitions | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PUT | /projects/:projectId/contract-takeovers/:takeoverId/contract-side | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverContractSide | — | uncovered | MUTATION_CONSUMER_UNCOVERED |
| PUT | /projects/:projectId/contract-takeovers/:takeoverId/finance-side | external_takeover | web_api_wrapper | apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverFinanceSide | — | uncovered | MUTATION_CONSUMER_UNCOVERED |

## 阻塞附录

### 无后端路由的 Web 请求

- `POST /spot-procurements/:param/payments` — apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementPaymentDraft

### 无后端路由的 Auth transport

- 无

### 孤儿 wrapper

- apps/web-admin/src/api/contract-workbench.api.ts#addBillRow（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#addContractParty（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#applyBillExcelImport（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#createDraftCheckpoint（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#deleteBillRow（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#deletePristineContractDraft（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#fetchContractWorkbench（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#listContractDrafts（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#previewBillExcelImport（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#reorderBillRows（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#replaceContractBillRows（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#restoreContractDraft（unreferenced）
- apps/web-admin/src/api/contract-workbench.api.ts#restoreDraftCheckpoint（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#revokeContractTemplateVersion（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#revokeLayoutTemplateVersion（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraft（test_only）
- apps/web-admin/src/api/contract-workbench.api.ts#submitContractFromWorkbench（test_only）
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
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectOwnerContract（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectProxyPayment（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamSettlement（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#requestProjectFinancingQuota（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#requestSettlementExceptionQuota（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#reviewProjectFinancingQuota（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementExceptionQuota（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#submitContractApproval（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#terminateProjectFinancingQuota（test_only）
- apps/web-admin/src/api/core-flow-read.api.ts#uploadSignature（unreferenced）
- apps/web-admin/src/api/spot-procurement.api.ts#createSpotProcurementPaymentDraft（test_only）
- apps/web-admin/src/api/spot-procurement.api.ts#fetchVatRateOptions（test_only）

### 未覆盖写入消费者

- apps/web-admin/src/api/company-entity.api.ts#createCompanyEntity → apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue
- apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntity → apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue
- apps/web-admin/src/api/company-entity.api.ts#updateCompanyEntityStatus → apps/web-admin/src/pages/company-entities/CompanyEntityListPage.vue
- apps/web-admin/src/api/contract-negotiation.api.ts#closeContractNegotiationRound → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationSection.vue
- apps/web-admin/src/api/contract-negotiation.api.ts#disposeContractDocumentDifference → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationCanvas.vue
- apps/web-admin/src/api/contract-negotiation.api.ts#openContractNegotiationRound → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationSection.vue
- apps/web-admin/src/api/contract-negotiation.api.ts#openContractRevisionPreview → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationCanvas.vue
- apps/web-admin/src/api/contract-negotiation.api.ts#retryContractOfflineRevision → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationSection.vue
- apps/web-admin/src/api/contract-negotiation.api.ts#uploadContractNegotiationRevision → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationSection.vue
- apps/web-admin/src/api/contract-scenario.api.ts#createContractBusinessScenario → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#createContractScenarioMapping → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#updateContractBusinessScenario → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-scenario.api.ts#updateContractScenarioMapping → apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue
- apps/web-admin/src/api/contract-tax-facts.api.ts#abandonContractTaxFactRevision → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/contract-tax-facts.api.ts#confirmContractTaxFactRevision → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/contract-tax-facts.api.ts#createContractTaxFactRevision → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/contract-tax-facts.api.ts#reviewContractTaxFactRevisionByFinance → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/contract-tax-facts.api.ts#submitContractTaxFactRevisionForFinanceReview → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/contract-tax-facts.api.ts#updateContractTaxFactRevision → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/contract-workbench.api.ts#abandonContractDraft → apps/web-admin/src/pages/contracts/ContractListPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#abandonContractDraft → apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#acquireContractDraftEditLease → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#applyContractTypeChange → apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#checkContractSubmissionReadiness → apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#cloneContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#cloneLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#confirmContractBillTransitions → apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue
- apps/web-admin/src/api/contract-workbench.api.ts#confirmContractSettlementMode → apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createBusinessParty → apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createBusinessPartyVersion → apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createContractNumberRule → apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createContractTemplate → apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createLayoutTemplate → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createStandardClause → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#createWorkbenchDraft → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#discardContractBillTransitions → apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue
- apps/web-admin/src/api/contract-workbench.api.ts#discardContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#discardLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#discardStandardClauseVersion → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#heartbeatContractDraftEditLease → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#inspectLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#previewContractDraftBillExcelImport → apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue
- apps/web-admin/src/api/contract-workbench.api.ts#previewContractTypeChange → apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#publishContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#publishLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#publishStandardClauseVersion → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#queueContractDocument → apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue
- apps/web-admin/src/api/contract-workbench.api.ts#queueContractDraftPreview → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#queueLayoutTemplatePreview → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#releaseContractDraftEditLease → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#retryContractDocument → apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue
- apps/web-admin/src/api/contract-workbench.api.ts#saveContractBillTransitions → apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue
- apps/web-admin/src/api/contract-workbench.api.ts#saveContractDraftAggregate → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#setContractAuthorization → apps/web-admin/src/pages/contracts/workbench/ContractAuthorizationSection.vue
- apps/web-admin/src/api/contract-workbench.api.ts#stopContractNumberRule → apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#submitContractDraft → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#submitContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#submitLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#submitStandardClauseVersion → apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#takeOverContractDraftEditLease → apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts
- apps/web-admin/src/api/contract-workbench.api.ts#transferContractDraft → apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#updateContractNumberRule → apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#updateContractTemplateVersion → apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#updateLayoutTemplateVersion → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/contract-workbench.api.ts#uploadContractFormalApprovalFile → apps/web-admin/src/pages/contracts/workbench/ContractFormalDocumentSection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#abandonContractTakeover → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#abandonPaymentRequest → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#applyContractTakeoverBatchAbandonment → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#applyContractTakeoverExcelImport → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#approveContractSeal → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#approveGovernedContractSeal → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#attachContractTakeoverEvidenceFile → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#attachHistoricalPaymentVoucher → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#completeCanvasSignatureHandoff → apps/web-admin/src/pages/settings/HandwrittenSignaturePage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#completeContractSeal → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmContractArchive → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeover → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverChangeBaseline → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverContractSide → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmContractTakeoverFinanceSide → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmMutuallySignedContract → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateCompanyContract → apps/web-admin/src/pages/projects/components/AffiliateCompanyContractPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateContractFact → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliatePaymentFact → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectAffiliateSettlementFact → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectExpenseReceipt → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmProjectUpstreamFundFact → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#confirmSettlementArchive → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedContractDraft → apps/web-admin/src/pages/contracts/ContractListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#copyAbandonedSettlementDraft → apps/web-admin/src/pages/settlements/SettlementListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createApprovalDelegation → apps/web-admin/src/pages/delegations/DelegationListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createCanvasSignatureHandoff → apps/web-admin/src/components/JgSignatureHandoff.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createContractChangeDraft → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createContractTakeover → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createContractTakeoverDraftsFromImport → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPaymentRequest → apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/archives/ArchiveListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createPrivateFileDownloadTicket → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createProject → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#createProjectExpenseRequest → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#delegateContractApproval → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#delegatePaymentApproval → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#delegateSettlementApproval → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadApprovalForm → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadProjectExpenseApprovalPdf → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadProjectExpenseAttachment → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#downloadSettlementLatestApprovalPdf → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#generateContractPdfArchive → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#generatePaymentPdfArchive → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#generateSettlementPdfArchive → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#precheckContractTakeoverImport → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#previewContractTakeoverBatchAbandonment → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#previewContractTakeoverExcelImport → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentExecution → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentFinance → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordPaymentPdfArchive → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateCompanyContract → apps/web-admin/src/pages/projects/components/AffiliateCompanyContractPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateContractFact → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliatePaymentFact → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectAffiliateSettlementFact → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseExecution → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpenseFinance → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectExpensePurchaseExecution → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#recordProjectUpstreamFundFact → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#regenerateSettlementSignedDocument → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#remindContractApproval → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#remindPaymentApproval → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#remindSettlementApproval → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#retrySettlementSignedDocumentGeneration → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#returnContractTakeoverForSupplement → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#returnMutuallySignedContractForCorrection → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewContractApproval → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCompanyEntityCorrection → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverCorrection → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewContractTakeoverImportBatch → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewPaymentApproval → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewProjectExpenseApproval → apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#reviewSettlementApproval → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#revokeApprovalDelegation → apps/web-admin/src/pages/delegations/DelegationListPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverContractSide → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#saveContractTakeoverFinanceSide → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCompanyEntityCorrection → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverCorrection → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#submitContractTakeoverReview → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#supplementProjectAffiliateBusinessEvidence → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#transferContractApproval → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#transferPaymentApproval → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#transferSettlementApproval → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#updateContractTakeover → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#updateProject → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadCanvasSignature → apps/web-admin/src/pages/settings/SettingsPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadContractArchiveFile → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadMutuallySignedContract → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/components/ContractTaxFactReviewPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/workbench/ContractAuthorizationSection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/workbench/ContractFormalDocumentSection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/workbench/ContractNegotiationSection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/contracts/workbench/ContractPartySection.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/expense-claims/ExpenseClaimDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/projects/components/AffiliateCompanyContractPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/settlements/components/SettlementLineAttachmentPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/settlements/components/SettlementRecoveryLedgerPanel.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadPrivateFile → apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#uploadSettlementArchiveFile → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#voidProjectExpenseRequest → apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractApproval → apps/web-admin/src/pages/contracts/ContractDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverContractSideConfirmation → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#withdrawContractTakeoverFinanceSideConfirmation → apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#withdrawPaymentApproval → apps/web-admin/src/pages/payments/PaymentDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#withdrawProjectExpenseApproval → apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue
- apps/web-admin/src/api/core-flow-read.api.ts#withdrawSettlementApproval → apps/web-admin/src/pages/settlements/SettlementDetailPage.vue
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
- apps/web-admin/src/api/settlement-drafts.api.ts#abandonSettlementDraftRecord → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#attachSettlementDraftLineFile → apps/web-admin/src/pages/settlements/components/SettlementLineAttachmentPanel.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#createSettlementDraftRecord → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#generateSettlementFrozenDocument → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#invalidateSettlementDraftLineAttachment → apps/web-admin/src/pages/settlements/components/SettlementLineAttachmentPanel.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#linkSettlementCounterpartySignedDocument → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#submitSettlementDraftRecord → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-drafts.api.ts#updateSettlementDraftRecord → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-recovery.api.ts#recordSettlementRecovery → apps/web-admin/src/pages/settlements/components/SettlementRecoveryLedgerPanel.vue
- apps/web-admin/src/api/settlement-recovery.api.ts#reverseSettlementRecovery → apps/web-admin/src/pages/settlements/components/SettlementRecoveryLedgerPanel.vue
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
- apps/web-admin/src/api/settlement-workbench.api.ts#applySettlementImport → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-workbench.api.ts#previewSettlementImport → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/settlement-workbench.api.ts#previewSettlementLines → apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#abandonSpotProcurementPaymentDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#appendSpotProcurementPaymentInvoice → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
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
- apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementA5Payment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurement → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#reviewSpotProcurementReceipt → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#revokeSpotProcurementReceiptReview → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurement → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#submitSpotProcurementReceipt → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementPaymentPayer → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#updateSpotProcurementReceiptDraft → apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurement → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#voidSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurement → apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue
- apps/web-admin/src/api/spot-procurement.api.ts#withdrawSpotProcurementPayment → apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue

### 未解决动作绑定

- affiliate-company-contract.confirm#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- affiliate-company-contract.record#0 — causal_unverified, no_accepted_consumer, capability_not_dominating_trigger
- contract-draft.abandon-application#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.aggregate-autosave#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.delete-pristine#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.lease-acquire#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.lease-heartbeat#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.lease-release#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.manual-save#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.preview-queue#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-draft.transfer-local-gate#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-takeover.create-local-role#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-takeover.submit-review-local-role-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-takeover.update-local-role-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- contract-workbench.submit-local-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- expense-claim.submit-local-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- payment-approval.approve#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- payment-approval.reject#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- payment-execution.record#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- payment-execution.record#1 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- payment-request.create-local-form#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.create-local-role#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.execution-local-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.finance-local-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.receipt-confirm-local-status#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.review-approve#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.review-reject#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- project-expense.withdraw#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-draft.abandon-application#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-draft.delete-pristine#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-draft.save-local-gate#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-draft.save-local-gate#1 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-import.preview-local-gate#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-import.preview-local-gate#1 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-preview.background-local-gate#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- settlement-preview.manual-local-gate#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- spot-procurement.review-approve#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- spot-procurement.review-reject#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger
- spot-procurement.submit#0 — causal_unverified, no_accepted_consumer, capability_not_server_derived, capability_not_dominating_trigger

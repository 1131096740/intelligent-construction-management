# 合同工作台能力矩阵

> 本文件由 `scripts/inspect-contract-workbench-capabilities.mjs` 生成。静态关系不能单独证明生产零调用；“删除”必须同时具备实际 Nest route manifest 和批准观察窗口内的脱敏生产命中计数。

## 证据状态

| 证据 | 状态 |
| --- | --- |
| Controller 源码路由 | 已扫描 184 条 |
| Web API 请求 | 已扫描 139 条 |
| 实际 Nest route manifest | 已通过 `app.init()` 读取，共 399 条；源码缺运行时 0 条，运行时缺源码 0 条 |
| 生产或生产等价旧路由命中 | 缺失；不得据静态矩阵执行删除 |
| route-usage 候选退出 | 已读取 24 条合同专项候选；物理删除授权固定为否 |

## 分类汇总

| 分类 | 数量 |
| --- | ---: |
| matched | 116 |
| frontend_without_backend | 0 |
| backend_without_frontend | 47 |
| backend_internal_only | 0 |
| legacy_candidate | 0 |
| exit_candidate | 24 |

## 不存在的页面 API wrapper

- 无。

## 能力与决策

| Method | Route | API wrapper | 生产消费者 | 分类 | 决策 | 物理删除授权 | 退出/删除缺失证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/business-parties` | listBusinessParties | apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue | matched | 保留 | 否 | — |
| POST | `/business-parties` | createBusinessParty | apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue | matched | 保留 | 否 | — |
| GET | `/business-parties/:param` | getBusinessParty | apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/business-parties/:param/versions` | createBusinessPartyVersion | apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue | matched | 保留 | 否 | — |
| GET | `/company-entities` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/company-entities` | — |  | backend_without_frontend | 补入口 | 否 | — |
| PATCH | `/company-entities/:param` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/company-entities/:param/history` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/company-entities/:param/status` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/company-entities/management` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-bill-imports/:param/apply` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-bills/:param/excel-imports` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/contract-bills/:param/excel-template` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-bills/:param/rows` | addBillRow |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| PUT | `/contract-bills/:param/rows` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| DELETE | `/contract-bills/:param/rows/:param` | deleteBillRow |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| PATCH | `/contract-bills/:param/rows/:param` | updateBillRow |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-bills/:param/rows/:param/remainder-cancellation` | executeContractBillRemainderCancellation | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-bills/:param/rows/reorder` | reorderBillRows |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/contract-business-scenarios` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-business-scenarios` | — |  | backend_without_frontend | 补入口 | 否 | — |
| PATCH | `/contract-business-scenarios/:param` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-business-scenarios/:param/template-mappings` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/contract-business-scenarios/available` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/contract-business-scenarios/recommendations` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-document-differences/:param/disposition` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-documents/:param/retry` | retryContractDocument | apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue | matched | 保留 | 否 | — |
| DELETE | `/contract-drafts/:param` | deletePristineContractDraft |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| PUT | `/contract-drafts/:param` | saveContractDraftAggregate | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| POST | `/contract-drafts/:param/bills/:param/import-preview` | previewContractDraftBillExcelImport | apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue | matched | 保留 | 否 | — |
| GET | `/contract-drafts/:param/bills/:param/template` | — |  | backend_without_frontend | 补入口 | 否 | — |
| DELETE | `/contract-drafts/:param/edit-lease` | releaseContractDraftEditLease | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| POST | `/contract-drafts/:param/edit-lease` | acquireContractDraftEditLease | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| POST | `/contract-drafts/:param/edit-lease/heartbeat` | heartbeatContractDraftEditLease | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| POST | `/contract-drafts/:param/edit-lease/takeover` | takeOverContractDraftEditLease | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| POST | `/contract-drafts/:param/preview-generation` | queueContractDraftPreview | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| POST | `/contract-drafts/:param/submission` | submitContractDraft | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| GET | `/contract-drafts/:param/workbench` | fetchContractDraftWorkbench | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue<br>apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| PATCH | `/contract-layout-template-versions/:param` | updateLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/clone` | cloneLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/discard` | discardLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/inspection` | inspectLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| GET | `/contract-layout-template-versions/:param/preview-generation` | getLatestLayoutTemplatePreview | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/preview-generation` | queueLayoutTemplatePreview | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/publication` | publishLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/revoke` | revokeLayoutTemplateVersion |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-layout-template-versions/:param/stop` | stopLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-template-versions/:param/submission` | submitLayoutTemplateVersion | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| GET | `/contract-layout-templates` | listPublishedLayoutTemplates | apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue | matched | 保留 | 否 | — |
| POST | `/contract-layout-templates` | createLayoutTemplate | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| GET | `/contract-layout-templates/:param` | getLayoutTemplate | apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-negotiation-rounds/:param/close` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/contract-number-rules` | fetchActiveContractNumberRules |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/contract-number-rules` | listContractNumberRules | apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue | matched | 保留 | 否 | — |
| POST | `/contract-number-rules` | createContractNumberRule | apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue | matched | 保留 | 否 | — |
| PATCH | `/contract-number-rules/:param` | updateContractNumberRule | apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue | matched | 保留 | 否 | — |
| POST | `/contract-number-rules/:param/stop` | stopContractNumberRule | apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue | matched | 保留 | 否 | — |
| POST | `/contract-offline-revisions/:param/preview-download-ticket` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-offline-revisions/:param/retry` | — |  | backend_without_frontend | 补入口 | 否 | — |
| PATCH | `/contract-scenario-template-mappings/:param` | — |  | backend_without_frontend | 补入口 | 否 | — |
| PATCH | `/contract-template-versions/:param` | updateContractTemplateVersion | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-template-versions/:param/clone` | cloneContractTemplateVersion | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-template-versions/:param/discard` | discardContractTemplateVersion | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-template-versions/:param/publication` | publishContractTemplateVersion | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-template-versions/:param/revoke` | revokeContractTemplateVersion |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-template-versions/:param/stop` | stopContractTemplateVersion | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-template-versions/:param/submission` | submitContractTemplateVersion | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| GET | `/contract-templates` | listPublishedContractTemplates | apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue<br>apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue<br>apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-templates` | createContractTemplate | apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue | matched | 保留 | 否 | — |
| GET | `/contract-templates/:param` | getContractTemplate | apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue | matched | 保留 | 否 | — |
| DELETE | `/contract-versions/:param/bill-transitions` | discardContractBillTransitions | apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue | matched | 保留 | 否 | — |
| GET | `/contract-versions/:param/bill-transitions` | fetchContractBillTransitions | apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue | matched | 保留 | 否 | — |
| PUT | `/contract-versions/:param/bill-transitions` | saveContractBillTransitions | apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue | matched | 保留 | 否 | — |
| POST | `/contract-versions/:param/bill-transitions/confirm` | confirmContractBillTransitions | apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue | matched | 保留 | 否 | — |
| GET | `/contract-versions/:param/bill-transitions/options` | fetchContractBillTransitionOptions | apps/web-admin/src/pages/contracts/workbench/ContractBillTransitionsSection.vue | matched | 保留 | 否 | — |
| GET | `/contract-workbench` | listContractDrafts |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/contract-workbench/:param` | fetchContractWorkbench |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| PATCH | `/contract-workbench/:param` | saveContractDraft |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-workbench/:param/checkpoints` | createDraftCheckpoint |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-workbench/:param/checkpoints/:param/restore` | restoreDraftCheckpoint |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/contract-workbench/:param/documents` | listContractDocuments | apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue | matched | 保留 | 否 | — |
| POST | `/contract-workbench/:param/documents` | queueContractDocument | apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue | matched | 保留 | 否 | — |
| GET | `/contract-workbench/:param/negotiation-rounds` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-workbench/:param/negotiation-rounds` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/contract-workbench/:param/offline-revisions` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-workbench/:param/offline-revisions` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contract-workbench/:param/parties` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| DELETE | `/contract-workbench/:param/parties/:param` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| PATCH | `/contract-workbench/:param/parties/:param` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-workbench/:param/restore` | restoreContractDraft |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contract-workbench/:param/settlement-mode/confirm` | confirmContractSettlementMode | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-workbench/:param/transfer` | transferContractDraft | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-workbench/:param/type-change` | applyContractTypeChange | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-workbench/:param/type-change-preview` | previewContractTypeChange | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contract-workbench/:param/void` | voidContractDraft |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/contracts` | fetchContractLedger | apps/web-admin/src/pages/search/GlobalSearchPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts` | createContractDraft |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contracts` | createWorkbenchDraft | apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts | matched | 保留 | 否 | — |
| GET | `/contracts/:param` | fetchContractDetail | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/abandonment` | abandonContractDraft |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/contracts/:param/approval` | executeContractApprovalReviewAction | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/approval-delegation` | delegateContractApproval | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/approval-reminder` | remindContractApproval | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/approval-submission` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contracts/:param/approval-transfer` | transferContractApproval | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/approval-withdrawal` | executeContractApprovalWithdrawalAction | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/archive-confirmation` | confirmContractArchive | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/archive-files` | uploadContractArchiveFile | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/authorizations` | setContractAuthorization | apps/web-admin/src/pages/contracts/workbench/ContractAuthorizationSection.vue | matched | 保留 | 否 | — |
| GET | `/contracts/:param/authorizations/readiness` | — |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| POST | `/contracts/:param/change-drafts` | createContractChangeDraft | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| GET | `/contracts/:param/change-eligibility` | fetchContractChangeEligibility | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/copies` | copyAbandonedContractDraft | apps/web-admin/src/pages/contracts/ContractListPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/formal-files/approval` | uploadContractFormalApprovalFile | apps/web-admin/src/pages/contracts/workbench/ContractFormalDocumentSection.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/formal-files/final` | uploadMutuallySignedContract | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/formal-files/final/confirmation` | confirmMutuallySignedContract | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/formal-files/final/return` | returnMutuallySignedContractForCorrection | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/pdf-generation` | generateContractPdfArchive | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/readiness` | checkContractSubmissionReadiness | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/seal-approval` | approveContractSeal | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/seal/approve` | approveGovernedContractSeal | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/seal/complete` | completeContractSeal | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| POST | `/contracts/:param/signing/material-change` | executeContractSigningMaterialChange | apps/web-admin/src/pages/contracts/ContractDetailPage.vue | matched | 保留 | 否 | — |
| GET | `/contracts/ledger-export` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/contracts/lifecycle-ledger` | fetchContractLifecycleLedger |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/contracts/payment-create-options` | fetchPaymentContractOptions | apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue | matched | 保留 | 否 | — |
| GET | `/contracts/settlement-create-options` | fetchSettlementContractOptions | apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue | matched | 保留 | 否 | — |
| GET | `/contracts/workbench` | fetchContractWorkbenchLedger | apps/web-admin/src/pages/contracts/ContractListPage.vue | matched | 保留 | 否 | — |
| POST | `/draft-retention/controlled-entry` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/draft-retention/preview` | fetchDraftRetentionPreview | apps/web-admin/src/pages/settings/SettingsPage.vue | matched | 保留 | 否 | — |
| GET | `/me/workbench-summary` | fetchWorkbenchSummary |  | exit_candidate | 候选退出 | 否 | production_exit_candidate_zero_calls, independent_deletion_authorization |
| GET | `/payments/contract-application` | fetchContractPaymentApplication | apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/affiliate-company-contracts` | fetchProjectAffiliateCompanyContracts | apps/web-admin/src/pages/projects/components/AffiliateCompanyContractPanel.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/affiliate-company-contracts` | recordProjectAffiliateCompanyContract |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/affiliate-company-contracts/:param/confirmation` | confirmProjectAffiliateCompanyContract | apps/web-admin/src/pages/projects/components/AffiliateCompanyContractPanel.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/affiliate-contract-facts` | recordProjectAffiliateContractFact | apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/affiliate-contract-facts/:param/confirmation` | confirmProjectAffiliateContractFact | apps/web-admin/src/pages/projects/components/AffiliateBusinessLedgerPanel.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers` | listContractTakeovers | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers` | createContractTakeover | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers/:param` | getContractTakeover | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| PATCH | `/projects/:param/contract-takeovers/:param` | updateContractTakeover | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/abandonment` | abandonContractTakeover | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/change-baseline-confirmation` | confirmContractTakeoverChangeBaseline | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/company-entity-corrections` | submitContractTakeoverCompanyEntityCorrection | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/company-entity-corrections/:param/review` | reviewContractTakeoverCompanyEntityCorrection | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/confirmation` | confirmContractTakeover | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| PUT | `/projects/:param/contract-takeovers/:param/contract-side` | saveContractTakeoverContractSide | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/contract-side/confirmation` | confirmContractTakeoverContractSide | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/contract-side/confirmation-withdrawal` | withdrawContractTakeoverContractSideConfirmation | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/corrections` | recordContractTakeoverCorrection |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/corrections` | submitContractTakeoverCorrection | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/corrections/:param/review` | reviewContractTakeoverCorrection | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers/:param/detail-export` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/evidence-files` | attachContractTakeoverEvidenceFile | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| PUT | `/projects/:param/contract-takeovers/:param/finance-side` | saveContractTakeoverFinanceSide | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/finance-side/confirmation` | confirmContractTakeoverFinanceSide | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/finance-side/confirmation-withdrawal` | withdrawContractTakeoverFinanceSideConfirmation | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/payment-evidence-files` | attachHistoricalPaymentVoucher | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/review-submission` | submitContractTakeoverReview | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/supplement-return` | returnContractTakeoverForSupplement | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers/:param/tax-fact-revisions` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/tax-fact-revisions` | — |  | backend_without_frontend | 补入口 | 否 | — |
| PATCH | `/projects/:param/contract-takeovers/:param/tax-fact-revisions/:param` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/tax-fact-revisions/:param/abandonment` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/tax-fact-revisions/:param/contract-confirmation` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/tax-fact-revisions/:param/finance-review` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/contract-takeovers/:param/tax-fact-revisions/:param/finance-review-submission` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/projects/:param/contract-takeovers/company-entity-candidates` | listHistoricalCompanyEntityCandidates | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers/import-batches` | listContractTakeoverImportBatches | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/import-batches/:param/draft-abandonment-apply` | applyContractTakeoverBatchAbandonment | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/import-batches/:param/draft-abandonment-preview` | previewContractTakeoverBatchAbandonment | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| PATCH | `/projects/:param/contract-takeovers/import-batches/:param/review-result` | reviewContractTakeoverImportBatch | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/import-drafts` | createContractTakeoverDraftsFromImport | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/import-precheck` | precheckContractTakeoverImport | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers/import-template` | downloadContractTakeoverImportTemplate | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/imports/apply` | applyContractTakeoverExcelImport | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| POST | `/projects/:param/contract-takeovers/imports/preview` | previewContractTakeoverExcelImport | apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue | matched | 保留 | 否 | — |
| GET | `/projects/:param/contract-takeovers/ledger-export` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/owner-contracts` | recordProjectOwnerContract |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/projects/:param/owner-contracts/:param/confirmation` | confirmProjectOwnerContract |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/projects/contract-create-options` | fetchContractCreateProjects | apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue | matched | 保留 | 否 | — |
| GET | `/settlement-workbench/contract-versions/:param/import-template` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/settlement-workbench/contract-versions/:param/imports/preview` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/settlement-workbench/contract-versions/:param/participant-options` | — |  | backend_without_frontend | 补入口 | 否 | — |
| POST | `/settlement-workbench/contract-versions/:param/preview` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/settlement-workbench/contract-versions/:param/source-lines` | — |  | backend_without_frontend | 补入口 | 否 | — |
| GET | `/settlement-workbench/projects/:param/contract-versions/:param/template-recommendations` | — |  | backend_without_frontend | 补入口 | 否 | — |

## 复核结论

- 清单余量取消、签署材料变更等尚未被 route-usage 审计为 `exit_candidate` 的后端能力，如无生产消费者，保持“补入口”或经业务确认后“转内部”，不能仅因页面缺入口删除。
- route-usage 已审计的 `exit_candidate` 只能显示“候选退出”；仍缺生产观察窗口零调用证据和独立物理删除授权，不得升级为“删除”。候选一旦重新出现生产消费者，检查器失败关闭。
- `listContractDrafts`、void/restore、单行 add/update/delete/reorder 和 checkpoint 创建/恢复以实际消费者分类；route manifest、调用图及生产零命中同时成立时最多由“保留”转为“候选退出”，仍须独立物理删除授权才能删除。
- 台账“删除草稿”当前委托 `abandonContractDraft` 调用 `POST /contracts/:contractVersionId/abandonment`，并提交 `delete_pristine_draft` 领域动作；旧 `deletePristineContractDraft` wrapper 无生产消费者。本矩阵不把受控物理 purge 暴露为日常页面能力。
- 当前矩阵没有授权物理删除。Release C1 只允许在证据齐备后退出旧调用代码；checkpoint 表物理删除仍属于需独立授权的 Release C2。

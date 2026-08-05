# 合同草稿删除、签署文件与历史清理规格

日期：2026-08-05

状态：产品规则已完成逐项对齐；本规格只授权后续拆票与实施设计，不授权修改生产数据库、COS 生命周期规则、生产业务数据或执行任何生产删除

适用范围：新建合同的未提交草稿、曾进入审批后结束的合同申请、合同工作台生成文件、乙方签章文件、双方最终签章归档文件、合同台账可见性、合同编号占用、清理任务及其生产预检

覆盖关系：本规格仅在“新建合同”领域覆盖旧草稿生命周期设计中“不物理删除纯净草稿、永久保留审批型结束记录、主管不能删除下属草稿、Super Admin 不具备草稿删除权、签章文件不得物理删除”等冲突条款。结算、付款、零星采购、费用、模板和其他领域仍遵循各自现有生命周期规则。

## Problem Statement

建工智管当前把多种不同事实混在“草稿”和合同台账中：从未提交审批的个人草稿、曾进入审批后退回的申请、主动放弃或最终驳回的结束记录、合同工作台生成的 Word/PDF、乙方返回的签章文件以及双方最终归档文件。现有实现主要依赖逻辑放弃和全桶 COS 历史版本生命周期，不能满足用户对“确认删除未提交草稿后立即物理清理”的预期，也不能保证默认合同台账只显示仍在办理或已经生效的合同。

合同签署文件流程也比实际业务复杂。系统当前区分草稿、对外磋商稿和内部送审稿，强制生成水印，要求磋商轮次和逐项差异处置，并在提交审批前强制上传特定格式的乙方签章 PDF。实际工作方式更简单：合同员从工作台生成普通无水印 Word/PDF 发给乙方；乙方可以直接修改并签章；合同员人工核对并把最终接受内容同步回工作台，然后以乙方签章版发起我方审批。

生产 COS 桶已经开启版本控制。普通删除对象只会产生删除标记，历史版本仍可能保留 90 天；现有全桶生命周期规则只负责历史版本和删除标记维护，既不能删除 PostgreSQL 业务记录，也不能证明合同草稿已完成物理删除。所有应用文件又共用 `uploads/`，不能对整个前缀配置过期规则。

该需求需要同时解决四个问题：

1. 从未提交审批的合同草稿应在明确确认后从业务数据库和私有对象存储中真实删除。
2. 曾进入审批后主动放弃或最终驳回的合同申请应先保留一段可查询期，再按明确生命周期整项清理。
3. 合同文件生成、乙方签章、我方审批、我方盖章和最终归档应贴合实际工作方式，不依赖无必要的水印和磋商流程。
4. 合同正文、敏感文件、未提交草稿和正式合同摘要必须按生命周期、岗位及项目范围分别授权。

## Solution

系统为新建合同建立清晰、领域化的生命周期，而不是用一个通用 `deletedAt` 或 COS 前缀规则处理所有数据。

从未提交审批的 `draft` 由当前合同经办人、合同部主管或 Super Admin 执行普通确认后立即进入 `deleting`。记录马上从业务台账隐藏并停止编辑。系统先基于统一文件绑定事实区分独占文件与共享文件：共享文件只解除本草稿绑定；独占文件按精确对象键删除全部 COS 历史版本和删除标记。文件清理完成后再物理删除合同草稿及其子记录。失败任务保持 `deleting` 并自动重试，不向用户重新开放编辑。删除收据只保留三个自然月；如已分配正式合同编号，永久保留一个不含业务信息的编号占位，确保编号永不复用。

合同申请一旦创建过审批实例，就不再属于可即时删除的纯草稿。退回申请人或主动撤回后可以修改并重新提交；最终驳回或经办人/合同部主管明确选择放弃后进入“已结束/历史”，完整只读保留三个自然月。到期前 30 天进入合同部主管待清理列表；没有争议、调查或人工保留标记时整项物理删除，包括业务记录、审批记录、审计记录和文件，仅保留最小编号占位。保留标记解除时若已经超过保留期，再给予 30 天缓冲期。

合同工作台只提供一个“生成合同文件”入口，一次生成无水印 Word 和 PDF 并直接下载到合同员电脑。首次生成时分配并锁定正式合同编号。生成文件只是短期下载产物，不作为长期业务档案；长期保留的文件从乙方返回签章版开始。乙方签章版允许 PDF、Word 或多张清晰图片，系统保留原文件并生成固定顺序的只读审批预览。合同员只需整体确认文件完整且与工作台最终内容一致；任何会进入合同文件的内容再次变化都会取消确认。

当前阶段只支持“乙方先签章，再发起我方审批”。审批以冻结的乙方签章预览为主要原件，以冻结的工作台金额、条款和清单为核对依据。我方审批通过后可以打印乙方盖章扫描件再签字盖章，不要求最终文件与审批文件是同一纸张、同一页数或相同文件字节。合同经办人上传双方最终签章版，合同部主管人工确认内容一致、双方签章完整后归档生效。默认执行双人复核；合同部主管本人经办时允许自审、自上传和自确认，但不能替代项目经理、财务主管、董事长或总经理等其他审批岗位。

合同读取权限按生命周期拆分。未提交草稿只对当前经办人、合同部主管和 Super Admin 开放。提交审批后，拥有合同全貌权限的岗位按项目或全公司范围查看正文、金额、条款、清单、附件、版本、审批和归档资料。普通员工只能查看本人任职项目中已经归档生效合同的非敏感摘要。未来新增岗位默认无任何合同查看权限，必须明确配置后才开放。

## User Stories

1. As a 合同经办人, I want to permanently delete my never-submitted contract draft after one confirmation, so that unused work does not remain in the ledger or storage.
2. As a 合同经办人, I want the delete action to work even when the draft contains parties, clauses, bills, attachments, generated files, a counterparty-signed file, or an allocated formal code, so that the system does not invent hidden deletion blockers.
3. As a 合同经办人, I want a deleted never-submitted draft to disappear immediately from normal ledgers, so that I do not confuse it with active or historical contracts.
4. As a 合同经办人, I want deletion to require an explicit confirmation but no reason or current password, so that the action is clear without unnecessary ceremony.
5. As a 合同部主管, I want to delete any never-submitted contract draft in the company, so that abandoned work can be cleaned when the original handler cannot act.
6. As a Super Admin, I want to perform the technical deletion of any never-submitted contract draft, so that technical recovery and exceptional cleanup are possible without granting business approval authority.
7. As a contract user, I want only the current handler, contract director, and Super Admin to see an unsubmitted draft, so that other staff cannot inspect unfinished contract content.
8. As a file owner, I want a shared file to remain available to other business records when one draft is deleted, so that deleting a draft cannot destroy another record's evidence.
9. As a company, I want an exclusive draft file to have every COS object version and delete marker removed, so that “physical deletion” is not merely a hidden current version.
10. As a company, I want object deletion to target exact object keys rather than the shared `uploads/` prefix, so that formal contracts, settlements, payments, and archives cannot be deleted accidentally.
11. As a contract user, I want a draft in `deleting` to be hidden and locked, so that partial cross-system cleanup cannot reopen stale editable content.
12. As a Super Admin, I want failed cleanup jobs to expose safe technical diagnostics and support idempotent retry, so that COS or database failures can be resolved without duplicate deletion.
13. As a 合同部主管, I want to see only the business summary and retry status of cleanup failures, so that I can govern the business outcome without receiving storage secrets.
14. As a company, I want deletion to become final only after exclusive COS objects and database records are both gone, so that the system does not report false success.
15. As a contract auditor, I want a never-submitted draft deletion receipt to remain for three natural months, so that recent deletion disputes can be checked without retaining the deleted contract content.
16. As a company, I want the draft deletion receipt itself to be removed after three natural months, so that deleted draft history does not become a permanent parallel ledger.
17. As a company, I want a used formal contract code to remain permanently reserved after deletion, abandonment, or rejection, so that no later contract can reuse the code.
18. As a contract handler, I want a returned application to remain editable and resubmittable, so that requested corrections can be completed in the same application.
19. As a contract handler, I want a voluntarily withdrawn approval to remain editable and resubmittable, so that withdrawal is not confused with abandonment.
20. As a contract handler, I want an explicit “放弃申请” action to end an application permanently, so that work that will not continue leaves active ledgers and task lists.
21. As an approver, I want a final rejection to end the application permanently, so that a rejected process cannot silently restart under the same approval history.
22. As a company, I want abandoned and finally rejected applications to remain read-only in “已结束/历史” for three natural months, so that recent decisions can still be reviewed.
23. As a company, I want those ended applications to be fully removed after three natural months, including approval and audit records, so that ended business data does not remain indefinitely.
24. As a 合同部主管, I want records due for cleanup to appear 30 days in advance, so that disputed or investigated cases can be retained before automatic deletion.
25. As a 合同部主管, I want to set or remove a retention hold with a reason, so that disputed or investigated applications are not deleted automatically.
26. As a company, I want a record whose overdue hold is removed to receive a further 30-day buffer, so that release of a hold does not trigger an unexpected same-day purge.
27. As a Super Admin, I want to execute technical retries but not remove a business retention hold, so that technical authority cannot override a contract governance decision.
28. As a contract user, I want a fully cleaned ended application to disappear from “已结束/历史”, so that the ledger reflects the actual retention policy.
29. As a company, I want effective contracts, contract changes, supplements, and superseded effective versions to remain permanently, so that formal contract history is never swept by draft cleanup.
30. As a contract handler, I want one “生成合同文件” action to create both Word and PDF, so that I do not need to choose between artificial document purposes.
31. As a contract handler, I want generated contract files to contain no “草稿”, “磋商稿”, “内部评审”, downloader, or timestamp watermark, so that they can be sent directly to the counterparty for editing and signing.
32. As a contract handler, I want generated Word and PDF files to download directly to my computer, so that temporary outgoing files do not become permanent system archives.
33. As a company, I want temporary generated files removed after their download ticket expires, so that repeated draft generation does not accumulate storage.
34. As a contract handler, I want the first external contract-file generation to allocate and lock the formal contract code, so that the file sent for signature contains a stable code.
35. As a contract handler, I want later generations of the same draft to reuse the same formal code, so that corrections do not consume multiple contract codes.
36. As a contract handler, I want to send the generated Word file when the counterparty needs to edit and the PDF when the counterparty wants to print and sign, so that the system supports normal offline collaboration.
37. As a contract handler, I want the counterparty to be allowed to edit the outgoing file directly, so that negotiation does not require a mandatory system round or line-by-line disposition workflow.
38. As a contract handler, I want to update the workbench manually with the final accepted counterparty changes, so that structured payment terms, clauses, and bills remain authoritative for internal processing.
39. As a contract handler, I want to upload a counterparty-signed PDF, Word file, or ordered images, so that approval is not blocked by one rigid file format.
40. As an approver, I want the system to preserve uploaded originals and present a normalized read-only preview, so that I can review the same frozen content regardless of input format.
41. As a contract handler, I want one overall confirmation that the counterparty file is complete and matches the workbench, so that I do not have to complete five rigid signature checkboxes.
42. As a contract handler, I want changes to contract content, amount, parties, payment terms, bills, or signing information to invalidate that confirmation, so that a stale confirmation cannot be submitted.
43. As a contract handler, I want internal notes that never enter the contract document to leave the confirmation intact, so that harmless administrative edits do not restart file verification.
44. As a contract handler, I want a content-changing approval return to invalidate the prior counterparty-signed file and require a new counterparty signature, so that resubmission does not rely on an obsolete signed document.
45. As a contract handler, I want an internal-note-only return to reuse the existing counterparty-signed file, so that the system does not demand unnecessary resigning.
46. As an approver, I want the frozen counterparty-signed preview to be the primary approval original and the frozen workbench data to be visible alongside it, so that discrepancies can be detected.
47. As an approver, I want a discrepancy to be returned for manual correction rather than automatically overwriting either source, so that the system does not invent contract terms.
48. As a seal handler, I want to print the approved counterparty-stamped scan and apply the company signature and seal to the printout, so that physical-paper constraints do not block the process.
49. As a contract handler, I want the final mutually signed archive to accept PDF, Word, or ordered images, so that real scanning and signing methods are supported.
50. As a contract director, I want to confirm manually that the final archive has the approved contract content and complete signatures and seals, so that page count, compression, or byte differences do not cause false rejection.
51. As a contract director, I want archive confirmation to use an explicit confirmation dialog without a current-password prompt, so that the sensitive action remains deliberate but practical.
52. As a contract handler, I want to replace a mistaken final upload before archive confirmation, so that an upload error can be corrected.
53. As a company, I want an unreferenced mistaken pre-confirmation upload physically removed while retaining only the current pending file, so that incorrect files do not accumulate.
54. As a company, I want a confirmed effective archive and all its files to become immutable and permanent, so that later changes require a contract change or supplemental agreement.
55. As a contract handler, I want the contract director to be the normal archive confirmer, so that ordinary contracts receive two-person review.
56. As a contract director who is also the handler, I want to approve my contract-director node and confirm my own archive, so that a project is not blocked when the same person holds both duties.
57. As a multi-position employee, I want to act separately at each approval node for which I hold a valid appointment, so that valid concurrent roles are respected and each action records the role used.
58. As a company, I want self-review to be explicit in the audit while other approval nodes remain mandatory, so that a contract director cannot substitute for project management, finance, or executive approval.
59. As a project-scoped full-view user, I want to see submitted and historical contracts only for my active projects, so that my access follows current responsibility.
60. As a global full-view user, I want to see submitted and historical contracts across the company, so that company-level governance roles can perform their duties.
61. As an ordinary employee, I want to see only effective-contract summaries for my active projects, so that I can know basic contract context without receiving sensitive content.
62. As an ordinary employee, I want the summary limited to code, name, type, project, counterparty, effective date, and status, so that amount, terms, bills, files, versions, and approvals remain protected.
63. As a transferred employee, I want contract access to end when my project or position assignment ends, so that former responsibility does not become permanent access.
64. As a delegated approver, I want temporary full access only to the contract version assigned to my active task, so that I can decide the task without receiving broader ledger access.
65. As a full-view user, I want downloads to perform live authorization and write an audit event without adding a watermark, so that sensitive file access remains controlled without modifying the document.
66. As a company, I want receipt-photo evidence watermarks to remain unchanged, so that removal of contract document watermarks does not weaken mandatory procurement evidence.
67. As a future-role administrator, I want a new position to start with no contract visibility until an explicit scope is configured, so that role creation cannot leak contracts by default.
68. As a release owner, I want a read-only preflight showing candidate records, exclusive files, shared files, exact object keys, COS version counts, and blockers before any production purge, so that production deletion is separately reviewable.
69. As a release owner, I want pre-existing ended applications to start their three-month clock on the new rule's activation date, so that rollout cannot immediately erase production history.
70. As a release owner, I want pre-existing active unsubmitted drafts to remain untouched until a permitted user confirms deletion, so that age alone cannot authorize deletion.
71. As a release owner, I want pre-existing never-submitted records already marked `abandoned` by an old user delete action to count as authorized cleanup candidates, so that users do not have to repeat a deletion they already requested.
72. As a release owner, I want those legacy authorized candidates listed in the read-only production preflight and withheld until separate execution approval, so that product authorization is not confused with deployment authorization.

## Implementation Decisions

### 1. Domain classification

- A contract version is eligible for immediate physical draft deletion only when its current status is `draft`, it has never been submitted, no approval instance or approval action has ever existed for it, and no formal effective downstream contract fact exists.
- `status = draft` alone is insufficient. A returned or withdrawn record may be editable but remains an approval-type application and is never eligible for immediate draft deletion.
- An uploaded counterparty-signed file, attachment, generated number, preview, or structured child content does not remove immediate-deletion eligibility when the record has never entered approval.
- Returned and voluntarily withdrawn applications remain editable and resubmittable.
- Final rejection and explicit abandonment are terminal. They cannot be edited, restored, or resubmitted.
- Copying an ended application into a new draft, if ever added, must create a new identity and is not restoration of the old record.

### 2. Immediate deletion orchestration

- User confirmation first moves the eligible draft to `deleting`, hides it from normal reads, revokes editing, and permanently voids any allocated formal code.
- The cleanup workflow is an idempotent saga rather than an impossible cross-system transaction.
- The workflow computes the complete business binding set before deleting files. Shared files are unbound only; an object becomes deletable only when no other current or historical protected business binding remains.
- Exclusive COS objects are deleted before the database aggregate is physically purged. All versions and delete markers for the exact object key must be removed.
- A draft remains `deleting` while any required object version or database child remains. Failed work is retried automatically and can be retried manually by Super Admin.
- The user-facing success state means both object storage and database cleanup have completed.
- The ordinary delete confirmation requires no reason and no current-password challenge.
- Eligible actors are the current contract handler, the global contract director, and Super Admin. All actions record the actual actor and original handler while the receipt exists.

### 3. Immediate-deletion receipt and number tombstone

- The deletion receipt contains only project identity, old contract/version identities, contract name, allocated formal code if present, original handler, deleter, completion time, deleted/unbound file counts, and an aggregate hash.
- The deletion receipt is retained for three natural months from cleanup completion, then physically deleted.
- A formal code that has ever been allocated is represented permanently by a minimal uniqueness tombstone after all other business data is deleted.
- The tombstone contains no contract name, amount, counterparty, project, person, approval, file, or audit content.
- A physically deleted never-submitted draft never appears in “已结束/历史” and has no recycle bin.

### 4. Ended approval-type retention

- Explicit abandonment can be decided only by the current handler or the global contract director. Super Admin cannot make the business decision.
- Final rejection and explicit abandonment enter the read-only “已结束/历史” view immediately.
- The complete application, approval, audit, and file content remains available for three natural months from the terminal event.
- Three months means calendar-month arithmetic, not a fixed 90-day duration.
- The candidate enters the contract director's cleanup-preview list 30 days before expiry.
- The contract director alone can set or remove a business retention hold and must supply a reason. Super Admin can operate the job but cannot bypass or remove the hold.
- If an already-overdue hold is removed, the new purge date is 30 days after hold removal.
- On expiry without a hold, the system automatically purges the full application aggregate, approval instances/actions, business audit events, previews, generated documents, attachments, signed files, and storage objects, subject to shared-file protection.
- After successful purge, the application disappears from “已结束/历史” and is not recoverable. Only the minimal formal-code tombstone remains.
- Effective contracts, effective changes, supplements, and superseded effective versions are permanently excluded from this cleanup.

### 5. Legacy rollout rules

- Existing ended applications do not use their historical terminal date for immediate catch-up deletion. Their retention clock starts at the production activation time of the new policy.
- Existing active unsubmitted drafts are never selected automatically by age.
- A legacy never-submitted record already marked `abandoned` as the result of an old user delete action is treated as already authorized for physical cleanup.
- Legacy authorization does not authorize production execution. A read-only candidate report and separate explicit production approval remain mandatory.
- The preflight must fail closed on unknown bindings, missing file hashes, inconsistent project/version coordinates, unresolved shared references, missing COS version enumeration, active holds, or status/submission ambiguity.

### 6. Contract document generation

- The workbench exposes one “生成合同文件” action and removes user-facing draft, negotiation, and internal-review generation purposes.
- A successful request produces one Word and one PDF from the same saved workbench revision.
- Neither output contains a draft, negotiation, internal-review, downloader, or time watermark.
- Receipt-photo and other separately governed evidence watermarks are unchanged.
- The first external-file generation allocates the formal contract code in the same protected business operation and locks it permanently to the contract root.
- Repeated generation after edits reuses the same formal code.
- Generated Word/PDF are temporary download artifacts rather than durable contract archives. They are removed after the existing short-lived download-ticket lifecycle expires; a user regenerates them if necessary.
- A newly completed generation supersedes prior temporary outputs for the same draft. No user-facing generated-document history is retained.
- Mandatory negotiation rounds, uploaded DOCX comparisons, difference dispositions, and round closure are removed from the submission readiness path. Existing historical data may remain readable until a separately planned migration removes it.

### 7. Counterparty-signed submission package

- The only signing sequence in this scope is counterparty first, company second. A company-first signing path is out of scope.
- The counterparty may edit the downloaded file directly before signing.
- The handler manually synchronizes accepted edits into structured workbench content.
- Accepted input formats are PDF, Word, and ordered clear images.
- The system preserves uploaded originals and derives a normalized immutable read-only preview for approval.
- One overall declaration replaces the five detailed signature/order declarations: the handler confirms that the returned file is complete and matches the final workbench content.
- Any change to content projected into the contract file clears the declaration. This includes parties, amount, payment terms, clauses, bills, and signing facts. Internal-only notes do not clear it.
- Submission freezes the uploaded originals, normalized preview, workbench revision, formal code, structured data snapshot, file hashes, and actor/time facts.
- A content-changing return invalidates the prior signed package and requires a new counterparty signature. Internal-note-only changes may reuse it.

### 8. Approval, company seal, and final archive

- Approvers review the frozen counterparty-signed preview as the primary original and the frozen structured workbench facts as a parallel reconciliation view.
- A discrepancy is returned for manual correction. The system never automatically overwrites the file from workbench data or the workbench from extracted file content.
- Final approval creates the existing company-seal task. Other approval roles remain mandatory.
- Company signing may occur on a printed copy of the approved counterparty-stamped scan. The system governs semantic content consistency rather than same-paper or same-byte continuity.
- The final archive accepts PDF, Word, or ordered images and preserves originals plus a normalized read-only preview.
- Archive confirmation requires an explicit confirmation dialog but no current-password input.
- The contract director confirms manually that contract content matches the approved version and both parties' signatures/seals are complete.
- Page count, MIME type, byte hash, compression, scan dimensions, or paper identity differences between approval and final files are not hard blockers. Each stored artifact retains its own hash to detect later replacement.
- Before archive confirmation, a mistaken final upload can be replaced. An unreferenced replaced file is physically deleted.
- After archive confirmation, the effective archive and its versions are immutable and permanent. Changes require a contract change or supplemental agreement.
- Normal operation separates handler upload from contract-director confirmation.
- When the contract director is also the handler, that person may approve the contract-director node, upload, and confirm the archive. Self-review is recorded explicitly.
- A person holding multiple valid positions may process each corresponding approval node through separate actions. Each action records the position used; the person cannot skip or substitute for positions not held.

### 9. Contract visibility and action permissions

- Unsubmitted drafts: current handler, global contract director, and Super Admin only.
- Temporary delegated/assigned approval access: only the assigned contract version while the approval task is active; task completion removes the temporary document access while preserving the action record for its retention period.
- Global contract-full-view positions: chairman, general manager, contract director, material director, finance director, finance staff, comprehensive director, budget director, engineering department director, and Super Admin.
- The display name of `engineering_department_director` is “工程技术部主管”; the position is currently vacant but remains in the model.
- Project-scoped contract-full-view positions: contract staff, material staff, budget staff, project manager, engineering department member, project chief engineer, engineering foreman, and engineering technician/surveyor.
- `engineering_director` means “项目总工”. `engineering_tech` means “测量员”.
- Project-scoped users see the full contract for all active project assignments covered by their positions, not only contracts they created or approved.
- Multiple active positions and project assignments produce the union of permitted scopes.
- A position or project assignment ending removes future access immediately. Historical action records do not preserve viewing rights.
- Ordinary employees see only effective-contract summaries for their active projects. Summary fields are formal code, name, type, project, counterparty, effective date, and status.
- Ordinary employees do not see amounts, payment terms, bills, body text, files, versions, approval history, drafts, in-progress applications, or ended/history records.
- Future positions start with no contract access until explicitly configured as project summary, project full view, or global full view.
- Full-view users may preview and download sensitive files. Every download performs live authorization and writes an audit event; no contract-file download watermark is added.
- Ended/history visibility follows the same project/global full-view scopes. Ordinary employees never see ended/history records.

### 10. Ledger information architecture

- The default contract ledger excludes physically deleting, abandoned, and finally rejected records.
- “我的草稿” contains only the current user's never-submitted drafts.
- Returned-to-applicant and voluntarily withdrawn applications remain actionable but are visibly distinct from never-submitted drafts.
- “已结束/历史” contains abandonment, final rejection, and other retained terminal contract records until their purge date.
- Physically deleted never-submitted drafts never enter history.
- After an ended record is purged, it disappears from history rather than degrading to an audit-only row.
- Effective and in-progress contract visibility is computed by the server using lifecycle, position, active project assignment, and temporary approval-task scope. Frontend filtering is not an authorization control.

### 11. File ownership and COS behavior

- File deletion authority is derived from complete business bindings, not from uploader identity or object-key naming alone.
- A file is shared if any protected business binding outside the cleanup target remains. Shared files are never object-deleted by this workflow.
- An exclusive file cleanup deletes all object versions and delete markers for the exact key in the configured bucket and region.
- The existing whole-bucket lifecycle rule remains enabled and unchanged. It is not part of business cleanup success and must not be presented as draft cleanup.
- No expiration rule is added to `uploads/` or the whole bucket for this feature.
- Storage enumeration and deletion must be idempotent. A missing already-deleted version is treated as converged only when a fresh enumeration proves no version or delete marker remains.

### 12. Data model and migration boundaries

- The implementation may add domain-specific lifecycle/job/hold/number-tombstone records; it must not introduce a universal soft-delete framework.
- Immediate draft deletion and retained-ended purge are separate policies sharing one exact-file cleanup primitive and one idempotent job model.
- Database purge order must be derived from actual foreign-key and business-binding graphs. It must not depend on uncontrolled cascade behavior.
- Purging approval and audit rows after three months is an explicit product decision in this specification and supersedes the earlier permanent-audit assumption for abandoned/finally rejected new-contract applications only.
- Records for effective contracts and other business domains are excluded even when they share tables or audit infrastructure.
- Migration must preserve existing effective, in-approval, returned, and active draft records. No migration may classify by `status` alone.
- A production migration or cleanup command defaults to preview/no-write and requires explicit apply scope, exact candidate receipt, and separate production authorization.

### 13. Operational responsibilities

- The contract director owns business retention holds, upcoming-cleanup review, and business-level cleanup status.
- Super Admin owns technical retries and storage/database diagnostics but cannot decide abandonment or remove a hold.
- Cleanup errors expose no credentials, private URLs, full object keys to unauthorized users, or deleted contract content.
- Production execution must continue using the already authenticated authorized account; no password or verification code may be requested, copied, or relayed by an agent.
- No code release, schema migration, COS operation, production write, or production deletion is authorized by this specification alone.

## Testing Decisions

### Testing philosophy

- Tests assert externally observable lifecycle, authorization, file, and ledger behavior rather than private helper structure.
- The highest application seam is a real Nest request path covering authentication, authorization guards, validation, controller binding, service transaction, audit behavior, and response.
- Real PostgreSQL integration tests prove transaction, foreign-key, concurrency, retention-date, hold, number-tombstone, and purge behavior.
- Object-storage tests use the storage adapter with a deterministic versioned-COS fake or isolated non-production fixture. Automated tests never use the production bucket.
- Web component/API tests cover rendering and action availability; Playwright covers the smallest critical multi-role workflows.
- Production checks are read-only preflight reports. A successful preflight is not deletion authorization.

### API route-level acceptance

- Prove a current handler, contract director, and Super Admin can request deletion of an eligible never-submitted draft.
- Prove an unrelated user, project-scoped full-view user, ordinary employee, and future unconfigured role cannot delete or read the draft.
- Prove a `draft` with any prior submission/approval fact is rejected by immediate deletion.
- Prove a never-submitted draft remains eligible when it has attachments, counterparty-signed files, structured bills/terms, or an allocated formal code.
- Prove confirmation places the draft in `deleting`, hides it, and rejects further saves or submission.
- Prove deletion and submission races have one winner and cannot produce a submitted-but-purged contract.
- Prove abandonment permissions exclude Super Admin and unrelated business roles.
- Prove returned/withdrawn versus final-rejected/abandoned transitions and action availability.
- Prove contract director self-review only covers positions actually held and cannot skip remaining approval nodes.
- Prove archive confirmation requires a confirmation action but no current password.

### PostgreSQL integration

- Prove immediate deletion removes the contract aggregate in a controlled order while preserving shared `FileObject` bindings.
- Prove formal-code tombstones prevent reuse under concurrent allocation and cleanup.
- Prove deletion receipt expiry at three calendar months and ended-record expiry at three calendar months.
- Prove 30-day preview, active hold, hold removal, and post-release 30-day buffer.
- Prove effective/superseded-effective contracts are excluded from all cleanup selections.
- Prove legacy `abandoned` classification requires never-submitted evidence and an old delete action.
- Prove cleanup retries are idempotent across partial COS success, partial database progress, process restart, and duplicate job delivery.
- Prove purging one ended application does not remove shared approval, file, project, user, role, or effective-contract facts.

### Versioned object-storage contract

- Create an exact-key fixture with multiple object versions and delete markers and prove all are removed.
- Prove a current-object delete that leaves a noncurrent version is not accepted as success.
- Prove a similarly prefixed formal object is untouched.
- Prove shared-file classification performs no object deletion.
- Prove repeated deletion after complete convergence is safe.
- Prove enumeration, authorization, throttling, and transient errors leave the job retryable without exposing secrets.

### Contract document and archive behavior

- Prove one generation request allocates or reuses the formal code and produces Word/PDF without contract watermarks.
- Prove no user-facing generation purpose or mandatory negotiation readiness remains.
- Prove generated temporary files are removed after ticket expiry and are not shown as durable history.
- Prove PDF, Word, and ordered-image counterparty packages preserve originals and produce a frozen preview.
- Prove contract-content changes clear the overall confirmation while internal-only notes do not.
- Prove submission freezes the exact preview, structured snapshot, revision, hashes, actor, and time.
- Prove a content-changing return requires a new signed package.
- Prove the final archive may differ in page count, MIME, and bytes while retaining separately verified immutable hashes.
- Prove replacement before confirmation removes only the unreferenced mistaken file.
- Prove archive confirmation makes the final version immutable and effective.

### Visibility and Web acceptance

- Shared-domain tests enumerate every current position into unsubmitted-draft, project-summary, project-full-view, global-full-view, temporary-task, or no-access behavior.
- API read-model tests prove server-side scope for project and global users and immediate revocation after assignment changes.
- Ordinary employee tests prove only the seven approved summary fields are returned for effective contracts in active projects.
- Contract ledger tests prove default, my-drafts, returned/withdrawn, and ended/history views do not leak records across lifecycle buckets.
- Web tests prove actions follow server capabilities rather than frontend role guesses.
- Playwright covers at least: handler generation/upload/submission; project-scoped full-view reading; ordinary-employee summary; contract-director self-review/archive exception; immediate draft deletion; and ended-record retention/hold visibility.
- Download tests prove live authorization and audit without a contract watermark.

### Production preflight acceptance

- Report the exact Git SHA, migration baseline, policy activation state, candidate counts by lifecycle, formal-code counts, file-binding counts, shared/exclusive classification, exact object keys in a protected receipt, version/delete-marker counts, holds, and blockers.
- The human-facing report masks sensitive object keys and personal data while retaining a root-only or equivalently protected exact receipt.
- Any ambiguous submission history, unknown binding, missing hash, failed version enumeration, or candidate drift makes readiness fail closed.
- Applying cleanup requires a new explicit authorization tied to the exact report and candidate fingerprint.

## Out of Scope

- Implementing a company-first signature path in which the company approves and seals before the counterparty.
- Changing lifecycle rules for settlement, payment, expense, spot procurement, receipt, template, tax-fact revision, or historical takeover domains.
- Removing the mandatory server-generated watermark from spot-procurement receipt photos or other separately governed evidence images.
- OCR, automatic legal-text extraction, automatic workbench updates from Word/PDF, or automatic semantic contract comparison.
- Requiring the counterparty to use the system, an electronic-signature platform, or a prescribed signing tool.
- Adding a recycle bin or restore function for physically deleted never-submitted drafts.
- Reusing voided formal contract codes.
- Modifying, disabling, or replacing the existing whole-bucket COS historical-version lifecycle rule.
- Adding an expiration rule to `uploads/` or any broad shared prefix.
- Physically deleting effective contracts, effective changes, supplements, superseded effective versions, or their archives.
- Executing production migration, production cleanup, COS deletion, deployment, push, or merge as part of this specification task.
- Preserving a permanent business/audit skeleton after the three-month purge of abandoned or finally rejected new-contract applications; the only permanent residue is the minimal formal-code tombstone.

## Further Notes

- The read-only repository baseline used for this specification is detached SHA `f599c5e87f072f1606f8e4c88cc68c08d3aef64b`; implementation must recheck the selected execution baseline before editing.
- The confirmed production COS facts are bucket `jiangkong-prod-files-1438687719`, region `ap-chengdu`, versioning enabled, and one enabled whole-bucket lifecycle rule that removes delete markers without historical versions and removes noncurrent versions after 90 days. These are time-scoped facts and must be reverified before any production operation.
- Application objects currently share the `uploads/` namespace without a draft-only prefix. Correctness therefore depends on complete business-binding classification, not key naming.
- Current implementation conflicts with this specification in document watermarks and required watermark placeholders, three document purposes, negotiation readiness, formal-code allocation timing, PDF-only formal-file inspection, five detailed declarations, page-count linkage, archive password confirmation, absolute uploader/confirmer separation, logical draft abandonment, and permanent approval/audit preservation.
- The product decision to purge approval and audit records after three calendar months is intentionally narrower than the project's general permanent-audit posture. Implementation tickets must protect every effective contract and every out-of-scope business domain from this exception.
- The required sequence after this spec is `/to-tickets`, then one dependency-ordered implementation chain using test-first slices and code review. Interconnected schema, file, permissions, and lifecycle changes must not be implemented in parallel branches without explicit integration ownership.

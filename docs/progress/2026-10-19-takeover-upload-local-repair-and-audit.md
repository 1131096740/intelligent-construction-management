# 上传与未提交草稿删除：本地修复记录（2026-10-19）

## 授权与版本

- 用户授权扩展至另外18个上传接口、历史经营接管与结算明细附件的就近提示和失败保留，并排查费用、采购及其他页面的草稿删除。用户明确补充：“未审批且无正式资金事实的，也改为彻底删除；保留审计”。结合此前“在发起审批前”，本次执行范围为从未提交审批、未确认且没有正式资金事实的草稿。
- 独立工作区基线 `835ce1d7c6215626677bce19609aa38b111c3aa8`，以下结果对应基线加本地未提交差异，不是新 Git SHA 或线上版本。
- 原根目录及其既有修改未动。没有 commit、push、PR、生产迁移、部署或真实业务数据变更。
- 既有角色、项目范围、审批和付款规则保留。新增删除行为按此次明确授权实现，后端事务检查所有者、最新版本、审批历史与正式事实。

## 上传修复与根因

有效 PDF 的请求此前在文件处理前被全局参数校验拦截：上传接口使用单个 `@Body("idempotencyKey")` 字段，而校验要求对象。真实 Nest multipart HTTP 先复现400“提交内容必须是对象”，再验证完整 DTO 接收后的成功；没有放宽全局校验或文件限制。

- 历史合同接管资料、财务付款凭证：按钮附近显示明确中文原因，失败保留原文件，提供重试；只在成功后清空。
- 历史经营接管原始文件及多文件附件、结算明细附件：同样就近反馈和保留选择；多文件部分失败时复用已上传文件。
- 每次选择保留上传幂等键；关联失败复用文件 ID；关联响应丢失通过回读或服务端同组附件去重恢复。上传中避免重复点击，切换项目/批次/合同使旧操作失效。
- 原18个同根因接口全部改为完整 DTO，并验证合法/非法请求及原权限拒绝。税务修订面板复用的历史合同上传接口也受益，但没有声称其长面板提示位置已做独立浏览器验收。

### 另外18个已修复接口

| 控制器 | 方法 | 路由 |
| --- | --- | --- |
| `services/api/src/operating-takeover/operating-takeover.controller.ts` | `uploadSourceFile` | `/projects/:projectId/operating-takeovers/files` |
| `services/api/src/payable-registry/payable-registry.controller.ts` | `uploadInterEntityRelationshipEvidence` | `/payable-settlements/inter-entity-relationships/:relationshipEntryId/evidence` |
| `services/api/src/payment/payment.controller.ts` | `uploadExecutionVoucherPrivateFile` | `/payments/:paymentId/execution-voucher-file-uploads` |
| `services/api/src/payment/payment.controller.ts` | `uploadPdfArchivePrivateFile` | `/payments/:paymentId/pdf-archive-file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadAffiliateCompanyContractPrivateFile` | `/projects/:projectId/affiliate-company-contracts/file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadUpstreamFundPrivateFile` | `/projects/:projectId/upstream-fund-facts/file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadAffiliateContractPrivateFile` | `/projects/:projectId/affiliate-contract-facts/file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadAffiliateSettlementPrivateFile` | `/projects/:projectId/affiliate-settlement-facts/file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadAffiliatePaymentPrivateFile` | `/projects/:projectId/affiliate-payment-facts/file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadAffiliateBusinessEvidencePrivateFile` | `/projects/:projectId/affiliate-business-facts/:factId/evidence-file-uploads` |
| `services/api/src/project/project.controller.ts` | `uploadProjectFinancingQuotaPrivateFile` | `/projects/:projectId/financing-quotas/file-uploads` |
| `services/api/src/project-expense/project-expense.controller.ts` | `uploadCreatePrivateFile` | `/projects/:projectId/expense-requests/file-uploads` |
| `services/api/src/project-expense/project-expense.controller.ts` | `uploadExecutionVoucherPrivateFile` | `/projects/:projectId/expense-requests/:expenseRequestId/execution-voucher-file-uploads` |
| `services/api/src/settlement/settlement-draft.controller.ts` | `uploadPrivateFile` | `/projects/:projectId/settlement-drafts/files` |
| `services/api/src/settlement/settlement.controller.ts` | `uploadRecoveryFile` | `/settlements/:settlementId/recovery-file-uploads` |
| `services/api/src/settlement/settlement.controller.ts` | `uploadArchivePrivateFile` | `/settlements/:settlementId/archive-file-uploads` |
| `services/api/src/spot-procurement/spot-procurement-payment.controller.ts` | `uploadDraftFile` | `/spot-procurement-payments/:paymentId/draft-file-uploads` |
| `services/api/src/spot-procurement/spot-procurement-receipt.controller.ts` | `uploadInvoiceFile` | `/spot-procurements/:procurementId/invoice-file-uploads` |

## 草稿删除覆盖

| 页面/业务 | 本地处理 | 保护条件 |
| --- | --- | --- |
| 费用报销、备用金/借款、零星费用 | 新增删除入口，实际删除申请、明细及附件关联 | 原经办权限；从未提交；没有审批快照、支付执行或借款冲抵事实 |
| 综合采购 | 新增删除入口，实际删除草稿 | 本人申请、最新版本、无提交记录及下游请款；旧创建请求不能复活已删草稿 |
| 结算草稿 | 原“删除草稿”改为实际删除明细、附件关联、草稿生成文档及未正式化流程 | 从未提交且无正式结算；上传过草稿文件不再被误判为审批历史 |
| 零星采购申请 | 原删除动作实际删除草稿聚合 | 原经办权限、所有版本从未提交，无收货复核及正式资金事实 |
| 零采付款草稿 | 实际删除付款草稿及明细/附件/渠道 | 原服务先释放预占；已有支付、执行或审批事实拒绝删除 |
| 历史合同接管 | 实际删除未提交接管聚合及其生成的历史合同草稿 | 无确认、激活、更正、正式结算/付款；合同编号墓碑保留 |
| 税务事实修订 | 原删除动作实际删除未提交修订草稿 | 本人创建、未提交财务复核、未确认；不改合同当前税务事实 |
| 历史经营接管批次 | 新增删除批次草稿入口，删除行、问题与附件关联 | 本人创建、原项目管理权限、未确认/激活、没有生成正式事实 |
| 普通合同草稿 | 保留既有物理删除实现 | 既有聚合与正式事实校验 |

已经提交/退回/撤回且具有审批历史的记录继续按原放弃/撤销流程处理，不冒充从未提交草稿。付款申请创建即提交的流程、业务配置模板版本、正式经营事实不纳入任意删除。上述是员工申请与接管草稿的定向审查，不是全站所有版本化数据的删除承诺。

### 审计、文件和余额

- 业务草稿及其附件关联实际移除；删除者、业务编号、关键来源与删除动作记录在 AuditLog。已删除业务不会继续以“已放弃”状态占据业务列表。
- 私有文件对象不直接从存储删除；失去全部业务绑定后按原未绑定文件清理机制回收。本地测试确认删除附件关联后文件对象仍存在；是否回收继续由原文件绑定检查决定。没有执行生产文件清理。
- 零采余额流水不可改写。新增不可修改的采购/付款来源审计表，3个余额外键指向永久审计标识，使预占与释放流水可在草稿删除后保留。没有改写流水金额、账序、预占或余额；新流水仍要求来源业务存在，直接 DELETE 不能绕过预占释放保护。
- 新迁移 `20261019120000_unsubmitted_draft_deletion` 提供8个窄范围 SECURITY DEFINER 删除函数，撤回 PUBLIC 执行权；运行身份通过配套授权 SQL 获得指定函数执行权，没有新增业务表通用 DELETE 权限。
- 迁移目录共175个，清单校验通过。迁移及授权仅在本地验证；未来上线必须另获授权并按部署流程执行。

## 本人备用金和报销

基线已经支持所有启用员工（包括没有指定岗位的员工）为本人发起备用金/借款、报销和零星费用。本次没有改角色规则。真实 PostgreSQL16/HTTP 回归包含各岗位与无岗位本人申请、停用用户、项目归属、代办以及审批付款拒绝；项目选择和事实证明人等原要求保留。

## 最终本地验证

- 后端定向 Jest：21套、985项通过，包含18个上传入口真实 Nest multipart HTTP 的100项、接管上传、删除生命周期与原控制器回归。
- 前端定向 Vitest：49套、564项通过。
- 一次性 PostgreSQL16 + HTTP：65项通过、1项原有跳过。新删除回归13项，覆盖实际行删除、附件关联、审计、来源墓碑、预占释放、直接删除拒绝、越权、旧版本、已提交审批、重复删除及旧窗口保存不能复活。其余为费用/采购入口与本人申请回归。
- Chromium 1280px与390px：合同接管/财务凭证12项，结算/经营接管上传及费用/采购/经营批次删除14项，共26项通过；接口模拟、实际 Vue/TDesign 页面，不是生产或物理手机验收。
- 原结算草稿生命周期并发脚本验证审批与结束动作互斥，已提交历史的原放弃分支保留。
- API/Web类型、E2E类型、API/Web lint、UI/中文业务语言、迁移清单及 diff whitespace 检查完成。Web lint 为0 error、797条 warning（基线798），未批量格式化其他页面。
- 测试修正中保留实际失败证据：旧测试把上传文件等同审批历史、Prisma整数参数需要显式转换、税务夹具种类不符合原约束、浏览器夹具缺少付款权限字段。业务断言修正均有对应真实场景，无跳过新失败测试。

证据位于 `/private/tmp/jgzg-takeover-upload-diagnosis-20261019/`：`api-final-tests.log`、`web-final-tests.log`、`hard-deletion-pg.log`、`settlement-concurrency-final.log`、`browser-final.log`、`expanded-browser-final.log`、`api-types-final.log`、`web-types-final.log`、`e2e-types-final.log`、`api-lint-final.log`、`web-lint-final.log`、`ui-final.log`。目录另保留初始上传失败、定向排查和浏览器失败材料。

本地通过不代表线上已修复。未运行完整发布门、GitHub CI 或真实账号/COS全链验收，未提交或部署。


## 第二轮代码审查与修复（2026-10-19）

用户授权重点复审彻底删除的误删、审计、权限与资金风险，发现问题直接本地修复验证。依据同一基线和未提交差异，按规范（Standards）与需求（Spec）两轴独立审查；主代理统一修复和回归。

### 已确认并修复

1. **状态异常下的正式子付款误删风险**：父历史接管仍为草稿、但子历史付款已激活时，原删除函数只检查父状态，会删除子付款。用满足数据库分配约束的合成数据，经真实服务复现“应拒绝却成功”；现显式拒绝任何已确认/激活的历史付款子记录。正常激活链父子同事务更新，本例是异常状态纵深保护，不声称正常流程必然发生此漂移。
2. **审计范围不足**：删除审计部分仅有编号/主ID，缺少明细和附件范围，且列表只显示“业务操作”。8类函数现记录适用的项目、删除前状态/版本、关键金额、明细/子对象引用及文件名称/大小/内容指纹；余额预占保留引用可追溯。结算明细附件、接管付款凭证及税务附件等一并纳入。文件摘要 helper 撤回 PUBLIC 执行权、不返回存储键或访问凭证；审计列表只呈现明确中文删除动作和业务编号，不透出私有元数据。
3. **删除后编号复用**：零采申请日编号、零采付款编号、税务修订号原先只看存活记录，删除末尾草稿后会复用永久审计中的编号。现仍在原编号锁/事务内合并存活及删除审计的最大序号；税务新增接管父记录→合同版本锁，避免并发分配与父删除冲突。付款正常新建和退回克隆共用编号逻辑；无需开放审计来源表权限。费用/综合采购原独立编号服务保持。
4. **经营接管真实状态遗漏**：真实 createBatch 返回 under_review，而旧测试夹具为 draft，导致新批次不能删除。现允许本人未确认、未激活且没有生成正式事实的 draft/under_review 批次；专业确认记录、原岗位及项目保护保持。新增真实创建→读取删除能力→删除回归，浏览器夹具同步真实状态。

### 撤回的推断与失败证据

初步推测“双份可编辑付款草稿并存，删除中间后新建撞号”被真实 PostgreSQL 的每采购单唯一可编辑付款草稿约束否定，明确撤回。修复针对已证实的删除后编号复用；没有放宽唯一草稿约束。最终PG专门验证第二份可编辑付款草稿仍被拒绝。

测试过程中税务DTO日期类型、历史付款必须有等额分配、经营定义校验mock方法、收货照片双文件列等夹具/实现问题已修正；编译或夹具失败不当作业务RED。有效业务RED分别保存在 review-audit-red.log、review-pg-red.log、review-guards-business-red.log、tax-number-review-red.log 及编号审查日志。

### 最终验证与复审结论

- 最终后端23套 **1040项通过**（review-final-unit.log）。
- 最终一次性 PostgreSQL16 / HTTP 3套 **71项通过、1项原有跳过**（review-final-pg.log），包括8类删除、原本人申请/权限、真实经营创建、历史激活子付款拒删、税务和采购编号不复用、原唯一草稿约束、受限身份、预占释放、失败时金额/流水/审计整笔回滚。
- 桌面1280与手机布局390浏览器 **14项通过**（review-browser.log）；本轮只将经营批次测试改为真实under_review，既有合同上传12项及前端564项未因本轮后端修复发生代码变化，没有重复计算成新增测试。
- API类型与lint、E2E类型、UI、迁移清单和diff检查通过；最终迁移checksum `da89594599092186030a80c63c21cdd329b7c7a313d305ebc78026362abc5559`。
- **Standards 最终复审：0项残留可确认问题。Spec 最终复审：已证实发现均已关闭，无新阻塞项。** 未发现公开业务路径可借本次变更放宽岗位或改写资金流水；没有穷举异常手工数据库漂移的所有无FK引用组合，不作绝对安全保证。
- 仅本地修改；未commit/push/PR，未部署、未生产迁移，临时测试容器已由脚本清理。


## PR 交付与完整 CI（2026-10-19）

用户随后授权提交、创建 PR、完整 CI 通过后合并，仍禁止部署生产。原本地修复提交 `79a8807c`，整合主线 `5c8b66a7` 为 `551f48a2`；两轴增量审查均无已确认问题。主线新增的两项经营账迁移一并纳入，当前共177项，原草稿删除迁移内容未改变。

交付检查补齐新增删除页面能力/路由登记；对结算上传与关联分别明确原能力校验，每次关联重试重新验证。新增永久审计来源表列入旧业务清理保护范围，未扩大可删除表。两份草稿删除PG回归纳入原POL115 runner；动态清单按实际测试登记403项。新增浏览器CI步骤运行接管原32项与上传/删除14项，保留全部断言和零重试。

整合后临时PG16/HTTP71项通过（1项既有跳过），清单/审计保护120项通过，Web及E2E类型通过。浏览器扩展首轮45/46通过，原未保存离开测试遇桌面与手机两处同文“首页”定位歧义，限定可见按钮后复验；失败原件保留。原本机编排门另外遇到既有中文路径被URL编码的问题；不把该次部分结果当成CI通过，最终固定SHA远端全部检查及合并证据以PR记录为准。

本次只交付代码；生产部署、数据库迁移和真实业务验收均未执行。未来上线仍需准确版本发布门禁、备份与迁移验证；业务草稿删除后保留审计与资金流水，已解绑私有文件按原回收规则处理，不代表立即擦除存储对象。

# POL-19B / #114 填写入口矩阵

状态：Owner 已批准本矩阵及下述模板版本有限适配契约；完整矩阵已[登记至 #114](https://github.com/1131096740/intelligent-construction-management/issues/114#issuecomment-5707372032)，进入公开 HTTP 首切片 RED→GREEN，不表示整票实现或验收通过。

基线：`b7b1a69a7ebb435e9b247642f951c33324a70eff`。范围由 #114、已交付 #255、经营正式规格第 20 节及 2026-09-17 已批准轻量产品蓝图限定。只处理本票页面、对应领域胶水及按既有合同模板版本解析动态标量字段和清单自定义列定义的必要有限适配；不修改权限、金额规则、Schema、既有事务原子性、迁移或生产环境，不建设通用配置或富文本引擎。

## 共同约束

- 公开测试接缝为既有 Web 页面操作与领域 HTTP API。测试业务事实由这些接口产生；本机一次性 PostgreSQL 16 使用合成资料。
- 页面、移动表单、清单、粘贴和 Excel 复用各自适用字段定义；表格/Excel 不适用的单次办理动作不新增批量入口。
- 读取定义保留原读取/编辑入口权限，保存草稿保留原编辑权限，正式冻结保留原提交/办理权限；不能把正式冻结动作权限提前用于拒绝合法草稿编辑。
- 领域 DTO 中的密码、租约、幂等键、预期版本、服务端短效引用属于命令凭据，不进入用户业务快照；原 DTO 仍负责校验，客户端不能据此绕过权限或版本检查。
- 正式对象标识与项目归属由同一领域事务查询或创建的对象确定。禁止以项目 ID 代替正式单据、禁止页面先独立冻结再提交。
- 现有模板字段、清单计算、主体资料核验、现场复核、岗位节点、状态机、文件保密与金额规则均由原领域服务继续执行。场景定义和候选选项不构成授权。
- 所有写动作沿既有领域 API module、具名 import、具名 async handler、awaited wrapper；采用真实服务端能力来源，不根据本地角色/状态自行宣称可写。

## 用户填写入口与字段来源

下表的 DTO/领域类型是当前字段集合的精确来源；“命令凭据”按上节剔除。尚未实现的项目均保持待办，不能因列入矩阵就登记通过。不同正式对象分别登记场景，不把六个领域拼成一张任意行表。

| 场景组 | 用户入口与业务字段 | 正式对象与 ID 来源 | 既有动作、事务与快照时机 |
| --- | --- | --- | --- |
| 合同创建 | `CreateContractDraftDto`：项目、类型、模板/业务场景、签约主体类型、金额上限类型、初始付款条款 | `contract_version`；`ContractService.createDraft` 创建的版本 | `contract.create`；只形成草稿，统一正式快照在该版本提交事务冻结 |
| 合同基础信息（首切片 `contract_basic`） | 合同名称 `draftData.contractName`、我方签约主体 `companyEntityId` | `contract_version`；既有工作台 URL 的版本 ID | 定义/保存 `contract.create`，冻结 `contract.submit`；`ContractService.submitApproval` 原事务，在原权限/资料检查后、正式状态更新前冻结 |
| 合同模板字段 | 已选 `ContractBusinessTemplateVersion.fieldSchema` 经既有 `contractFieldsForBusinessUse` 后的受控字段及 `draftData` | `contract_version`；同上 | 保存 `contract.create`；提交 `contract.submit`；必须冻结该版本实际字段定义和原字段含义 |
| 合同主体 | `SaveContractDraftPartyDto` 中的角色、相对方与主体快照 | `contract_version` 关联的主体记录 | `contract.create`；原聚合保存验证；合同提交事务冻结 |
| 合同计价与税务 | `SaveContractDraftFieldsDto` 的计价性质、金额来源、手工/预计金额、调整原因；`SaveContractTaxFactsDto` 发票类型、税率模式、默认税率和来源 | `contract_version` | `contract.create` / `contract.submit`；保留原精确分值和税务事实冻结规则 |
| 合同清单 | `SaveContractBillRowDto` 的项目编码/名称、规格、单位、数量、单价、税率及来源、暂定标记、结算依据、模板自定义字段 | `contract_bill_row`；原聚合保存产生/保留的行 ID，经 bill → contractVersion → contract 证明项目 | 保存 `contract.create`；与合同提交一起冻结；手工、粘贴、官方 Excel 先形成同一草稿 |
| 合同条款与正文 | `SaveContractClauseDto` 的标题、编号方式、标准条款版本及条款正文块 | `contract_version` 的原条款快照 | 按正式规格 §20.8 保持合同正文及富文本/表格排版专用交互、原 `contract.create` / `contract.submit` 和既有不可变正式保存，不设计共享 richtext 字段 |
| 付款条款 | `CreatePaymentTermsStageDto`、原文：阶段、基准、比例/固定金额、触发、天数、预扣、发票、提前/分次支付、质保 | `payment_terms_stage`；原版本关联阶段 ID，经 paymentTermsVersion → contractVersion 证明项目 | `contract.create` / `contract.submit`；合同提交同事务冻结，原阶段金额规则保持 |
| 结算方式确认 | `ConfirmContractSettlementModeDto.settlementMode` | `contract_version` | 原 `contract.create` 入口及合同主管检查；`ContractWorkbenchService.confirmSettlementMode` 原事务 |
| 合同变更、清单承接与剩余取消 | `CreateContractChangeDraftDto`、`contract-bill-transition.dto.ts`、`CancelContractBillRemainderDto` 中既有业务原因、方向、金额与清单映射 | 原变更 `contract_version`、`contract_bill_row` / transition 记录 | 原 `contract.create` 与领域主管/占用校验；在原变更/承接/取消事务中绑定，禁止改额度或谱系语义 |
| 合同授权资料 | `SetContractAuthorizationDto`：授权方、是否需要、授权人、代理人、范围及原附件/复用来源 | `contract_authorization`；原授权记录 ID，经版本关联证明项目 | 原合同经办权限与修订；`ContractAuthorizationService` 事务 |
| 合同正式稿与签章声明 | `contract-formal-file.dto.ts`、`contract-seal.dto.ts` 的页序、签章、日期、仅许可修改等布尔声明 | `contract_formal_file` / `contract_seal_task`；原记录 ID | 原 formal-file / seal 服务权限和事务；文件二进制与签名画布为专用交互 |
| 结算草稿主单 | `SaveSettlementDraftDto`：合同版本、模板、编号、期间/截至日、终结算声明、累计金额及现场复核岗位/人员 | 提交前 `settlement_draft`；正式快照绑定 `settlement`，ID 由 `SettlementSubmissionService.submitDraft` 同 tx 创建 | 草稿 `settlement.create`；提交仍 `settlement.create` 和原 owner/修订/签章检查 |
| 结算明细 | `CreateSettlementLineDto`：来源、调整类型、关联清单/结算行、发生日、描述/计价依据、超量原因、名称/单位/数量/单价/金额/原因/备注 | `settlement_line`；正式结算事务创建的行 ID | 原 `settlement.create`；同 tx 冻结；原来源占用、预览计算与扣减规则保持 |
| 结算签章声明、行资料说明 | `SettlementCounterpartyDeclarationDto`、`SettlementLineAttachmentDto.purpose` | 原 signed-document / attachment 对象，沿 draft/settlement 权威归属 | 原工作台文件权限、修订和声明检查；文件仍为专用交互 |
| 付款申请 | `CreatePaymentRequestDto`：来源、付款主体类型、合同/结算/条款阶段、事项、计算说明、编号和申请金额 | `payment_request`；`PaymentRequestService.create` 的同 tx 新建对象 | `payment.create`；原三类来源创建事务内冻结；审批批准与实付分开 |
| 合同/结算/付款审批 | 各 `Review*ApprovalDto` 的决定、意见、自审原因与风险确认保持专用交互；付款批准金额等真正财务结构化字段另按原 DTO 绑定统一定义 | 原审批实例及 `approval_action_log`；沿 approvalInstance.businessType/businessId 找到正式单据及项目 | 分别保留原 `contract.approve`、`settlement.approve`、`payment.approve`、节点/身份/或签与密码确认；结构化财务字段在原事务冻结，不将审批动作/意见或敏感确认强塞共享引擎 |
| 单据转审/委托 | `Assign*ApprovalDto.toUserId`；属于原审批动作的专用交互 | `approval_action_log`；原转审/委托事件 | 各单据原 approve 动作及目标岗位检查；不引入新委托权或另造共享填写场景 |
| 撤回/催办 | 无新增业务字段，预期版本为命令凭据 | 原合同版本/结算/付款与 approval instance | 保留专用动作及原审计，不把按钮动作伪造为业务填写表 |
| 实付登记 | `RecordPaymentExecutionDto`：金额、付款日、付款凭证及适用付款主体/工资债权关联业务选择 | `payment_execution`；`PaymentRequestService.recordExecution` 创建对象 | `payment.execution`；原串行化事务、付款主体权威、核销和幂等检查内冻结；不得新增银行或工资业务语义 |
| 财务登记 | `RecordFinanceRecordDto.amountCents/occurredAt` | `finance_record`；原入账记录 ID | `payment.finance_record`；`PaymentRequestService.recordFinance` 原事务 |
| 合同/结算原件归档与确认 | 各 upload/confirm archive DTO 的文件关联；合同互签归档声明 | 原 `contract_archive_file` / `settlement_archive_file` / `contract_formal_file` | 各原 archive.upload / archive.confirm 动作；上传与确认仍分岗位；合同主管经办自确认例外保持原规则 |
| 付款 PDF 归档 | `RecordPaymentPdfArchiveDto` 文件、模板及部门；生成 DTO 的模板/部门 | 原付款 PDF 档案对象 | `payment.pdf_archive`；原创建/生成事务；生成、预览和下载保留专用交互 |
| 结算追偿与更正 | `RecordSettlementRecoveryDto` 的退款/抵扣类型、金额、日期、关联付款、证据、原因；冲销原因/证据 | `settlement_recovery_entry`；原追偿/反向记录 ID | 原恢复账领域权限、余额与不可变更正事务；不得重写付款/成本规则 |
| 结束草稿/申请、退回补正 | 各 abandon / return DTO 中原因及明确的原动作选择 | 原单据/正式事件；草稿删除不生成正式事实 | 原 owner/主管能力、预期修订和历史保护；不因统一输入改变可删除边界 |

## 专用交互和页面所有权

| 入口 | 本票处理 |
| --- | --- |
| 私有文件上传、手写签名、签章画布 | 保留专用交互；其用户填写的业务声明/资料说明在上表登记；密码和二进制不得存入字段快照 |
| 文档生成、预览、下载、差异比较 | 只读/派生专用能力；消费同一正式事实，不引入单独可写事实 |
| 合同正文/排版、审批动作/意见、敏感确认 | 正式规格 `docs/specs/2026-08-12-project-operating-ledger-construction-enterprise-takeover-unified-entry.md:741–747` 明确保留专用交互；正文保持原富文本/表格结构及既有不可变正式保存，审批中的批准金额等财务结构化字段与动作/意见分开处理 |
| 合同离线修订与磋商文档选择 | 保留文件/文档专用交互和原协作修订；结构化“选定哪份文档”经原聚合保存并由原提交快照引用 |
| 合同/结算模板治理、编号规则设置 | #113 页面所有权；本票只消费已发布版本，不迁移设置写入口 |
| 通用历史接管、施工企业事实、工资准备、对账 | #116 或其领域票页面所有权；本票仅按现有合同/付款关联消费 |
| 全局个人审批委托台账 | 现有页面只读，本票不恢复创建/撤销，也不臆造 #113 归属；证据：`apps/web-admin/src/pages/delegations/DelegationListPage.vue:10–14`、`apps/web-admin/src/pages/delegations/delegation-list-readonly-isolation.structure.test.ts:7–12`。本票仅保留上表单据内原转审/委托动作 |

## 首切片的三个权威证据

> 以下三条保留初始设计时态；当前实际进展见下方“本地切片验证”，不能把初始待实现文字或局部 PASS 当作整票完成。

1. 定义拟由原 `GET contract-drafts/:contractVersionId/workbench` 返回，当前未接入。该路由与保存路由继续使用 `contract.create`；提交路由继续使用 `contract.submit`。表单只用原服务端可编辑能力，冻结器的 submit 权限不用于表单读取。
2. 公司更换继续走 `ContractDraftAggregateService` → `ContractWorkbenchService.saveDraftInTransaction` 的 `lockAndLoadCompanyEntitySelection`，并在提交沿原 `lockCompanyEntityForSubmission` 复验；选择项不跳过领域检查。
3. #255 `PrismaBusinessEntrySnapshotStore.persistInTransaction` 的主键坐标为 project/scene/entityType/entityId/revision。同内容返回原不可变快照；变化必须传当前 snapshot revision，追加 current+1。拟在合同原锁、修订及租约检查后同事务冻结，不能把 draftRevision 当 snapshot revision；原提交幂等 receipt 先返回，同请求复用原结果，退回后新提交不覆盖旧快照。精确审批引用拟存入既有 `ContractDraftSubmissionRequest.responseSnapshot`，按唯一 `approvalInstanceId` 取得该次 snapshot revision，而非回显最新版；合法位置见 `services/api/prisma/schema.prisma:2052–2065`，原同事务 receipt 写入见 `services/api/src/contract/contract.service.ts:2144–2167`。该引用与冻结接线当前均未实现，不增加 Schema，也不改审批节点 JSON。

## Owner 已批准的模板版本有限适配契约

- 固定主单、清单标准列、审批中财务结构化字段及非敏感确认类业务声明均可从已有 DTO 映射；审批动作/意见不作为共享场景。
- Owner 已明确批准：在本 #114 候选内，按既有合同模板版本解析动态标量字段和清单自定义列定义。定义、校验与正式冻结必须绑定同一精确模板版本，由服务端权威解析；历史快照不随新模板改变。原版本已冻结 `fieldSchema` / `billSchema`（`services/api/src/contract/contract.service.ts:319–326`），必要有限适配可贯通既有定义注册和事务冻结入口。不得把所有模板版本标成同一固定定义版本，或伪造 JSON 长文本；不得改 Schema、权限、金额规则或既有事务原子性，不建设通用配置或富文本引擎。
- 合同正文/排版、审批动作/意见按正式规格 §20.8 保留专用交互；独立委托页面保持原只读，不新增 #113 归属。
- 审批精确引用使用既有 `ContractDraftSubmissionRequest.responseSnapshot` 与 `approvalInstanceId` 绑定该次 snapshot revision，不查最新版，不改 `ApprovalInstance.frozenNodes`；snapshot revision 与 draftRevision 分开处理。

最小首切片先实现 `contract_basic` 两字段的同事务冻结和原详情读取，不作为上述全清单通过证据。保留本候选；完整矩阵已按 #255 要求登记至 #114，开始 RED。最终收据须逐条附实际场景、文件、测试、旧入口退场状态及同一候选 SHA。

## 本地切片验证（2026-09-17，未冻结工作树）

- 恢复代码检查点 `d5829a9e`，旧测试 fixture/ownerless 岗位拒绝覆盖检查点 `6195793a`；非最终交付 SHA。
- 合同基础、精确模板标量及清单字段已接入原提交事务与回读；aggregate、legacy、legacy-ownerless 真实 HTTP + PG16 测试通过。旧 owner 为空的兼容仍要求 `contract.submit` 岗位及原领域检查；原重复提交规则不变。
- 结算方式确认：`contract_settlement_mode` 单选定义由原工作台 GET 返回，原 POST confirmation 在原全局合同主管、draft 与 expectedRevision 校验之后同事务冻结；snapshot revision 与 draftRevision 分离。原版本工作台按真实 version/project 回读历史。Web `ContractBasicSection` 使用该定义与原确认事件，硬编码选择器已替换；无新增用户动作、权限或 Schema。
- 本片 TDD：真实 HTTP 首次 RED 为缺少场景定义，Web 首次 RED 为未消费服务端中文字段。原 stale revision 返回 400，测试按既有行为校正，未修改状态码。一个旧成功确认单测缺少 snapshot DB fixture，补齐 DB 边界后保留真实授权/冻结服务。
- 当前验证：HTTP 三路径 3/3，workbench/aggregate/transaction registry/module 152/152，Web 3/3，workspace typecheck、lint（0 errors；原 531 warnings 中新增 6 个测试 stub 警告随后已消除，定向 lint 保留原文件 15 个警告）、Web check:ui 与 diff --check 通过。根目录无 check:ui 命令，随后按 Web package 脚本成功执行。无整票完整门、push、部署或生产操作。
- 待办仍包括矩阵内合同其他结构化入口、结算、付款结果、归档及历史展示/退场逐项证明；不得以本片通过宣称 #114 完成。

### 付款财务登记切片（局部接通，整票未完成）

- 保留原 `RecordFinanceRecordDto`、`payment.finance_record`、二次密码确认、金额上限和 `recordFinance` 锁内事务。`confirmationPassword` 不进入字段定义或快照。
- 原 `occurredAt` 是完整 ISO 日期时间，不能使用仅支持 YYYY-MM-DD 的统一 `date` 类型。最小适配以既有 `text` 字段记录完整 ISO 值，Web 消费同一字段中文元数据，保留原 TDesign 日期时间控件及 `toIsoDatetime` 时区转换；不扩展共享日期引擎、不截断秒。§20.8 的敏感确认仍为专用交互；日期时间控件只是同一元数据的有限展示适配，不豁免其结构化录入。
- `PaymentFinanceEntryForm` 组件 RED→GREEN 1/1，保留时间选择与秒值；付款详情返回 `payment_finance_record` 定义，原 `recordFinance` 同事务冻结真实 `finance_record` ID、金额及完整 ISO，原详情回读冻结历史。页面已接统一表单和只读历史，原 password/capability/金额及时间转换保持不变。历史仅向原财务动作岗位返回，不对非财务岗位新增字段值可见性。
- 本候选真实 HTTP 已走完受控合作单位、施工企业/参与公司、合同审批/签章归档生效、付款创建/审批、垫资额度两级审批。既有 core-flow/payment-execution 测试直接写入合同/收款/付款事实，未复用为本票公开 HTTP 证明，未制造 confirmed 数据。
- 直接付款延伸实付仍遇既有分摊约束冲突（23514）；该路径未到达财务断言。完整迁移和零写证据见 `docs/progress/2026-09-17-pol114-direct-payment-allocation-blocker.md`；该缺陷保留为整票交付阻塞，未改 Schema。
- 另行真实结算付款 HTTP 链经公开结算模板检查/预览/发布、上游结算录入/确认、下游草稿/冻结件/对方签署件/逐岗审批/归档、付款审批/额度/实付到达财务冻结及历史回读，两项分别取得 RED→GREEN。未手工 published/confirmed；预算前置采用预算员+合同经办复合岗位本人上传，不证明预算员单岗上传可用，保留整体角色 UAT 边界。
- 当前工作树定向：结算财务 HTTP 1/1、原合同 aggregate/legacy/legacy-ownerless HTTP 3/3、API 272/272、Web 25/25、workspace typecheck、触及文件 lint（0 warnings）、check:ui 通过；不是冻结 SHA 全门收据。重复入账仍按原余额规则拒绝且历史不增加，但原普通 Error 映射 HTTP 500，未改此既有错误状态；非财务写 403、历史为空。此片不消除直接付款阻塞，也不表示矩阵其他结算/付款结果/归档入口已完成。

# 重构依据、现有能力与差距

> 2026-11-05，本地只读核查记录；配套[规格](../specs/2026-11-05-enterprise-simplification-spec.md)与[技术方案](2026-11-05-enterprise-simplification-technical-plan.md)。初始记录未运行产品验收、查询生产或GitHub CI；本轮新增主线及生产只读进度见下文补充和集成交接。下述“存在”只证明代码/文件存在；“历史记录通过”只引用原收据范围，不升级为当前通过。

## 当前主线基线补充（优先于下述旧根快照）

本轮已只读核实主线 `2f474055bd018b3e454b458038d91080203ad5dc`，以该提交新建干净集成分支；主线197迁移与旧根146迁移共同124项且校验相同，旧根独有22项、主线独有73项。457份应用承接候选相对主线24项相同、263项不同、170项新文件；263项不同需按共同祖先逐域三方重放。旧根、旧548项审查快照均保留，未复制业务、模板或迁移到新集成。下述能力表仅为原根快照证据，不能代表主线现状或验收通过。具体指纹、来源与未证明项见[集成起步交接](../progress/2026-11-05-enterprise-simplification-integration-start.md)。

## 来源优先顺序

1. 本轮完整需求及用户最后修正，包括不再更正确认结算、统一正负登记、累计不低于0、主管单复核、全局并联、取消收货/工资/员工借款、合同审批后签章与直接归档等。
2. 用户指定对话：“梳理建工智管”（01a1740c-1a43-73a0-97be-4ddc5ad48063）、“建工智管：按六项优先级完成本地修复与验收”（01a188cc-55cc-76d0-b39d-b7c25cf4571e）、“核对近期开发与原型关系”。对话读取结果用于定位背景；不把列表notLoaded当作完成，不把助手建议或工具摘要独立当用户批准。
3. 当前控制面：`PROGRESS.md`、`AGENTS.md`、`CONTEXT-MAP.md`、`docs/README.md`；领域上下文：`services/api/CONTEXT.md`、`apps/web-admin/CONTEXT.md`、`packages/shared-domain/CONTEXT.md`；业务基线：`prd.md`及2026-08-12项目经营正式规格。
4. 本地源码、Schema/迁移、原型与详细收据。旧文档相冲突处由本轮已确认业务覆盖，旧证据保留原时点意义。技术建议仍以本次审阅为准。

## 核查基线与限度

- 当前本地HEAD：`a6a9b08a94c0ac9747b9741bb5563e8522ce435c`。混合工作区约510条状态项，含大量既有未提交/未跟踪变更；不能用HEAD代表工作区实际内容。实际实施前需固定全量候选和归属。
- 当前目录包含146份迁移SQL；PROGRESS另外记录资金隔离候选244迁移。两者不是可直接替换的连续线，必须核应用清单与校验值。此轮未连接任何数据库验证实际已应用状态。
- 没有检查当前远程CI、线上版本或生产数据；2026-08-05旧发布收据只作历史，不作为本候选的现状证明。
- 本次仅静态阅读，不复跑可能创建库/容器的旧runner。旧测试失败、退出、资源清理和授权边界按原记录保留，不能为了规格编写重新启动。

## 代码/Schema能力对照

| 领域 | 可复用证据（仓库相对路径） | 已有能力 | 本轮差距与动作 |
| --- | --- | --- | --- |
| 精度 | `services/api/prisma/schema.prisma`：ContractVersion、Settlement、PaymentExecution、ExpenseClaimLine；`packages/shared-domain` | 多处BigInt分、部分Decimal(24,6)数量/快照 | 建立4位非付款/2位支付协议、空值语义、历史无损转换及逐域兼容；不是只加输入框小数位 |
| 结算 | Schema Settlement/Draft/Line/SignedDocument/Template；`services/api/src/settlement` | 明细、生成文书、税务快照、回收/更正、审批/版本绑定 | 简化登记；全局唯一code改内部ID+重复提示；主管复核后只增不改；移除新建多节点/清单/模板/生成/冻结前置 |
| 合同正文 | `apps/web-admin/src/pages/contracts/workbench/ContractDocumentCanvas.vue`；`services/api/src/contract` | 模板生成、草稿聚合、条款及导出路径 | 现有画布不等于完整所见可编辑正文；验证结构化编辑和Word/PDF一致；关键字段同步保留手工条款；新归档接力 |
| 表格 | `apps/web-admin/src/components/JgBusinessGrid.vue` | RevoGrid包装、焦点/剪贴板基础 | 对齐原型左侧多选、批量/撤销/键盘/滚动及多页接入；不能宣称原型已全接生产 |
| 审批 | Schema ApprovalInstance/currentNodeIndex/frozenNodes、ApprovalActionLog；`services/api/src/approval` | 固定节点、日志、签名、自审、委托及业务适配基础 | 单index串联模型扩成职责并联；终态并发、旧轮失效、在途映射及部分PDF；不引入通用引擎 |
| 审批中心 | `apps/web-admin/src/pages/approval-center/ApprovalCenterPage.vue`、`apps/web-admin/src/components/ApprovalProgressPanel.vue` | 待办/发起/已办/委托/逾期及相关列表、可视进度 | 整理为四视图，逾期筛选/委托合并；全有权流程进度、指定催办及当前轮PDF入口 |
| 短信 | `services/api/src/approval/approval-progress.service.ts`、`approval-sms.service.ts`；`docs/runbooks/approval-progress-sms.md` | 当前串联节点催办、幂等、十分钟冷却、失败/未知处理；网关默认关闭 | 60秒共享职责冷却、并联全员/选人、自动及非审批待办、丰富摘要、outbox；真实送达未核验 |
| 付款 | Schema PaymentRequest/Execution/Allocation；`services/api/src/payment/payment-workbench-projection.ts`与容量/积压投影 | 审批、分次实付、退款、部分余额投影 | 按最终累计和全部未付占用重校；合同主管纳流程；财务/综合主管共办、负结算暂停恢复、来源与幂等完整链 |
| 零星/综合采购 | `services/api/src/spot-procurement`、`general-procurement`；Schema GeneralProcurement/Receipt | 需求、收货、实付/退款、成本痕迹 | 必填/估价放宽；公司日常不假项目；实际采购批次代替收货前置；原单报销防重复计成本 |
| 报销/借款 | Schema ExpenseClaim/Line及借款关联；`services/api/src/procurement-reimbursement` | 费用审批、明细、凭证、分次实付/退款及借款混合路径 | 全员、分类网格、无采购直接报销；退役员工借款但保护共用费用/还款字段中的其他真实往来 |
| 历史接管 | `services/api/src/contract-takeover`、Schema ContractTakeover/ContractFacts/FinanceFacts/BalanceAccount | 分部门补录、复核、激活、累计余额、文件/批量 | 去ABC；简易合同→财务录累计实付/收→主管复核，未知停原环节；历史期初不再扣资金 |
| 资金账 | Schema ProjectCompanyFundingLot（项目与公司必填）；`services/api/src/project-funding`、`services/api/src/funds-workbench`及付款执行业务 | 项目/公司资金、往来、执行和守恒约束基础 | 引入不属公司公共现金；资金容器/来源/归属分开；转款接力、交接、代付第三方还款；实库提交门禁仍阻断 |
| 经营 | `services/api/src/project/project-operating-overview.spec.ts`、成本/合同履约/主体分账投影 | 经营聚合和成本来源规则 | 新正负结算及历史基线；业主预付、施工企业已付与项目对外支付不混，内部转款不计收入/成本 |
| 台账/附件 | 合同、结算、付款、采购、报销各页面与archives；文件授权模块 | 列表、下载、水印、部分导出与档案 | 六独立页面、业务列+必要主体、筛选全量导出、格式精美；私有短时下载继续，取消附件密码/原因表单 |
| 账号/管理 | 用户/角色/项目/单位现有模块 | 手机登录、账号/岗位/项目基础 | 初始密码首次强改、新号验证、离职替换、唯一施工企业、限定单位维护人；技术admin不得充业务审批 |

## 原型追溯

原型根目录（本机证据，不是仓库可移植依赖）：`/Users/leoyang/.codex/visualizations/2026/10/25/01a1740c-1a43-73a0-97be-4ddc5ad48063/department-home-prototype/`。参考其README及以下决定；实施前将必要截图/交互说明按来源复制为仓库设计凭据，不能依赖开发者机器路径。

| 资料 | 采用的设计 | 不再采用的业务 |
| --- | --- | --- |
| GRID-INTERACTION-R20.md | 宽表、单元格录入、Tab/Enter/Esc、就近操作、就地校验 | 原型字段必填不自动约束新规格 |
| GRID-SELECTION-R21.md | 左多选、Shift、全选半选、批量复制删除和撤销 | 草稿行操作不能用于改已确认事实 |
| GRID-ROLLOUT-R22.md、GRID-WORKSPACES-R23.md | 同风格跨工作台和台账、手机预览 | 其中收货页及结算清单/模板在本次退出 |
| LINKED-CONTRACT-R28.md | 合同→结算→付款→总览连贯返回原单 | mock/localStorage不是后台接通；多节点结算、旧精度/可变结算不能直接照搬 |
| 用户本轮两张截图 | 绿色选中行、淡底表头/只读格、选中条/行操作、底部新增和右侧合计 | 不从图片示例数量/税率/金额推断硬必填 |
| 原型R19旧数量规则 | 仅作演变依据 | 两位数量已被本轮全平台最多四位替代 |

## 验收记录可证明什么

| 既有资料 | 可继承的知识 | 本次必须重验 |
| --- | --- | --- |
| `docs/progress/2026-10-27-business-subject-ledger-local.md`及PROGRESS的10月30日收据 | 六项本地固定包、主体口径、退款日期、模板字体/长清单、手机摘要的具体发现 | 新源码/Schema/并联改变后，受影响公开链全部重验；旧数千项不等新流程通过 |
| `docs/progress/2026-10-27-approval-progress-sms-local.md` | 原串联九类可视进度、模拟催办及失败分类 | 并联、60秒、非审批、自动发送和当前PDF；真实供应商仍另验 |
| `docs/progress/2026-10-30-attachment-access-scope-local.md` | 附件取消密码原因表单、作用域、安卓本地反馈范围 | 新页面/新角色/批量包/旧链接和当前轮权限 |
| PROGRESS资金提交安全段 | 5.22合成延迟提交异常、6.3有限对照、TLS和runner仍未闭合 | 真实业务HTTP/PG事务提交、断连/响应丢失、权限及清理；mock不代替 |
| `docs/runbooks/contract-workbench-release-a-b-cutover.md` | 既有切换和回退治理样式 | 新精度与并联/现金兼容边界，旧runbook不可直接执行 |
| `docs/runbooks/contract-settlement-v2-historical-backfill.md` | 历史回填的溯源、预检、幂等思路 | 新简化结算不继续旧生成/签章门槛；真实保留和截止点重设计 |

现有公开测试入口包括：API database下的approval-review-concurrency、payment-approval-concurrency-runner、contract-lifecycle-route、contract-takeover-activation-postgres、contract-takeover-confirmation-concurrency、settlement-contract-cap-concurrency、project-funding-availability-concurrency、spot-procurement-concurrency-runner；Web e2e下的approval-progress、contract-clause-save-lifecycle、contract-takeover-responsive、funds-workbench、ledger-responsive、flow-detail-responsive、responsive-layout-foundation、handwritten-signature-responsive。这是复用清单，非本轮运行结果。

## 移除边界

退出新入口、写路径与阻塞条件：工资、员工借款/放还款、两类采购收货登记、独立用印申请审批、系统结算模板/清单生成/多节点审批、历史ABC、付款阶段比例硬校验、垫资额度申请、小程序与wx-login。对应既有真实档案保持只读或迁移；共用文件、签名、费用、资金、项目垫资和公司间代付归还不得误删。最终收缩任务必须以调用者/数据清单证明，不靠菜单隐藏当完成。

本轮未触发任何GitHub写入、业务代码变更、数据库/迁移/部署或真实短信。用户随后已确认技术方案、任务粒度与验收边界；计划定稿，具体执行仍按对应实施任务范围推进。

## 本轮文档自检

新增50份文档（规格及3份配套方案、45张票据和任务索引），193条需求均有唯一主交付票，票据逐条验收文字与规格一致；38个重点验收情景；依赖图无环且所有实施票都被最终验收覆盖。本地Markdown链接、表格列数与diff空白检查通过。编写前后对2146份既有非文档文件做哈希比较，无变化；未运行产品测试。这些只证明文档组织完整，不能证明业务实现正确。

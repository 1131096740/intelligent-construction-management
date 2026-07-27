# 合同清单跨版本与结算工作台 V2 实施任务与验收门禁

| 项目 | 内容 |
| --- | --- |
| 计划编号 | `JGZG-CSWV2-PLAN-001` |
| 版本 | `1.0` |
| 规格 | [`JGZG-CSWV2-SPEC-001`](../specs/2026-07-27-contract-bill-lineage-settlement-workbench-v2.md) |
| 数据方案 | [`JGZG-CSWV2-DM-001`](../data-migrations/2026-07-27-contract-bill-lineage-settlement-v2.md) |
| 实施分支 | `codex/settlement-workbench-v2` |
| 当前阶段 | P1 |

## 1. 执行规则

1. 每个任务是独立、可验证、可提交的切片。
2. 每个任务先写会失败的聚焦测试，再做最小实现。
3. 每个任务更新 `PROGRESS.md` 和本进度表，并随代码一起提交。
4. 不把“Schema 已写”“页面可打开”或“静态检查通过”称为业务闭环。
5. 金额、数量、状态、权限、并发、归档、文件和审计变更必须有后台测试。
6. Web 变更先跑聚焦 Vitest，再跑 typecheck、lint、`check:ui`；关键交互补 Chromium/WebKit。
7. P1 未实现的 P2 场景必须返回稳定阻断，不能猜测或静默降级。
8. 推送、生产部署、生产 Schema 迁移、历史回填和业务数据修正分别等待授权。

## 2. 任务依赖

```text
T01 已完成的进行中结算门禁
  -> T02 合同结算模式
  -> T03 M1 数据模型基础
       -> T04 结算过程与期间
       -> T05 lineage 写路径
            -> T06 版本生效与 carry-forward
                 -> T07 跨版本来源与提交校验
                 -> T08 合同新版清单导入
       -> T09 结构化结算草稿行与权威计算
            -> T10 结算全宽工作台
            -> T11 保存、导入和本地恢复
       -> T12 最终结算
       -> T13 PDF 核对与冻结
  -> T14 历史只读预检和回填工具
  -> T15 P1 集成候选
  -> T16-T19 P2
```

T04、T05 和 T09 在 T03 完成后可以按文件边界并行设计，但合入时仍按编号验证集成。

## 3. P1 任务

### T01 同一合同只能有一份进行中结算

状态：`[x] 已完成`

已完成内容：

- `packages/shared-domain/src/statuses.ts` 新增进行中结算状态集合；
- `SettlementDraftService.create/copyAbandoned` 在合同行锁内检查草稿和正式结算；
- 已生效但未付清结算不阻断下一期；
- 聚焦 Shared/API 测试、typecheck、lint 和业务错误检查通过。

后续关系：T04 将在此服务门禁下增加 `ContractSettlementProcess` 部分唯一索引作为数据库并发兜底，不删除现有中文业务提示。

### T02 冻结合同结算模式并接通付款来源

状态：`[x]`（2026-07-27；仅本地前向实现与验证，未执行生产迁移或历史回填）

目标：

- 合同版本明确保存 `settlement_required/direct_payment`；
- 合同部主任确认，变更版本继承；
- 现有 `contract_due` 只对 `direct_payment` 普通到期款开放；
- `settlement_required` 普通进度/到期款必须引用有效结算。

主要文件：

- `services/api/prisma/schema.prisma`
- 新迁移 `services/api/prisma/migrations/*_contract_settlement_mode/`
- `packages/shared-domain/src/`
- `services/api/src/contract/dto/create-contract.dto.ts`
- `services/api/src/contract/contract.service.ts`
- `services/api/src/contract/contract-read.service.ts`
- `services/api/src/settlement/settlement-draft.service.ts`
- `services/api/src/payment/payment-request.service.ts`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- `apps/web-admin/src/pages/contracts/workbench/ContractBasicSection.vue`
- 对应合同工作台 API 类型

聚焦测试：

- 新合同建议但未确认时不能提交；
- 合同变更继承模式，生效后不能原地修改；
- `direct_payment` 可走 `contract_due`；
- `settlement_required` 拒绝普通 `contract_due`，但不误伤合法预付款；
- 模式为空的历史合同得到明确补确认错误。

完成标准：

- 新写入模式、确认人、确认时间和来源完整；
- 付款和结算两侧都在后台校验；
- Web 展示系统建议与合同部主任确认，不用合同类型暗中替代。

### T03 建立 M1 数据模型基础

状态：`[x]`（2026-07-27；仅本地前向结构，未执行生产迁移、历史回填或业务数据改写）

目标：按 `JGZG-CSWV2-DM-001` 建立纯新增 Schema，不执行历史业务回填。

已完成：

- 新增 lineage、transition、carry-forward、settlement process、结构化草稿行和行附件模型，以及与既有合同、清单、结算、导入、文件表的兼容可空字段和索引；
- `ContractSettlementProcess` 以合同内期次唯一和 `open` 部分唯一索引提供数据库并发兜底；所有新外键均为 `RESTRICT`，稳定结构约束均为 `NOT VALID`；
- 行附件已进入统一私有文件绑定目录；旧 `SettlementDraft.lines` 和既有 `SettlementLine` 保持不变；
- Prisma validate/generate、数据库 schema 聚焦 Jest 13/13、API typecheck/lint 与 `git diff --check` 通过；一次性本地 PostgreSQL 16 空库顺序完成 88 条迁移，实际验证同一合同第二个 `open` 结算过程被部分唯一索引拒绝。该容器已删除；未连接生产或任何业务数据库，未做历史回填或业务数据改写。

主要结构：

- `ContractBillRowLineage`
- `ContractBillRowTransition`
- `ContractBillRowCarryForward`
- `ContractSettlementProcess`
- `SettlementDraftLine`
- `SettlementLineAttachment`
- 现有合同、清单、结算、导入和文件表的兼容字段与索引。

主要文件：

- `services/api/prisma/schema.prisma`
- 新迁移 `services/api/prisma/migrations/*_contract_bill_lineage_settlement_v2_foundation/`
- Schema 契约/数据库并发测试

聚焦验证：

- `prisma format/generate/validate`；
- 空库从零迁移；
- 当前迁移链升级；
- 部分唯一索引并发测试；
- 检查约束和 `RESTRICT` 外键；
- `git diff --check`。

完成标准：

- 迁移只新增，不改写任何业务行；
- 旧应用读路径仍可运行；
- `NOT VALID` 和后续验证步骤清楚分离；
- 新文件引用同步进入统一文件绑定清单。

### T04 结算过程唯一性与结构化期间

状态：`[x]`（2026-07-27；后端前向接入，工作台旧输入兼容保留）

依赖：T03。

目标：

- 创建草稿时创建 `ContractSettlementProcess`；
- 同合同只允许一条 `open`；
- 第一期开始日取合同生效日，后续取上一有效期结束日次日；
- 退回、驳回、撤回仍保持同一过程；
- 显式作废和新版本失效正确结束过程。

已完成：

- 新草稿在合同行锁和既有 T01 门禁内创建 `ContractSettlementProcess`，再双向绑定草稿；数据库部分唯一索引继续作为并发最终裁决；
- 草稿提交时将同一 `processId`、结构化期间冻结到正式结算，再把过程关联到正式结算；审批退回或撤回不另建过程，放弃草稿会将该 open 过程标记 `voided`；
- `periodEnd` 作为兼容可选输入：提供时第一期从合同生效日开始，后续从上一有效结算结束日次日开始；旧工作台尚未提供日期时保持空值和既有 `periodLabel`，不猜测历史期间；
- 过程服务与草稿/提交服务聚焦 Jest 36/36、API typecheck/lint 和 `git diff --check` 通过。

主要文件：

- 新增 `services/api/src/settlement/contract-settlement-process.service.ts`
- `settlement-draft.service.ts`
- `settlement-submission.service.ts`
- `settlement.service.ts`
- DTO 与读模型
- `packages/shared-domain/src/statuses.ts`

聚焦测试：

- 两个并发创建只有一个过程成功；
- 上一期有效但未付款可创建下一期；
- 期间连续、无重叠；
- 退回后不能另建；
- 作废后可新建；
- 最终关闭后不可新建。

完成标准：服务检查和数据库部分唯一索引共同生效，错误返回现有结算编号和下一步。

### T05 lineage 一对一写路径

状态：`[x]`（2026-07-27；仅前向新写入，未对历史行回填或改写）

依赖：T03。

目标：所有 P1 清单写路径都维护 lineage 和一对一 transition。

已完成：

- 在线新增、整表新增和 Excel 追加为每个新物理行创建一个 lineage；修改与排序保留原 lineage；
- 合同复制、合同变更克隆和保存点恢复仅在源行已有 lineage 且单位一致时继承并写确认的一对一 transition；旧历史源行或单位变化均只为目标新建 lineage，不猜测映射；
- 普通删除和整表/Excel 删除在正式结算行占用时失败关闭；新增“取消未实施余量”动作，要求占用事实和原因，并冻结操作者和时间；
- 相关 API Jest 273/273、typecheck、lint 和 `git diff --check` 通过。

主要文件：

- 新增 `services/api/src/contract-bill/contract-bill-lineage.service.ts`
- `services/api/src/contract/contract.service.ts`
- `services/api/src/contract-bill/contract-bill.service.ts`
- `services/api/src/contract-bill/contract-bill-excel.service.ts`
- `services/api/src/contract-bill/contract-bill-row-rules.ts`

必须覆盖：

1. 原始合同首次保存；
2. 在线新增；
3. 在线修改；
4. 合同变更克隆；
5. 整表保存保留既有行；
6. 普通删除；
7. 取消未实施余量。

聚焦测试：

- 新行只创建一个 lineage；
- 变更克隆继承 lineage 且 transition 唯一；
- 重试幂等；
- 有历史占用行不能普通删除；
- 单位变化不自动按一对一确认；
- `rowKey` 仍只在单清单内唯一。

完成标准：不存在绕过 lineage 的新 V2 清单写路径；历史行不被修改。

### T06 合同版本生效门禁与 carry-forward

状态：`[x]`

依赖：T04、T05。

目标：把合同新版生效前置逻辑收敛为一个共享服务，并由两条现有归档入口调用。

主要文件：

- 新增 `services/api/src/contract/contract-version-activation.service.ts`
- `services/api/src/contract/contract.service.ts`
- `services/api/src/contract/contract-seal.service.ts`
- lineage/carry-forward 服务

事务内顺序：

1. 锁合同、来源版本和目标版本；
2. 检查旧版进行中结算；
3. 使未提交普通草稿失效，或阻断已提交过程；
4. 检查 transition 完整和守恒；
5. 生成 carry-forward 与快照摘要；
6. 再替代旧版本并使新版本生效。

聚焦测试：

- 旧版普通草稿被保留并失效；
- 旧版已提交结算阻断；
- 映射未确认阻断；
- carry-forward 不守恒阻断；
- 旧归档入口和当前正式文件入口行为一致；
- 并发确认只生效一次。

完成标准：任何合同版本生效路径都不能绕过结算和 lineage 门禁。

实施结果（2026-07-27）：已新增 `ContractVersionActivationService`，由旧归档确认与双方最终版归档确认共同调用。服务在合同锁与来源版本锁内：只将旧版未提交普通结算草稿及其过程标记为 `invalidated`，对已提交、签章、审批或归档中的过程返回稳定码 `CONTRACT_VERSION_BLOCKED_BY_ACTIVE_SETTLEMENT`；对历史占用行要求已确认的一对一来源映射并校验数量/金额守恒，生成不可原地改写的 `ContractBillRowCarryForward` 和 SHA-256 来源摘要。版本替代、付款条款替代和新版本生效仅在上述检查后发生。聚焦 API Jest 155/155、API typecheck、lint 与 `git diff --check` 通过；未连接生产、未执行生产迁移或历史回填。

### T07 跨版本来源、占用与提交时重算

状态：`[x]`（2026-07-27；仅本地前向实现与验证，未执行生产迁移、历史回填或业务数据改写）

依赖：T06。

目标：结算工作台和提交服务按合同全生命周期计算占用。

主要文件：

- `services/api/src/settlement/settlement-workbench.service.ts`
- `settlement-line-occupancy.ts`
- `settlement-line-calculator.ts`
- `settlement.service.ts`
- `settlement-submission.service.ts`
- `contract-settlement-capacity.ts`

聚焦测试：

- v1=100、结30、v2=120，剩余90；
- 历史付款状态不释放结算占用；
- 草稿、作废和失效不占用；
- v2=20 显示超结10并禁止正向结算；
- 来源快照变化时保存可重算、提交必须冲突；
- 无 lineage/映射时返回稳定阻断码；
- 历史高精度只读，新输入两位。

完成标准：前端不再接收只限当前 `contractVersionId` 的虚假可用量；提交事务以后台新快照裁决。

实施结果（2026-07-27）：工作台和提交前限额校验统一使用“合同版本生效时冻结的 carry-forward + 当前版本有效结算”读取；v1 已结 30、v2 数量 120 时剩余 90，调减到 20 时显示超结 10 并由 `over_settled_quantity` 阻断正向结算。V2 草稿保存时写入来源快照，提交事务在草稿修订认领和正式结算写入前重新计算，不一致返回 `SETTLEMENT_SOURCE_OCCUPANCY_CHANGED`。读接口返回 `calculationVersion=2` 和全量来源快照（空清单为 `null`）；已覆盖付款状态不释放、草稿/作废不占用、无承接快照稳定阻断及历史高精度只读与新输入两位小数。关键占用/工作台/草稿/提交 API Jest 50/50、结算服务 API Jest 157/157、Web 状态 Vitest 15/15、Shared/API/Web typecheck、API lint 与 `git diff --check` 通过；未连接生产。

### T08 合同“导入新版清单”与原子对照

状态：`[~]`

依赖：T05、T06。

目标：将现有技术导入模式收敛为版本对照工作流。

主要文件：

- `contract-bill-excel.service.ts`
- `contract-bill.service.ts`
- `contract-bill-excel.controller.ts`
- `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue`
- `contract-bill-grid.ts`
- `apps/web-admin/src/api/contract-workbench.api.ts`

聚焦测试：

- 五类差异结果；
- 清晰一对一自动建议；
- 模糊匹配必须人工确认；
- 任一错误整表不应用；
- 文件 SHA、来源版本或修订变化整体失败；
- 历史占用行删除被识别；
- 清单型合同变更金额后台计算。

完成标准：普通用户不再选择 `replace/update/append`；“预检成功”与“正式应用成功”有独立证据。

实施进展（2026-07-27，三段）：服务端新增内部 `version_replace` 模式。原 `__rowKey` 且单位一致的 Excel 行原位更新，从而保留物理行与 lineage；空行标识新增，未列出的既有行继续纳入删除及正式结算占用校验。预检返回逐行 `unchanged/added/removed/one_to_one/manual_review`，并保留来源行和导入行，清晰暴露自动一对一建议。单位变化一律标为 `manual_review`、写入 `pending` 映射状态并返回“需人工复核”预检错误，应用操作整批失败关闭，避免部分落库。普通成功预检不再写入不符合约束的 `legacy_replace` 映射状态。业务页面固定使用“导入新版清单”，只在无错误预检后允许确认原子应用并刷新权威工作台，不再暴露技术模式或将本地候选载入误当作正式应用。差异/Excel API Jest 56/56、清单编辑器 Web Vitest 21/21、API/Web typecheck、lint 与 `git diff --check` 通过。人工确认尚未实施，故本任务未完成。

### T09 结构化草稿行、三类来源与后台权威计算

状态：`[~]`

依赖：T03、T07。

目标：

- `SettlementDraftLine` 成为 V2 草稿权威事实；
- 支持合同清单项、签证/变更项目、金额调整项；
- 新数量/单价最多两位，每行金额四舍五入到分。

主要文件：

- `dto/settlement-draft.dto.ts`
- `dto/create-settlement.dto.ts`
- `settlement-draft.service.ts`
- `settlement-line-calculator.ts`
- `settlement.service.ts`
- `settlement-submission.service.ts`
- 新增结构化行服务和附件服务

聚焦测试：

- 三种判别联合输入；
- 签证项目的日期、说明和计价依据；
- 有上限合同硬限制；
- 调整项原因必填；
- 负向行缺来源阻断；
- 每行分币舍入后汇总；
- 保存、预览和提交的权威结果一致；
- 兼容 JSON 双写可回读。

完成标准：正式 `SettlementLine` 完整冻结草稿来源和合同版本快照；旧 JSON 不再参与 V2 提交裁决。

实施进展（2026-07-27，第六段）：草稿创建与更新已在同一事务中替换 `SettlementDraftLine`，兼容 JSON 仍双写；不完整但合法的草稿行以 `pending_source` 保存，避免把提交级校验提前误用于草稿。行表已写入来源、名称/单位、数量、单价或直接金额、原因、备注和顺序。冻结版结算单和提交事务都会按排序读取结构化行：前者以其生成/复核冻结业务事实，后者以其重算来源占用并生成正式结算。新保存草稿写入 `calculationVersion=3`；若没有结构化行，冻结和提交均会 fail-closed，不再回退 JSON。历史 V2 及更早草稿保留 JSON 兼容读取，避免前向上线锁死既有业务。签证/变更行现必须具备类别、发生日期、名称、说明、计价依据，并支持数量乘单价或直接金额；数量乘分币单价的结果逐行四舍五入到分。正式行会冻结来源类别、发生日期、说明、计价依据、关联原结算行和来源合同版本；负向调整缺少原结算行会阻断，且冻结/提交会验证该行存在、属于本合同、其结算已生效，跨合同或未生效来源均 fail-closed。聚焦 API Jest 47/47、API typecheck、lint 与 `git diff --check` 通过。附件及前端独立录入区仍未完成，故本任务未完成。

### T10 全宽结算 `JgBusinessGrid`

状态：`[~]`

依赖：T07、T09。

目标：保持现有结算“先选中、再填写”的交互，将明细区迁移到共享业务网格。

主要文件：

- `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- `settlement-workbench.state.ts`
- 新增 `components/SettlementBillGrid.vue`
- 新增签证/变更、调整项组件
- `apps/web-admin/src/components/JgBusinessGrid.vue` 仅在共享能力确实缺失时做最小扩展
- `settlement-workbench.api.ts`

验收：

- 默认未结清、切换全部、搜索、分组、仅看已选；
- 关键列冻结、选中后录入、本期后累计即时预估；
- 100 行以上无硬限制，可粘贴和键盘移动；
- 签证/变更和调整项独立区；
- 固定汇总、阻断原因和下一步；
- 桌面、窄屏和 200% 缩放不丢主动作；
- 不引入第二 UI 库。

完成标准：页面数据全部来自领域 API；结构测试、Vitest、Chromium/WebKit 关键流程通过。

实施进展（2026-07-27，首段）：工作台已增加独立“签证/变更项目”录入区，草稿保存、后台预览、提交及重新进入草稿均保留类别、日期、名称、说明、计价依据、数量/单价或直接金额；人工调整区补齐原结算行输入，前端在负向金额但未关联来源时预先提示。Web 状态 Vitest 15/15、typecheck、lint 通过。合同清单主区仍为 TDesign 表格，尚未迁移 `JgBusinessGrid`；未实现未结清/全部筛选、搜索分组、仅看已选及 Chromium/WebKit 验收，故任务未完成。

### T11 显式保存、修订冲突、结算 Excel 和本地恢复

状态：`[ ]`

依赖：T09、T10。

目标：

- 显式“保存草稿”；
- 不完整但合法可保存，非法首错定位；
- 结算 Excel 正确行部分载入；
- 浏览器恢复不冒充后台保存。

主要文件：

- `settlement-draft.service.ts`
- `settlement-import.service.ts`
- `settlement-import.controller.ts`
- `settlement-drafts.api.ts`
- `settlement-workbench.state.ts`
- 新增 settlement local recovery helper

聚焦测试：

- 100 行中 98 行正确、2 行错误；
- 错误未清提交阻断；
- 409/500 不清空用户输入；
- 修订冲突不覆盖；
- 保存中离开 fail-closed；
- clean/dirty/local-backed-up/failed 状态准确；
- 账号、设备、草稿和修订隔离；
- 保存、作废、退出和过期清理。

完成标准：保存反馈、离开保护和本地恢复与合同工作台口径一致。

### T12 最终结算新口径

状态：`[ ]`

依赖：T04、T07、T09。

目标：

- 删除 V2 页面手填累计金额和五项勾选；
- 后台生成准备情况；
- 总体声明一次；
- 最终生效后关闭入口，未实施余量忽略。

主要文件：

- 结算 DTO、草稿、提交、归档确认和读模型；
- `Contract.settlementClosedAt/finalSettlementId` 写路径；
- `SettlementWorkbenchPage.vue` 和详情页；
- 付款容量回归测试。

聚焦测试：

- 累计金额取有效历史+本期；
- 未实施余量不阻断；
- 未处理超结阻断；
- 最终负金额可生效；
- 最终生效与关闭入口原子；
- 旧五项字段仅只读兼容；
- 既有未付余额不丢失。

完成标准：任何新 V2 接口都不接受客户端手工累计总额作为权威事实。

### T13 PDF 核对、规范化和证据冻结

状态：`[ ]`

依赖：T09、T10。

目标：在现有签章文件、冻结事实和签名合成服务上补齐 V2 文件口径。

主要文件：

- `settlement-counterparty-document.service.ts`
- `settlement-document-facts.ts`
- `settlement-frozen-document.service.ts`
- `settlement-signed-document.service.ts`
- `SettlementCounterpartySignedPdfPanel.vue`
- `SettlementSignatureEvidencePanel.vue`

聚焦测试：

- 页数/方向/尺寸不一致可人工通过；
- 损坏、不可读或不可安全合成阻断；
- 原件和规范化派生件不同 `fileId/SHA`；
- 提交冻结页数、文件事实、声明、修订和参与人；
- 提交后替换只新增证据；
- 桌面同步/解除同步/重新对齐；
- 移动端同页切换和浏览器视图恢复；
- 不出现 OCR 或逐页强制勾选。

完成标准：合同部主任确认的是签名合成最终件，原始乙方文件始终可追溯。

### T14 历史只读预检与幂等回填工具

状态：`[ ]`

依赖：T02、T03、T05、T07、T09。

目标：完成工具和测试，不执行生产回填。

主要文件：

- `services/api/prisma/precheck-contract-settlement-v2.cjs`
- `services/api/prisma/backfill-contract-settlement-v2.cjs`
- `package.json`/API scripts
- 对应 fixture 与隔离数据库测试
- 运行说明和证据模板

预检输出：

- 模式确定/待确认；
- lineage 确定/待映射；
- 草稿可转换/不可转换；
- 期间可确定/待确认；
- 数量金额守恒；
- 同合同过程冲突；
- 孤立文件/行/结算引用。

安全要求：

- 预检默认只读；
- 回填必须显式批次 ID、目标数据库确认和允许写入参数；
- 幂等；
- 不做名称模糊自动匹配；
- 无歧义回填和人工确认分开；
- 输出不含密码、连接串或敏感正文。

完成标准：在隔离恢复库上可重复运行，第二次写入数为 0；尚不代表生产已回填。

### T15 P1 集成候选与发布门禁

状态：`[ ]`

依赖：T02-T14。

目标：形成一个后台账本和前台工作台同时闭环的候选 SHA。

必须通过：

1. Shared/API/Web 聚焦测试；
2. API/Web 全量测试；
3. typecheck、lint、`check:business-errors`、`check:ui`；
4. Prisma format/generate/validate；
5. 空库、升级库和并发数据库测试；
6. production build；
7. Chromium/WebKit 合同变更、结算填写、PDF 和最终结算流程；
8. P1 未支持的拆分/合并、追溯调价和资金回收明确阻断；
9. 历史只读预检报告；
10. `git diff --check`、提交和 `PROGRESS.md`。

候选完成后只报告 SHA、变更、迁移影响、备份/回滚方案和剩余风险。推送、部署、Schema 迁移、历史回填继续分别等待授权。

## 4. P2 任务

### T16 清单一对多、多对一与历史分配守恒

状态：`[ ]`

依赖：T15。

- 实现人工映射 UI、分配数量/金额和单位换算依据；
- 同来源出边和同目标入边守恒；
- 合同部主任确认后才能提交/生效；
- 变更后重算 carry-forward，不改历史结算。

验收：拆分、合并、重复提交、并发确认、单位变化、舍入差额和撤销未确认映射。

### T17 追溯调价、超结和负向结算

状态：`[ ]`

依赖：T16。

- 追溯调价生成独立价差行；
- 超结行关联负向冲减；
- 零/负结算来源、原因和金额边界；
- 负金额不创建付款申请；
- 最终负金额可生效。

验收：原历史单价/金额不变、价差可追溯、正负冲销累计正确、最终门禁正确。

### T18 财务退款/抵扣台账与凭证

状态：`[ ]`

依赖：T17。

- `SettlementRecoveryBalance/Entry`；
- 财务工作台登记退款、抵扣和反向更正；
- 凭证私有文件、权限、下载审计；
- 并发金额不得超余额；
- 合同人员只读。

验收：部分退款、多次抵扣、并发超额、反向更正、最终结算后未结余额持续可见。

### T19 框架超量、统一文件事实和移动端增强

状态：`[ ]`

依赖：T15；可与 T16-T18 独立排期。

- 无上限框架合同超量说明和审批醒目标示；
- 合同与结算统一“查看文件事实”；
- 移动端 PDF 核对增强；
- 页数/方向/尺寸差异保持非阻断；
- 不新增 OCR。

验收：有上限硬拦截、无上限带说明放行、文件事实权限和移动端恢复。

## 5. 每个任务的提交模板

每个任务完成时在进度记录中写明：

```text
- 任务编号与目标
- 根因/当前缺口
- 实际修改文件和不变范围
- RED 证据
- GREEN 与回归命令
- 数据/迁移影响
- 未完成和下一任务
- 未执行的生产、推送、部署或回填动作
```

建议提交信息：

```text
feat: freeze contract settlement mode
feat: add contract bill lineage foundation
feat: track contract settlement process
feat: calculate cross-version settlement capacity
feat: add settlement business grid
docs: record settlement workbench v2 evidence
```

## 6. 当前下一步

当前从 `T02` 开始。先完成合同结算模式的 Schema、后台门禁和合同工作台确认，再进入 `T03` 大模型基础；不要在结算页面先做一个无法被后台账本验证的视觉版本。

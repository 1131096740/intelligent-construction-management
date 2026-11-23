# Issue #416 HIS 验收核验回执（HIS-01～HIS-08、HIS-12）

- 日期：2026-11-23
- 核验分支：`line-aa-416-verify`（工作树 `/tmp/jgAA`）
- 基线：`adopt-395-396-415` tip `b95a17c087f5725a62e28ef0e28732f3101c6f9f`（`merge: #416 无等级历史合同分工接管`）
- 核验方式：只读代码/测试/既有回执；定向 API 单测、Web 单测；一次性 PostgreSQL 16 复跑 #416 真库 spec；另做一次只读编译探针核对 NONE/C 级经营来源投影。
- 环境：macOS arm64、Docker、一次性 `postgres:16`（image id `sha256:3950ad7c3148ca2175ef1b6c36c9efbf78957ae8fbe8b3a5d7c35af50500382f`，`server_version_num=160016`）；仅监听 `127.0.0.1`；未连接生产/备份/真实数据。
- 引擎变量：`PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine`、`PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine`

> 结论先行：**不能关单**。按原票验收，9 条中 `已实现` 1 条（HIS-06，仅单测）、`部分` 8 条、`缺失` 0 条。合并的 #416 实际只交付了“无等级默认 + 分工登记 + 继续办理门槛/待办”，其自身回执也明确写明完整 #34 的 HIS 录入/展示未重做（`docs/progress/2026-11-23-issue-416.md:96-103`）。此外发现一个落在 #416 自述收窄范围内的残留缺陷：无等级/C 级历史实付在经营账来源投影时仍被 A/B 硬门槛拒绝（见下）。

## 逐条核验表

| HIS | 验收要求摘要 | 结论 | 证据（文件:行） | 测试/回执 |
| --- | --- | --- | --- | --- |
| HIS-01 | 项目/名称/关系/甲乙方、原约定金额及税务、可选清单和结算付款文本、历史累计结算、已签合同附件；多 PDF/照片；框架无总价可空；不要求重录逐笔历史清单 | **部分** | 创建字段：`services/api/src/contract-takeover/dto/create-contract-takeover.dto.ts:197-279`（税务/清单/金额/付款文本/历史累计结算）；落库：`contract-takeover.service.ts:812-927`；框架 0 元：`contract-takeover.service.ts:5389-5397`；多文件上传：`contract-takeover.controller.ts:193-218`，资料挂接 `:580-589`；允许 PDF/PNG/JPG：`services/api/src/file/file.service.ts:234-243`；多份结算依据上限 50：`dto/save-contract-takeover-contract-facts.dto.ts:146`；每笔付款凭证上限 50：`dto/save-contract-takeover-finance-facts.dto.ts:90`；证据清单（合同扫描件必传、结算依据/付款凭证按金额必传）：`contract-takeover.service.ts:6226-6252` | 单测：`contract-takeover.service.spec.ts:2178`（框架 0 元）、`:2602`（无清单拒绝）；`contract-takeover-upload.http.spec.ts`（Nest HTTP + 模拟 FileService，非真实存储）；Web 208 项通过。**缺**：无“表内/表外/对上”关系字段（见 HIS-03）；`amountCents` 仍必填，0 元必须同时提供计价清单，不能真正留空 |
| HIS-02 | 取消历史合同 A/B/C 和等级调整说明；历史经营事实用已确认/待核对，不让经办人选 A/B/C；不能把原不确定资料自动升级为正式事实 | **部分** | 默认无等级：`contract-takeover.service.ts:6405-6413`；后端不再以 A/B 阻断：`contract-takeover-handover.ts:27-32`；但 Web 仍提供 A/B/C：`apps/web-admin/src/pages/contracts/contract-takeover.config.ts:316-321`，创建表单仍渲染等级选择和“等级调整说明”：`ContractTakeoverPage.vue:457-497`、`:806-808`；等级与建议不一致仍强制调整说明：`contract-takeover.service.ts:5439-5441`；NONE 才清空调整说明：`:5467-5470` | 单测：`contract-takeover.config.test.ts`（`takeoverLevelLabel("NONE")`）、`contract-takeover.service.spec.ts`、`contract-takeover-handover.spec.ts:46-56`。**缺**：未取消 A/B/C 选择与调整说明；历史事实无统一“已确认/待核对”状态模型 |
| HIS-03 | 合同部录入后推送财务及财务主管，任一有权人员可填/提，完成后其他待办结束；表内/表外填历史实际付款，对上填施工企业付我方的历史实际收款 | **部分** | 财务可填：`contract-takeover.controller.ts:494-503`，权限 `packages/shared-domain/src/permissions.ts:198-202`；财务事实保存：`contract-takeover.service.ts:1317-1624`；但待办只覆盖合同补录、凭证补传、主管复核：`services/api/src/me/me.service.ts:772-800`，无“财务填写历史实付”待办；接管进度只推合同主管：`services/api/src/approval/independent-approval-progress.sources.ts:260`；接管后财务待办是“登记后续付款”而非接管填写：`me.service.ts:1900-1908` | 单测：`me.service.spec.ts:2420-2520`、`contract-takeover.controller.spec.ts`。**缺**：没有提交后推送财务/财务主管的待办或通知；没有表内/表外/对上关系与“施工企业付我方”的历史收款字段（历史接管模块只有付款方向的 `payerName/payeeName`，见 `save-contract-takeover-finance-facts.dto.ts:49-90`） |
| HIS-04 | 合同部提交→财务填写→合同主管复核；财务看到项目/合同/关系/双方/金额或未约定/累计结算/附件摘要，约定可展开；主管再看财务金额，通过才入账 | **部分** | 合同部提交：`contract-takeover.service.ts:2880-2914`（路由 `contract-takeover.controller.ts:697-705`）；主管确认：`:2955-3039`（路由 `:707-717`）；财务/合同双部门确认：`:1125-1936`；但两侧确认无先后要求，任一侧最后确认即触发激活：`:5210-5247`；主管 `confirm` 不读取/不要求财务金额：`:2968-2986`；详情摘要：`ContractTakeoverPage.vue:3380-3415`（合同编号/名称/相对方/金额/税务/等级，无项目、我方主体、关系、约定展开）、证据清单 `:3323-3349` | 单测：`contract-takeover.service.spec.ts`、`contract-takeover.controller.spec.ts`；真库并发 spec 存在但本轮未复跑：`src/database/contract-takeover-confirmation-concurrency.spec.ts`。**缺**：未强制“财务先填、主管后审”；主管确认可在财务金额之前完成；财务视图缺口：项目/我方主体/关系/付款约定展开 |
| HIS-05 | 财务或主管均可填原因驳回制单人草稿，重提后财务重新核对再主管复核；职责接力，不套成所有人同一时间填同一数据 | **部分** | 主管退回补充（必填原因）：`contract-takeover.service.ts:2916-2952`（路由 `contract-takeover.controller.ts:719-728`）；部门确认撤回（原因+密码）：`:1938-2105`；权限：`permissions.ts:203-206`；重提：`:2880-2895`；合同资料变更仅在财务基线变化时使财务确认失效：`:1260-1274` | 单测：`contract-takeover.service.spec.ts`、`contract-takeover-handover.service.spec.ts`。**缺**：财务岗位无“驳回制单人草稿”入口（`contract.takeover.finance_facts.edit` 只能保存/确认）；重提后不强制财务重新核对（财务确认可保留）；合同侧与财务侧可同时编辑，未形成严格接力 |
| HIS-06 | 历史结算查不到保留合同部填写状态，无需额外操作；实付查不到保留财务状态；确实未发生才填 0 | **已实现（仅单测）** | 零结算必须声明+依据：`contract-takeover.service.ts:4993-5012`；零实付必须声明：`:4725-4733`；激活复核：`contract-takeover-activation.service.ts:125-129`（零实付与明细一致）、`:148-166`（零结算必须声明、结算依据必须存在）；未保存则保持未确认状态：`contract-takeover.service.ts:1760-1784`（未保存不能确认） | 单测：`contract-takeover-activation.service.spec.ts:106-163`；`contract-takeover.service.spec.ts:1047-1053`。**无真库/HTTP 证据**；另因旧 `submitReview/confirm` 不要求合同侧事实（见 HIS-04），主状态可先到 `confirmed`，实际只能停在“未激活” |
| HIS-07 | 已付 70/结算 60 可实录并显示超付 10；核实为约定预付款显示未结算预付款 10，性质不明待核对；对上超收保留事实，提示核对不自动退款 | **部分** | 超额分类（历史预付款/异常超付）+原因+独立依据：`contract-takeover.service.ts:1407-1443`；分配预览：`:4836-4886`；激活建余额账户：`contract-takeover-activation.service.ts:170-197`、`:293-314`；财务面板展示分类与余额：`components/ContractTakeoverFinanceSidePanel.vue:139-183`、`:244-249` | 单测：`payment/settlement-payment-capacity.spec.ts:339`、`:548`、`:621-665`（历史期初不重复扣历史已付）；`contract-takeover-activation.service.spec.ts`。**缺**：没有“对上超收/历史实际收款”事实与“提示核对、不自动退款”逻辑；无一处汇总行直接显示“超付 10”（仅逐笔分配行可见）；无真库/HTTP |
| HIS-08 | 主管通过的历史合同可在结算工作台搜索新增，历史结算 60+新 10=70；历史已付并入后续余额，不重新生成历史实付 | **部分** | 结算工作台合同选项（含历史接管合同、`canCreateSettlement`、来源标签）：`services/api/src/contract/contract-read.service.ts:1096-1228`，路由 `services/api/src/contract/contract.controller.ts:365-369`；累计=系统内+历史：`contract-read.service.ts:2131-2160`；历史已付并入总已付/余额：`:2135-2145`；付款容量复用历史余额：`services/api/src/payment/settlement-payment-capacity.ts:638-672` | 单测：`contract/contract-read.service.spec.ts:2505`（累计 300k = 系统 100k + 历史 200k）；`settlement-payment-capacity.spec.ts:621-665`；Web 合同选项 API 单测。**缺**：结算工作台合同下拉未开 `filterable`（`SettlementWorkbenchPage.vue:84-91`），无关键字搜索；无 HTTP/真库 60+10 端到端证据 |
| HIS-12 | 启用前历史合同实付/历史费用支付只参与历史事实和可付款核对，不再次扣启用时现金/公司资金期初；每条标清实际日期与期初涵盖范围 | **部分** | 接管激活不写资金账户，只建接管余额账户：`contract-takeover-activation.service.ts:199-221`、`:293-314`，全流程无 `FundAccount` 更新（`contract-takeover-activation.service.ts` 全文；`contract-takeover-balance.service.ts:54-100` 仅接管余额）；历史实付按 `paidAt` 标“经营账生效日前”：`contract-takeover-operating-source.adapter.ts:265-268`；仅项目启用经营账才投影：`operating-source-replay.service.ts:127-137` | 单测：`settlement-payment-capacity.spec.ts:621-665`（历史已付不二次扣）。**缺/阻断**：经营来源投影仍硬性要求 A/B——`contract-takeover-operating-source.adapter.ts:152-159` 对 `NONE/C` 抛“历史接管实付只有 A/B 级可以进入正式经营账”。本轮只读编译探针实测：`A` 通过；`NONE`、`C` 均被该错误拒绝（见下）。未找到历史费用支付（#35）的接管回执；无本轮真库/HTTP；接手回执也明确 HIS-12 未重做（`docs/progress/2026-11-23-issue-416.md:98`） |

## 仅单测项

- **HIS-06（已实现，仅单测）**：代码有零值声明/激活校验，但仅有 `contract-takeover-activation.service.spec.ts` 与 `contract-takeover.service.spec.ts` 单测；未在一次性 PG 上走完整“合同侧保存→财务侧保存→双部门确认→激活”HTTP 链。
- 其余 8 条“部分”项也没有本轮真库/HTTP 证据，均为单测/结构测试/模拟 HTTP（`contract-takeover-upload.http.spec.ts` 的 `FileService` 是 mock）。其中 HIS-04 虽存在真实 PG 并发 spec（`src/database/contract-takeover-confirmation-concurrency.spec.ts`），但本轮未复跑，其用例主题是“历史变更基线并发 409”，不是本表 HIS-04 的接力顺序。
- 唯一有本轮真实 PG 证据的是 **#416 自身的分工登记**（`src/database/issue416-takeover-handover.pg.spec.ts:24-243`），它不覆盖任何 HIS 的录入/展示/收款/期初。

## 缺失/部分项（缺什么、涉及文件、工作量）

1. **HIS-02：取消 A/B/C 与等级调整说明，建立“已确认/待核对”事实状态**
   - 缺什么：Web 仍让经办人选择 A/B/C 并填写等级调整说明；历史事实没有统一的已确认/待核对状态；后端仍要求“等级与建议不一致需说明”。
   - 涉及文件：`apps/web-admin/src/pages/contracts/contract-takeover.config.ts:316-321`、`ContractTakeoverPage.vue:457-497`、`:806-808`、`services/api/src/contract-takeover/contract-takeover.service.ts:5439-5441`、`:5467-5470`。
   - 工作量：**M**（移除选择+调整说明为 S；补已确认/待核对状态与迁移兼容为 M）。

2. **HIS-01/HIS-03/HIS-07：补“表内/表外/对上”关系与对上收款/超收**
   - 缺什么：历史接管创建没有 `relationship`（`inside/outside/upward`）字段；现有 `relationship` 只在合同草稿入口（`services/api/src/contract/dto/create-contract.dto.ts:146`、`ContractWorkbenchPage.vue:1818-1820`）。因此历史接管无法表达“对上合同、施工企业付我方”，也就没有历史实际收款、超收提示和不自动退款。
   - 涉及文件：`services/api/src/contract-takeover/dto/create-contract-takeover.dto.ts`、`contract-takeover.service.ts:772-927`、`contract-takeover-operating-source.adapter.ts`、`apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`、资金/经营账收款来源。
   - 工作量：**L**（Schema 兼容映射 + 收款事实 + 方向校验 + 页面 + 真库用例）。

3. **HIS-03/HIS-04/HIS-05：把“合同→财务→主管”做成强制接力**
   - 缺什么：提交后无财务填写待办/通知；主管 `confirm` 不要求财务金额；双部门确认无先后，财务最后确认即激活；财务无驳回制单人草稿入口；重提不强制财务重核。
   - 涉及文件：`services/api/src/me/me.service.ts:772-800`、`contract-takeover.service.ts:2880-3039`、`:5210-5247`、`:1260-1274`、`apps/web-admin/src/pages/contracts/components/ContractTakeoverDualConfirmationCard.vue`。
   - 工作量：**L**（状态机/待办/驳回/重核/权限 + HTTP+PG 用例）。

4. **HIS-07：超付/预付的汇总展示与对上超收提示**
   - 缺什么：无“已付 70 / 结算 60 / 超付 10”汇总行；异常超付只有余额卡，无“性质不明待核对”的统一提示；对上超收完全缺失。
   - 涉及文件：`apps/web-admin/src/pages/contracts/components/ContractTakeoverFinanceSidePanel.vue:139-183`、`services/api/src/contract-takeover/contract-takeover.service.ts:1407-1443`、`:4836-4886`。
   - 工作量：**M**（展示 S；对上超收与收款方向随第 2 项一起做则合为 L）。

5. **HIS-08：结算工作台关键字搜索 + 60+10 端到端证据**
   - 缺什么：合同下拉不可筛选（无 `filterable`/关键字搜索）；“历史 60+新 10=70”只有单测，没有 HTTP/真库链。
   - 涉及文件：`apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue:84-91`、`services/api/src/contract/contract-read.service.ts:1096-1228`、`services/api/src/settlement/settlement.service.ts:1519-1560`。
   - 工作量：**S/M**（搜索 S；HTTP+PG 用例 M）。

6. **HIS-12：移除经营来源 A/B 硬门槛并补真库验证**
   - 缺什么：`toOperatingFactInput` 仍对 NONE/C 抛错，无等级历史实付无法进入正式经营账；未找到历史费用支付（#35）的接管回执；“每条标清实际日期与期初涵盖范围”未在财务面板集中呈现。
   - 涉及文件：`services/api/src/contract-takeover/contract-takeover-operating-source.adapter.ts:152-159`、`contract-takeover-activation.service.ts:341-365`、`services/api/src/operating-ledger/operating-source-replay.service.ts:127-137`。
   - 工作量：**S**（删门槛并改为分工/确认校验）+ **M**（一次性 PG 跑 NONE 激活、经营账投影、不二次扣期初；历史费用侧需与 #35 协同）。

## 结论

**#416 不能按原票关单。** 已合入的 #416 是一个收窄实现：无等级默认、分工登记（真实 PG 已复跑通过）、继续办理门槛/待办；它没有重做 HIS-01/02/03/04/05/07/08/12 的录入、接力、方向、超收和期初展示。即使只看 #416 自述的“无等级/C 级可激活经营账”，在已启用经营账的项目上，`contract-takeover-operating-source.adapter.ts:152-159` 仍会把 NONE/C 级历史实付拒于正式经营账之外，属于收窄范围内的残留缺陷。

**最小补差范围（按原票关单）**

1. HIS-02：移除 A/B/C 选择与等级调整说明，补“已确认/待核对”；**M**。
2. HIS-01/03/07：补 `inside/outside/upward` 关系与对上历史收款/超收（含提示、不自动退款）；**L**。
3. HIS-03/04/05：提交→财务填写（推送/待办）→主管复核（看财务金额）强制接力；财务/主管可填原因驳回；重提强制财务重核；**L**。
4. HIS-07：增加超付/预付汇总展示；**M**。
5. HIS-08：结算工作台合同搜索 + 60+10 HTTP/PG 证据；**S/M**。
6. HIS-12：移除 NONE/C 的 A/B 经营来源门槛，一次性 PG 验证 NONE 激活与“不二次扣期初”；历史费用侧与 #35 协同；**S/M**。

如不补上述范围，建议把 #416 收窄为“无等级分工接管”并另拆 HIS-01/02/03/04/05/07/08/12 子票后再关单；不能以当前合并回执直接关闭原验收。

**是否需要真库补验：是。** 至少需要：(a) NONE/C 级历史实付激活 + 经营账投影（现有 #416 PG 用例未覆盖激活）；(b) 合同→财务→主管接力与两处驳回的 HTTP+PG；(c) 历史 60+新 10=70 与历史已付并入余额的 HTTP+PG；(d) 历史收款/超收事实。

## 本次运行证据

### 定向单测

```bash
cd /tmp/jgAA && pnpm --filter @jiangkong/shared-domain build
cd services/api && pnpm exec prisma generate
cd services/api && pnpm exec jest src/contract-takeover \
  src/contract/contract-read.service.spec.ts \
  src/payment/settlement-payment-capacity.spec.ts \
  src/me/me.service.spec.ts --runInBand
```

结果：`Test Suites: 15 passed, 15 total`；`Tests: 581 passed, 581 total`。

```bash
cd /tmp/jgAA/apps/web-admin && pnpm exec vitest run \
  src/pages/contracts/contract-takeover.config.test.ts \
  src/pages/contracts/contract-takeover.structure.test.ts \
  src/api/core-flow-read.api.test.ts
```

结果：`Test Files 3 passed`；`Tests 208 passed`。

### 真实 PostgreSQL 16（#416 分工登记）

```bash
cd /tmp/jgAA
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine \
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
node services/api/prisma/run-issue416-takeover-handover-local.cjs
```

结果：`Tests: 1 passed, 1 total`；回执：

```json
{"status":"PASSED","purpose":"ISSUE416_TAKEOVER_HANDOVER","candidateSha":"b95a17c087f5725a62e28ef0e28732f3101c6f9f","worktreeClean":true,"serverVersionNum":160016,"schemaMode":"PRISMA_DB_PUSH_FROM_SCHEMA_PRISMA","migrationLedgerReplayed":false,"publicTables":330,"containerRuntime":"docker_postgresql16_disposable"}
```

运行后 `docker ps -q` 实测为 **0 行**（无残留容器）。

### NONE/C 经营来源只读探针

用当前源码编译 `contract-takeover-operating-source.adapter.ts` 到 `/tmp/jgverify/out`，以与 `contract-takeover-operating-source.adapter.spec.ts:285-430` 同形的合成 `tx` 调用 `toOperatingFactInput`，仅改 `takeoverLevel`：

```text
{"level":"A","ok":true,"evidenceLevel":"A"}
{"level":"NONE","ok":false,"error":"历史接管实付只有 A/B 级可以进入正式经营账"}
{"level":"C","ok":false,"error":"历史接管实付只有 A/B 级可以进入正式经营账"}
```

该探针只读、未写工作树；它不是仓库正式测试，不替代真库用例，但足以证明 `contract-takeover-operating-source.adapter.ts:152-159` 的 NONE/C 阻断仍可达。

### 工作树

核验结束时 `git status --short` 为空；仅新增本回执文件。未 push、未改其它工作树/主仓库、未操作生产。

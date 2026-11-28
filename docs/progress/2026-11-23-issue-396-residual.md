# Issue #396 残余缺口回执：已签结算经营应付投影与统一实付受理

日期：2026-11-23
工作树：`/tmp/jgS`
分支：`line-s-396`
代码提交：`a22af30611661a041c7798002b1cd2f3c655ba34`（基线 `e3ac3374b`，集成分支 `adopt-395-396-415` 当前 tip）
范围：仅 #396 的 G1（统一实付接受 `signed_settlement`）与 G2（已签结算经营 payable 投影 / 实付分摊），加 CUT-03 只读核查脚本；**未退役旧 `/结算工作台/新建` 入口（属 #425）**，未 push，未改其它工作树或主仓库。

## 结论

- **G1 已补齐**：统一实付办理域 `currentRegisteredPaymentDomain` 接受 `sourceType=signed_settlement`；实付工作台可见该申请，实付按已签结算最近确认一期核销应付，不再要求旧 `Settlement`。
- **G2 已补齐**：主管确认下游已签结算时，在同一数据库事务投影 `signed_contract_settlement` 经营来源（`confirmed_cost` + `payable_increase`；负数同口径冲减）；实付经营事实只产生 `payable_decrease`，**不再重复生成成本**。
- **CUT-03**：新增只读核查脚本并在一次性 PostgreSQL 16 上跑通；脚本不执行任何删除/退役。
- **未新增迁移**：修正本票既有且未发布的 `20261119007000_signed_settlement_payment_basis`，补上遗漏的 `PaymentRequest` 来源约束（详见下）；迁移目录仍 323、终点仍 `20261119007500`，`07500`/`05800` 未改。

## 逐条验收对照

| 验收点 | 本轮交付 | 证据 |
| --- | --- | --- |
| SET-09 / A12 付款只选最近确认一期（含负数），按全累计而非负数本期定额 | 付款创建侧沿用既有 `loadSignedSettlementPaymentBasis`；本轮把同一依据接入统一实付域与实付工作台 | `services/api/src/payment/registered-payment-domain.ts`；`payment-request.service.spec.ts` 已签结算创建/非最近/超累计用例；真库用例 4 |
| A12 快照与当前差异、负数不作上限 | 付款创建冻结 `signedSettlement*` 快照；实付域按合同累计与占用重算 | `payment-request.service.ts`；`signed-settlement-payment-capacity.ts`；`payment-read.service.ts` 既有快照读取 |
| PAY-03 / A13 事务内金额、占用、防超付 | 实付事务内 `assertSignedSettlementPaymentExecutionCapacity` 重算合同累计（还原自身在途）并锁定合同容量 | 既有实现 + 本轮保留；单测覆盖“负结算后超付拒绝”“余额足够放行” |
| 实付生成对应分摊 | `PaymentExecutionOperatingSourceAdapter` 对 `signed_settlement` 付款生成 `payable:<signedSettlementId>` 的 `payable_decrease`；不生成 `confirmed_cost` | `payment-operating-source.adapter.ts`；新增单测 |
| 已签结算确认后投影为 operating payable | 新增 `signed_contract_settlement` 经营来源；确认复核的同一事务写入，来源键与幂等键固定 | `signed-settlement-operating-source.adapter.ts`；`signed-contract-settlement.service.ts`；真库用例 3 |
| 同一事实不重复计成本 | 成本只在已签结算确认事实产生一次；实付仅减少应付；重复 replay/确认不会新增事实 | 单测断言付款 impacts 无 `confirmed_cost`；确认单不可二次复核；真库断言 `confirmed_cost` 计数为 1 |
| CUT-03 只读核查 | `scripts/ops/check-legacy-settlement-usage.sql` + `.mjs`，只读事务，发现旧 `Settlement`/草稿/归档/文书/多节点记录即返回反例并退出 2 | 一次性 PG16 上 `LEGACY_SETTLEMENT_UNUSED`；**未做生产只读核查（无授权）** |
| 旧入口退役 | 未做，保留给 #425 | 未改 `SettlementListPage`/路由/retired-write-entry |

## 改动

- 新增 `services/api/src/settlement/signed-settlement-operating-source.adapter.ts`：
  - 只读取 `contractKind=downstream`、`state=confirmed` 的已签结算；
  - 使用复核时冻结的 `confirmedContractSource`（合同版本、合同类型、签约主体、相对方版本）保证可重放；
  - 成本分类沿用旧下游结算的同一口径（材料/机械/劳务/专业分包）；非结算成本合同类型不投影；
  - 金额按元→整数分半入（与支付口径一致），负数按绝对值和方向冲减；
  - 事实 `factKind=downstream_settlement`，影响为 `confirmed_cost` 与 `payable_increase|payable_decrease`。
- `services/api/src/settlement/signed-contract-settlement.service.ts`：复核事务内，对“下游且属于结算成本合同类型”的确认单调用 `appendConfirmedSourceIfEnabledInTransaction`；未启用经营账的项目保持原行为；表外/对上/驳回不投影。
- `services/api/src/payment/registered-payment-domain.ts`：统一实付域加入 `signed_settlement`。
- `services/api/src/payment/payment-operating-source.adapter.ts`：实付无显式分摊时，以 `signedSettlementId`（否则旧 `settlementId`）作为应付核销来源。
- `packages/shared-domain/src/operating-projection-export.ts`、`operating-ledger.module.ts`、`operating-projection.reducer.ts`：登记新经营来源类型与中文标签。
- 测试：新增 `signed-settlement-operating-source.adapter.spec.ts`、`registered-payment-domain.spec.ts`；扩展 `signed-contract-settlement.service.spec.ts`、`payment-operating-source.adapter.spec.ts`、`line-a-real-db.http.pg.spec.ts`。
- 核查脚本：`scripts/ops/check-legacy-settlement-usage.{sql,mjs}`；根 `package.json` 增 `inspect:legacy-settlement-usage`。

## 迁移说明（无新迁移）

- 既有 `20261119007000_signed_settlement_payment_basis` 只加了已签结算列，未同步旧约束：
  - `PaymentRequest_sourceType_check` 仍只允许 `settlement/contract_advance/contract_due`；
  - `PaymentRequest_source_settlement_check` 也拒绝 `signed_settlement`。
  真实 PG 写入 `PaymentRequest(sourceType='signed_settlement')` 报 `23514`，因此“后端事务内校验”在数据库入口即失败。
- 该迁移属本票、尚未发布；本轮**在同一迁移内**重建上述两个约束（并保留新增的 `signed_settlement` 来源互斥/快照约束）。没有新增迁移目录，迁移账仍 323，终点/校验和不变（`check:migration-baseline` 通过）；未改 `07500`/`05800`。

## 测试与证据

### 静态与单测

- `pnpm --filter @jiangkong/api typecheck`：通过（含 shared-domain 预构建）。
- `pnpm --filter @jiangkong/web-admin typecheck`：通过（新经营来源类型未破坏 Web 类型）。
- 相关 API 套件：`src/payment src/settlement src/operating-ledger src/operating-projection` → **63 suites / 1448 tests 通过**；2 suites / 10 tests 为既有环境跳过。
- `packages/shared-domain` 经营导出测试 3/3 通过。
- 改动 TS 文件 eslint：通过。
- `pnpm run check:migration-baseline`：`clean`（323 / `20261119007500` / `98e016b2…`）。
- 新增/修改影响的关键单测：
  - 已签结算确认后同一事务追加下游经营来源；驳回/表外/对上/非结算成本合同不追加；
  - 正数确认=成本+应付、负数=-8 冲减；
  - 统一实付域接受 `signed_settlement`，仍拒绝施工企业签约与未知来源；
  - 实付经营事实按已签结算 id 生成 `payable_decrease`，无 `confirmed_cost`。

### 真实 PostgreSQL 16

命令（一次性容器，仅本机回环）：

```bash
LINE_A_SKIP_CANDIDATE=20261119004200,20261119007500 \
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/jga-engines/schema-engine \
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
node services/api/prisma/run-line-a-real-db-local.cjs
```

结果：**7/7 通过**，24.5s，`candidateSha=a22af30611661a041c7798002b1cd2f3c655ba34`、`worktreeClean=true`、`postgres:16`。新增真库用例覆盖：
1. 已签结算确认后 `OperatingFact(sourceType=signed_contract_settlement)` 金额 1000 元，恰有 `confirmed_cost` 与 `payable_increase` 两条影响；
2. 统一实付域对已签结算付款返回 `supportedDomain=true`，且财务实付工作台 `workItems` 返回该申请（剩余 50000 分）；
3. 既有 6 条合同/变更/结算/履约用例继续通过。

回执状态 `candidate_http_passed_full_320_blocked`：完整 323 迁移重放仍被既有归档安装器前置 `20261118221000` 阻断（`requireActiveProjectParticipatingCompany` 前态，仓库内无迁移写入），因此候选迁移以 `PREFIX_275_PLUS_CANDIDATE` 方式应用 28 条（含 07000）。**跳过 `20261119004200` 与 `20261119007500`**：二者要求同一归档安装器闭包，和本票残余改动无关；因此真实环境未覆盖这两个文件触发器/绑定迁移。未伪造 320/323 通过。

### CUT-03 只读核查

在一次性 PG16 上执行：

```bash
PRISMA_QUERY_ENGINE_LIBRARY=/tmp/jga-engines/libquery-engine \
DATABASE_URL=postgresql://…/jiangkong_line_a_real_db \
node scripts/ops/check-legacy-settlement-usage.mjs --receipt /tmp/jg396-cut03-audit.json
```

结果：`verdict=LEGACY_SETTLEMENT_UNUSED`，旧 `Settlement=0`、`SettlementDraft=0`、归档=0、旧文书=0、多节点过程=0。该结果只证明脚本在隔离空库可执行；**生产旧数据核查尚未执行**，本脚本不执行删除/退役，#425 仍负责最终退役。

### 资源清理

- 本轮 runner 创建的容器均在结束时删除；最终核查时 `docker ps -q` 仍有 **1 个非本任务容器** `sleepy_almeida`（镜像 `sha256:87dc5a9e…`，命令 `/qualification/named-bank-ci.cjs --current-320`），不属于本工作树/本轮，未擅自删除；因此“全局 docker ps 为空”未被本轮满足，记录的**本任务容器已清理**。

## 未覆盖 / 边界

1. 未跑完整统一实付 HTTP 资金链（`recordRegisteredExecution` 的登记资金来源/期初分摊）。原因：本次真库跳过 `04200/07500` 后，付款凭证文件绑定目录返回 `unavailable`，实付经营投影会在 `registeredPaymentInstalled` 处 503；完整资金链需 #415 的注册资金夹具与归档安装器前置。本轮以“真实 PG 域/工作台 + 单测分摊映射”覆盖。
2. 生产 CUT-03 只读核查未执行（无生产授权）；不能据隔离空库结果宣称生产无旧结算数据。
3. 已签结算金额若含厘/毫（超过两位小数），经营投影按支付口径半入到整数分，尾差保留在结算事实；这是既有经营账“分”口径的边界，未改成本投影的既有元/分协议。
4. 表外/对上已签结算不在本轮投影为“我方成本/下游应付”（与旧下游结算口径一致）；其经营处理仍按表外/对上事实域。
5. 旧 `/结算工作台/新建` 入口与旧写路径未退役，属 #425。

# PG 动态门收敛（权限姿态裁决后）回执

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgL`，分支 `line-l-pg-gates`
- 合并：`git merge --no-ff adopt-395-396-415` → `5108ec9c1`（集成分支 `2ec91a554`）
- 基线迁移仍 323 / 终态 `20261119007500…` / `98e016b2…`；**07500 字节未改**。
- 本轮提交：`cf0bac2f7`（A/B 夹具与部署授权；本回执随后单独提交）
- 未 push；未动 `/tmp/jgM` 与主仓库。

## 1. A：兼容别名 `jg_file_business_binding_columns_before_signed_settlement`

### 1.1 迁移前已存在的运行时角色（产品迁移负责）

- 结论：**不需要在 07500 增补 GRANT**。07500 的 ACL 保留式换代已经覆盖这一类：
  - `ALTER FUNCTION … RENAME TO …_before_signed_settlement` 保留原函数 ACL，因而迁移前已有 EXECUTE 的角色自动保留在**别名**上；
  - 新 current 函数按 `original_acl` 逐条 `GRANT EXECUTE`（含 grant option 位），迁移前角色同时保留在**新 current** 上；
  - 迁移未向 PUBLIC 授权、未给新角色名发 GRANT。
- 实测证据（一次性 PG16，简化 registry 复刻 07500 的 `DO $registry$` 块）：迁移前角色 `pre_role` 只在旧函数上有 EXECUTE，执行 07500 registry 块后
  `has_function_privilege(pre_role, 别名, EXECUTE) | (pre_role, 新 current, EXECUTE) | (pre_role, 别名, WITH GRANT OPTION)` = **`t|t|f`**。
- 角色与实际调用方：生产/部署期应用运行时角色（部署脚本以 `OPERATING_LEDGER_RUNTIME_ROLE` 指定；仓库模板里是 `__APP__` 占位，非固定夹具名）。因其在迁移前创建，由**产品迁移**保证 ACL 连续，而不是靠夹具。
- 因此 07500 未改一个字节，295 链无需重钉。

### 1.2 迁移后按用例创建的角色（夹具负责）

这些角色在 323 安装完成之后才 `CREATE ROLE`，无法继承 07500 的 rename-ACL，必须由对应 harness 显式授权：

| 角色 | 所属门 | 夹具文件 | 修法 |
| --- | --- | --- | --- |
| `jg_task01_runtime` | task398_shared_standard / task398_browser / task398_browser_completion / task409_principal_return / task410_company_proxy / project_expense_* | `.github/task12-install-290/standard/fixtures/contract-bank-runtime-fixture.cjs.patch`、`.github/task12-install-290/browser-partial/fixtures/contract-bank-runtime-fixture.cjs.patch`（同一 base→result） | 在 owner-settlement 分支后条件 `GRANT EXECUTE ON FUNCTION …_before_signed_settlement()`（仅当函数存在；不做 PUBLIC、不给 grant option） |
| `jg_task01_runtime`（owned-280 读基线） | 同上 | `task12-install-290/{standard,browser-partial}/fixtures/task398-owned-280-business-read-baseline.json`、`task12-install-289/procurement/fixtures/…`（及 290 procurement overlay） | 读基线追加 `ContractSignedChange`、`SignedContractSettlementAttachment`，使 `businessReadGrantSql` 授 SELECT 且 `businessReadCheckSql` 仍精确 |
| `general_procurement_runtime`、`project_business_scope_runtime` | general_procurement | `.github/task12-install-290/procurement/overlays/<hash>` 的 `general-procurement-owned-ci.cjs` `registry` 列表 | 列表追加新别名；读基线同上（overlay 同步） |

重钉的摘要（均由脚本重算，未改产品迁移）：
- fixture patch 结果：`f8a52c20…` → `594c180e…`；patch `29f20d64…`；base 仍 `5a66b178…`。
- owned-280 读基线：`d9406ad3…` → `88b44411…`（326 表）。
- procurement owned-ci overlay：`02d8c428…` → `3c3faa12…`；两份 `source-inputs.json.gz` 及其 `pins.json` runtime 摘要（注意 pin 是**解压后**字节的 sha256）、`plans/*/checkout.cjs` 的 baseline 摘要、`overlay-files`。
- `task12-install-295/contract-finance/common/checkout.cjs` 的 `prismaFixtures`：fixture/读基线两处同步。
- `standard/plan.sha256`、`browser-partial/plan.sha256`、`browser-partial/assembly-pins.json` 同步。

## 2. B：采购读 owner-only 表 `jg_company_transfer_loan_repayment_scope_v1`

- 结论：**没有产品读取路径，不需要新增 SECURITY DEFINER 只读包装**，也没有改 07500。
- 证据：
  1. 全仓库检索该表名，除迁移 `20261119000600/007000/03700/03800` 外，只出现在 `.github` 夹具/自检里；`services/api/src`、`apps`、`packages` 无任何读取。
  2. 采购门原先的 42501 实际发生在 `sign()` 的 `/me/signature/canvas`（staged spec 第 59 行 `expect(201)`），是 A.2 的别名 EXECUTE 缺口；PG 日志里的 `permission denied for table jg_company_transfer_loan_repayment_scope_v1` 是夹具“运行时不得读 key 表”的**预期拒绝**探针。
  3. 只修 A.2、不改该表授权后，`general_procurement` 本地全绿（15+1），且运行时对该表仍无任何权限。
  4. 采购夹具的 `PROCUREMENT_OWNED_PRIVATE_AUTHORITIES` 明确要求运行时角色对非 readable 表**不得**有任何 SELECT；授表 SELECT 会直接打红夹具守卫。
- 因此维持“owner-only + SECURITY DEFINER 写入/资格函数”的现状；若后续出现真实产品读需求，再按裁决加包装函数（需 07500 变更与 295 链重钉）。
- **按同一姿态处理的真实产品 ACL 缺口**：`project_business_scope_runtime` 读付款详情时缺 323 尾部只读包装的 EXECUTE（`jg_read_payment_detail_activity/allocations/pdf/snapshots_v1`、`jg_read_payment_contract_agreement_detail_v1`、`jg_read_effective_contract_change_amount_v1`）。在部署 ACL `services/api/prisma/general-procurement-runtime-grants.sql` 中按“仅授实际调用方、函数不存在则跳过、并断言已授”补齐；未授任何表 SELECT、未改迁移。采购 project11 因此转绿，且运行时对 owner-only 表仍零权限。

## 3. 本地实跑结果

命令均以 `prepare.sh … --current-320` + `build.sh <sha> browser|mobile` 的 323 镜像执行，`source=5d07c92c0`。

| 门 | 结果 | 状态串 | 耗时 |
| --- | --- | --- | --- |
| task398_shared_standard | **绿** | `TASK398_STANDARD_EXACT_323_PASSED` | 2m06s |
| task409_principal_return | **绿** | `TASK398_CASH_PRINCIPAL_EXACT_323_PASSED` | 1m59s |
| task398_browser | **绿** | `TASK398_BROWSER_PARTIAL_EXACT_323_PASSED` + receipts verified | 2m19s |
| task398_browser_completion | **绿** | `TASK398_BROWSER_COMPLETION_EXACT_323_PASSED` + receipts verified | 2m45s |
| general_procurement（general16） | **绿** | `GENERAL_PROCUREMENT_ORIGINAL_15_PLUS_1_323_PASSED`（终版改动后复跑见下） | 3m49s |
| general_procurement（project11） | **绿**（补 payment detail 只读 EXECUTE 后） | `PASSED`（receipt.status，`business=CALLBACK_COMPLETED`） | 3m41s |
| task410_company_proxy_repayment | **红** | `TASK410_COMPANY_PROXY_323_BEHAVIOR_FAILED` | 1m58s |
| project_expense_receipt | **红** | `ERR_ASSERTION` | 1m50s |
| line_a_real_db | **红** | 07500 闭包块 `SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE`（55000） | ~3m |

- `task410` 首因：`ContractWorkCompletionOperatingSourceAdapter.read` → `jg_contract_work_completion_cost_sources_v1`（`20261119005800`，SECURITY DEFINER）抛 42501 `履约成本来源读取资格缺失`。该函数要求 `jg_contract_work_completion_witness.runtimeRoleOid = session_user` 且 `session_user <> current_user`；而 task410 夹具以 `jg_task01_runtime` 单角色直连（session=current）、且未写 witness 行。属“夹具需两段角色 + witness”或“产品资格判定”二选一，需决策（不是本轮 A 的别名问题）。
- `line_a_real_db` 首因：本地 `LINE_A_SKIP_CANDIDATE=20261119004200 node services/api/prisma/run-line-a-real-db-local.cjs` 在候选流安装 07500 时，其 `$closure$` 块以 `SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE`（55000）拒绝：`jg_contract_direct_upward_closure_v2` 单行/owner/A段闭包前置在该安装序列下不满足。属产品迁移与 line-a 安装序列的交互，非本轮夹具/授权改动；不改 07500，需 line-g 与产品决定（改安装序列或调整 07500，后者触发 295 重钉）。
- `project_expense_receipt` 首因：business 前即 `ERR_ASSERTION`（`receipt.expenseApp` 未生成；stages 停在 `EXACT_295_MULTI_WITNESS_CONSUMER`）。`expense-app.cjs` 的 323 forward 断言链（`forward?323:295`、`forward.ledgerSha256`、`expectedLedgerSha256`）之一失败，需一轮带 stack 的本地复跑定位。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm check:migration-baseline` | `status=clean`，323 / `20261119007500…` / `98e016b2…`，`drift:[]` |
| `docker ps -q` | 输出为空（0 行，实测） |
| 07500 字节 | 未改；295 链无需重钉（fixture/夹具摘要变化不影响迁移账本） |
| 未 push / 未动 `/tmp/jgM`、主仓库 | 是 |

## 5. 需要 line-g 知晓的重钉范围

- **07500 未改**：迁移账本/终态 checksum 不变，295 链**不需要**为 A/B 重钉。
- 变更的夹具摘要（已在本提交内自洽重钉）：`standard` 与 `browser-partial` 的 fixture patch/result、读基线、`plan.sha256`、`assembly-pins.json`；`contract-finance/common/checkout.cjs` 的 `prismaFixtures`；procurement 的 `pins.json`、两份 `source-inputs.json.gz`、`plans/*/checkout.cjs`、overlays 与 `candidate-delta320.json`。
- 产品文件 `services/api/prisma/general-procurement-runtime-grants.sql` 变更后，`.github/task12-install-289/*workspace-inputs.json`（8 份历史 289 闭包清单）仍记旧摘要 `c6ed1b2f…`；本轮只对采购 323 路径补了 `candidate-delta320`，未改 289 历史清单。若 289 闭包门仍被启用，需要同步这 8 份清单或确认其只服务历史流。

## 6. 仍需处理

- `task410`：按第 3 节二选一决策；若走夹具，需要把工作完成 witness 行按 line-a 的做法写入，并让应用会话满足 `session_user<>current_user`。
- `expense-receipt`：定位 323 forward 断言（下一轮本地带 stack 复跑）。
- `pol275` EACCES、`remaining` 5 例、`onboarding` sealed 材料、`pol113` 1 例：沿用上一份回执的定位，本轮未动。

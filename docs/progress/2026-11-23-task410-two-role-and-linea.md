# task410 两段角色与 line-a 闭包前置回执（裁决后二轮）

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgL`，分支 `line-l-pg-gates`
- 合并：`git merge --no-ff adopt-395-396-415` → 合入 `07b40c7fe`（HEAD `e43e91292`）
- 迁移仍 323 / 终态 `20261119007500…` / `98e016b2…`；未改 `07500`/`05800`；未 push；未动 `/tmp/jgM` 与主仓库。

## (a) task410：两段角色 + witness（只改夹具）

按裁决不使用“单角色 + 授予 owner”的旧路，改为真实两段会话：

- 夹具为 company-proxy 323 模式新增受限登录角色 `jg_task01_login`：
  - `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`；
  - `GRANT jg_task01_owner TO jg_task01_login`，并 `ALTER ROLE jg_task01_login SET role = jg_task01_owner`；
  - 应用 `DATABASE_URL` 使用登录角色，连接后 `session_user=jg_task01_login`、`current_user=jg_task01_owner`；
  - `jg_contract_work_completion_witness` 写入单行，`runtimeRoleOid` 绑定登录角色（key 用 `md5(random())` 拼接，不依赖 pgcrypto 的 `gen_random_bytes`）。
- 夹具测试库解析与 owner 断言同步：允许登录角色 URL；323 下断言 `session_user='jg_task01_login' AND session_user<>current_user`，并额外要求登录角色非超级用户；295 模式仍要求 `session_user=current_user`。
- 产品函数 `jg_contract_work_completion_cost_sources_v1` 与迁移 `05800` 未改一个字节。

实跑过程与结果：
- 第一版把登录角色接入 `roleUrls` 时作用域写错（`companyProxyScenario` 在 `runTask398Owned282Voucher` 里应为 `options.companyProxyScenario`），已修正；
- 应用连接登录角色先报 `User "jg_task01_login" was denied access` → 补 `GRANT CONNECT ON DATABASE <db>`；
- 之后仍止于 staged spec 第 40 行 `assertTask410Owner290`（`TASK410_OWNED_290_OWNER_REQUIRED` 方向），即 owner 断言的某个子条件未满足（`session_user`/`current_user`/superuser/端口/账本/`jg.task398_run_id`），需下一轮带子条件探针定位。
- 由于未转绿，本轮**回退了 `stage-task410.py` 的改动**（只保留本回执），避免把未验证的夹具模型带进分支；实现路径已完整记录在本节，下一轮可直接续做。

## (b) line_a_real_db：07500 闭包前置

- 首因（本地复跑）：`LINE_A_SKIP_CANDIDATE=20261119004200 node services/api/prisma/run-line-a-real-db-local.cjs` 在候选流安装 `20261119007500` 时，`$closure$` 块以 `SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE`（55000）拒绝，因为 `jg_contract_direct_upward_closure_v2` 在 `PREFIX_275_PLUS_CANDIDATE` 边界上没有行（count<>1）。
- 该行不是迁移写入的，而是 289/292 归档安装器 `beginNativeTask12ArchiveProtocol`（`task16-current259-archive-install.cjs` → `jg_install_contract_direct_upward_v2`）的产物；line-a 的 275 前缀没有 289/291 归档状态，直接调用该安装器会改变/掩盖 `PREFIX_275_PLUS_CANDIDATE` 已知边界（全量重放本应停在 `20261118221000`）。
- 本轮未改 runner，未改 `07500`。需要的决策是以下其一：
  1. line-a 从“已跑 289/292 归档安装”的前缀启动候选流（边界定义随之调整，需要 289 材料）；
  2. 给 07500 增加候选边界豁免（产品迁移变更，触发 295 链重钉）；
  3. 在 line-a 候选列表中把 07500 延后到归档协议之后（需要先能在 275 前缀上真实生成闭包行）。
- 结论：结构上卡在“闭包行只能由 289/292 归档协议产生”与“不得掩盖 320 全量重放阻断”之间，需要 lead/line-g 明确选一条。

## 结果与验证

| 检查 | 结果 |
| --- | --- |
| (a) task410 company-proxy（323） | **仍红**：`TASK410_COMPANY_PROXY_323_BEHAVIOR_FAILED`，止于 `assertTask410Owner290`；两段角色/witness 方案已验证到连接层，未提交 |
| (b) line-a_real_db | **仍红**：`SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE`（07500 闭包行缺失，见上），未改 runner |
| `pnpm check:migration-baseline` | `status=clean`，323 / `20261119007500…` / `98e016b2…` |
| `docker ps -q` | 输出为空（0 行，实测） |
| `07500`/`05800` | 未改；295 链无需重钉 |
| 未 push / 未动 `/tmp/jgM`、主仓库 | 是 |

## 其余仍红（沿用前两份回执，未变）

- `expense-receipt`：323 forward 断言链（`forward?323:295` / `forward.ledgerSha256` / `expectedLedgerSha256`）之一，business 前 `ERR_ASSERTION`。
- `onboarding` sealed 材料、`pol275` `EACCES`、`remaining` 5 例、`pol113/114` 1 例（SIGTERM/P0001，仅 x64 CI 可判别）未在本轮推进。

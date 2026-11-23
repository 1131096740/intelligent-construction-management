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

## (b) 裁决 ① 执行记录（2026-11-23 四轮）

- 合并 `adopt-395-396-415@930cde853` → HEAD `8ab9bd1a7`；迁移仍 323 / `20261119007500…` / `98e016b2…`。
- 按裁决 ① 评估“289/292 归档协议已安装前缀 + 候选迁移”。归档链在本仓库的入口只有两条：
  1. `.github/task12-install-295/contract-finance/common/install-only292.cjs` → `installCombined292` / `common/installer.cjs`。它自带 `/qualification/*` 挂载、TLS、`pg_ctl` 数据目录与 postgres 生命周期，运行在 gate 镜像容器内，入口只暴露 `admitSource`/`installCombined292`，无法挂接到 line-a 已运行的 `postgres:16` 容器。
  2. `.github/task12-install-289/installer.cjs`（`installHistory`）→ `task16-current259-archive-install.cjs#beginNativeTask12ArchiveProtocol`。它需要 `plan.source.witness.profile`（**sealed 289 精确归档 profile**：289 条 ledger + `tree`/`sealSha256`/`candidateSha`）与 `completion`（同一 DB 身份下的 9 角色 provisioning 回执），且要求 DB 处于 289 前缀状态。
- line-a 当前的 `createCiDynamicMigrationFixture` 由**当前 323 工作树**构造 plan（`profile.ledger` 为 323 条），且容器 DB 停在 275 前缀；因此：
  - `beginNativeTask12ArchiveProtocol` 会在 `isExactCurrentArchiveProfile(source.profile)` 处拒绝（profile 不是 sealed 289 归档 profile），甚至到不了 `jg_install_contract_direct_upward_v2`；
  - 若要满足它，必须先引入 289 密封材料（`.github/task12-install-289/historical-install-inputs.tar.gz` / `task12-install-292` 产物）并在 line-a 容器内完成 289→291→292 的归档协议 5 段 SQL 与 9 角色 provisioning——现有仓库没有把这条链挂到“外部已运行 postgres 容器 + 现有 ownerUrl”的入口。
- 确切缺料：**line-a 容器内的 289/291/292 归档安装 executor**（当前只有 gate 镜像内的 `install-only292.cjs` 与 289 installer，两者都拥有自己的 postgres 生命周期），以及 289 精确 profile 的构造入口。
- 因此本轮**未改** `run-line-a-real-db-local.cjs`、未改 `07500`、未 insert 闭包行；模式仍是 `PREFIX_275_PLUS_CANDIDATE`。
- 合并后本地复跑（`LINE_A_SKIP_CANDIDATE=20261119004200 node services/api/prisma/run-line-a-real-db-local.cjs`，~3m，`exit 1`）确认仍在同一处阻断：
  `psql:<stdin>:152: ERROR: SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE ... LINE_A_REAL_DB 失败：候选迁移失败 20261119007500_…`。
  另：本机 Docker 曾出现 `postgres:16` 在 `docker images` 可见但 `--host`/`inspect` 报 `No such image` 的镜像存储不一致，需 `docker tag postgres:16 …` 刷新后才能复跑；与代码无关。
- 下一步（如需继续 ①）：把 `install-only292.cjs` 的 289→292 段抽成“可对任意 ownerUrl 执行”的库（5 段 SQL 已由 `archive.beforeSql/…/sql` 暴露），或在 line-a 内以 289 密封材料重建 profile/completion 后调用该协议；这需要新的一轮专门实现与 289 材料接线。

## (b) 裁决 ① 续：归档协议库化的确切卡点（五轮）

- 合并 `adopt-395-396-415@1d1701018` → HEAD `66a1db54d`；迁移仍 323。
- 好消息：262 密封 profile 可由仓库已有材料**精确构造**——取 `prepare.sh` 物化的 289 产品前 262 条迁移（`/tmp/lnl/source/prepared/product/predecessor/services/api/prisma/migrations`），逐条 sha256 后 `sha256(JSON.stringify(ledger)) = b57d5da2…`，与 `task16-current259-profile.cjs` 的 `TASK12_ARCHIVE262_SOURCE_V1` 期望值一致；无需放宽校验。
- 真正的卡点不是 profile，而是**归档协议的硬前置身份/角色模型**（`task16-current259-archive-install.cjs` 第 682-689 行）：
  - `identity.database === 'jg_task01_' + runId.replaceAll('-','')`；
  - `identity.ownerOid==='10'` 且 `identity.actor==='jg_task01_owner'`、`sessionActor==='jg_task01_owner'`；
  - `ordinary.name` 必须是 `jg_fixture_app_[a-f0-9]{24}` 且 login；
  - `completion.roles` 必须是 9 个角色（`jg_c259_outside_*` 4 个、`jg_c259_upward_*` 3 个、`jg_task01_observer/runtime`）且 `xmin===commitXid`、`login` 规则与 ACL before/after 齐备。
- 而 line-a 现状：容器用 `POSTGRES_USER=jiangkong`（oid 10=jiangkong，不是 `jg_task01_owner`）、库名固定 `jiangkong_line_a_real_db`、只有 `createCiDynamicMigrationFixture` 的应用角色/`jg_task01_*`（无 `jg_c259_*` 九角色与 commitXid 回执）。因此即使拿到 262 profile，`beginNativeTask12ArchiveProtocol` 在 `source/completion` 校验处就会拒绝。
- 结论：库化（5 段 SQL + 角色渲染）本身可做，但要让协议**合法**跑通，line-a 的“建库”必须改成 289 身份模型（`jg_task01_owner` 为 oid 10 的引导超级用户、`jg_task01_<runId>` 库名、九角色 provisioning 并生成 completion 回执）。这属于对 runner 建库引导的重写，已超出“只抽库 + 接入 profile”的表述范围；按硬边界本轮**停下，不再堆代码**，也未改 `07500`、未 insert 闭包行、未改 runner。
- 需要确认：是否把范围扩到“按 289 身份模型重建 line-a 引导（容器引导用户/库名/九角色/completion）”；若确认，下一轮按 `installHistory` 的 `migrateNativeTask16 + roles + archive.*Sql` 顺序实现并对 line-a 本地跑到 6/6。

## staged fixture 增量句柄（六轮，用户批准改共用 fixture）

### 增量 API（只增不改）

- `services/api/prisma/local-staged-migrations.cjs`
  - 新增内部 `stagedHandles` Map；在 `controls.checkSetup(setup, plan)` 之后（即 205 阶段 setup 成功后、最终全量 deploy 之前）快照 `{database, plan, setup, capturedAt:'QUALIFICATION_SETUP'}`；已存在则不覆盖。
  - 返回对象新增只读方法 `getStagedSetupHandle(database)`，返回冻结副本或 `null`。
  - 既有返回字段、`migrate()` 抛错时机/错误码、busy/stopped 语义、所有 `need(...)` 断言均未改。
- `services/api/prisma/local-staged-ci-dynamic.cjs`
  - 捕获 `createLocalMigrationFixture(...)` 结果，返回 `{...fixture, getStagedSetupHandle: db => fixture.getStagedSetupHandle(db)}`；既有键值全部保留（spread），`migrate` 引用不变。
- 零行为变更证据：`git diff` 仅新增行（无既有行修改）；`node --test run-database-dynamic-gate-local.test.cjs` = **83/83 pass**；`node --test local-staged-{ci-dynamic,migrations,prefix-cache}.test.cjs` = **145/145 pass**；`task398_shared_standard` 复跑仍为 `TASK398_STANDARD_EXACT_323_PASSED`（该门用镜像内旧 fixture，行为未变）。

### 需重钉清单（按指示未自行重钉）

改动文件在以下 pin 中记录旧摘要，需由 line-g 统一重钉：
- `.github/task12-install-289/{workspace-inputs,template-workspace-inputs,invoice-workspace-inputs,draft-workspace-inputs,pol108-core-workspace-inputs,pol108-scale-workspace-inputs,pol109-workspace-inputs,pol275/workspace-inputs}.json`
- `.github/task12-install-289/review-manifest.json`、`.github/task12-install-289/procurement/workspace-files.json`
- `.github/task12-install-290/procurement/plans/{general16,project11}/source-inputs.json.gz`（及 `pins.json` 的 runtime 摘要）——否则采购输入阶段会以 `PROCUREMENT_295_ORIGINAL_OVERLAY_PIN` 停下（这不是行为回退，是 pin 失效，按指示交回）。

### line-a 现状与下一步

- 句柄已可按需取得，但 line-a 仍未接线：归档协议还要求 `completion.databaseIdentity.tls===true`、`client/server=127.0.0.1`、owner `jg_task01_owner` oid 10、库名 `jg_task01_<runId>`、九角色 + completion。当前 line-a 容器无 TLS、引导用户为 `jiangkong`、库名 `line_a` 固定名，均需按 289 身份模型重建。
- 下一步实现顺序：①容器引导 `jg_task01_owner`(oid10) + `jg_task01_<runId>` + 自签 TLS（`ssl=on`）+ 保留 `jiangkong` 供 staged fixture psql；②`migrate()` 捕获失败后 `getStagedSetupHandle` → 262 profile（已验证 `b57d5da2…`）→ `roles.*` 生成 completion；③`archive.*Sql` 五段；④候选 03500/03600+04000..07500；⑤原有 witness/spec。

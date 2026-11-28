# 受限运行时文件绑定核验回执（task410 lane 503）

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgI`，分支 `line-i-binding-reader`，基线 `cefad7254`（迁移数 323）
- 产品修复提交：`72aac8530`；本回执提交紧随其后
- 目标：让受限 app 角色（不取得 owner/超管）核验文件业务绑定，消除 `task410_company_proxy_repayment` 的 503

## 1. 503 抛出点与调用链

唯一抛出点（修复前 126 行）：

```
services/api/src/database/registered-payment-catalog.ts:126
throw new ServiceUnavailableException("付款凭证文件绑定暂不可核验，请稍后重试");
```

`readFileBindingCatalog()` 判定安装状态不是 `absent/installed` 时抛出。产品入口均先调用它：

- `file.service.isFileReferenced()`（`/files/:id/download-ticket-capability` 等读路径）
- `file-business-binding.nonReceiptBusinessFileBindingIds()`（凭证/附件上传与登记）
- `file-binding-manifest.fileBusinessBindingRefs()`（清理清单）
- `contract-direct-pending-registered-binding.qualifyDirectPendingFileBinding()`

## 2. 根因

不是直接 SELECT 绑定表失败，也不是调用 `jg_file_business_binding_columns()` / `jg_has_exclusive_file_business_binding()` 被 ACL 拒绝。目录核验只查 `pg_catalog`（受限角色无任何业务表 SELECT 也能执行）。

真正原因是目录的**安装指纹**把「谁可以执行 owner-settlement 只读入口」也当成指纹的一部分：`installed` 分支要求 `SECURITY DEFINER` 的 `jg_project_owner_settlement_voucher_bound(text)` 的 ACL **恰好只有一行**（owner→owner EXECUTE）：

```sql
AND (SELECT count(*)=1 AND bool_and(a.grantor=owner AND a.grantee=owner ...)
     FROM aclexplode(coalesce(reader.proacl, acldefault('f',owner))) a)
```

受限运行时角色按产品需要被 owner 授予该入口的 EXECUTE 后，ACL 变成两行，目录被判 `unavailable` → 503。该精确 ACL 判定由 `8f1ff2bbc`（#394 固定 279 产品树）引入，是安装指纹，不是权限模型的一部分；同一查询上方 registry 的 ACL 判定本来就允许 owner 授予的非转授 EXECUTE。

真库复现（红）：`RUN_FILE_BINDING_CATALOG_DATABASE=1` 下，单独 `GRANT EXECUTE ... TO <受限角色>` 即让目录测试从 `installed` 变 503；`GRANT ... TO PUBLIC` / `WITH GRANT OPTION` 也 503。

## 3. 修法（复用既有 SECURITY DEFINER 入口，无新迁移）

只改产品判定，不改 05800、不改被 hash 钉住的 `jg_enforce_exclusive_file_business_binding()`、不给登录角色 owner/超管：

- 保留 reader 的 body/owner/`search_path` 哈希钉点；
- ACL 改为只约束可达范围：owner 保留非转授 EXECUTE；禁止 `PUBLIC`（grantee=0）、第三方 grantor、非 EXECUTE 项、以及给非 owner 的 GRANT OPTION；允许 owner 授予受限运行时的非转授 EXECUTE；
- 与同一查询中 registry 的 ACL 规则一致。

新增 `services/api/src/database/file-binding-catalog.pg.spec.ts`（默认跳过，`RUN_FILE_BINDING_CATALOG_DATABASE=1` 入口）用真实 PostgreSQL 复刻目录最小安装面（从迁移/安装见证材料取精确 prosrc 并校验哈希）：

| 用例 | 结果 |
| --- | --- |
| owner-only reader ACL → installed | 通过 |
| 受限角色被 owner 授予 reader → installed（修复前 503，红） | 通过 |
| 复刻 lane 的 `GRANT EXECUTE ON ALL FUNCTIONS` → installed | 通过 |
| `GRANT ... TO PUBLIC` → 继续 503 | 通过 |
| `WITH GRANT OPTION` → 继续 503 | 通过 |
| 受限角色无任何业务表 SELECT 仍可核验 | 通过 |

## 4. 权限边界

- 目录核验本身不读取业务表；受限角色只需 `pg_catalog` 可见、`public` USAGE 与 reader 的 EXECUTE。
- 本修复不新增任何 GRANT：部署侧仍须授予运行时对绑定表的最小读写（产品扫描路径需要）与 reader EXECUTE；未授予时是 42501，而不是被误报成 503。
- `PUBLIC`、GRANT OPTION、第三方 grantor 仍 fail closed；reader 的 body/owner/`search_path` 仍被哈希钉住，篡改仍会被识别。

## 5. 实跑结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 新真库契约 | `pnpm --filter @jiangkong/api exec jest file-binding-catalog.pg.spec --runInBand` | 6/6 通过（HEAD `72aac8530`） |
| 受影响单测 | `jest file-binding-manifest file-business-binding file.service.spec` | 6 套件 / 384 用例通过（1 个数据库集成用例按环境跳过） |
| 类型 | `pnpm --filter @jiangkong/api typecheck` | 通过（含 shared-domain build） |
| 迁移基线 | `pnpm check:migration-baseline` | `clean`，323 / `20261119007500…` / `27683ee9…` |
| task410 lane（验证树） | `run-task410-company-proxy.sh <repo> <prepared> <sha> <build>` | 受限角色下 **6/6 业务用例通过**，receipt `original={business:1,passed:6,skipped:0}`，无 503、无 `Unexpected HTTP status` |

task410 lane（验证树 `1aefa9c3`，322 迁移 = 322 冻结链 + 本修复，无 07500 迁移）关键回执：

- 受限连接实测：`{"cu":"jg_task01_replay","su":"jg_task01_login","cnt":322,"ssl":true,"witness":true,"terminal":true,"ownerSuper":true}`
- `INSTALL_ONLY_292_BALANCE_CALLBACK_CONTINUITY` 通过，`installOnly292.balance` 15 项全 true（含 `superuserRoleReachabilityAbsent`、`nonOwnerLoginEffectiveAccessAbsent`、`runtimeKeyAndSchemaDenied`）
- `forward320={count:322, tails:27, ledgerSha256:9919038b…, sameBaseB7:true}`
- lane 回执整体仍 `STOPPED`：业务 6/6 通过后，**harness 收尾** `closeOwned280CashProfile` 的 `jg_require_contract_direct_upward_source_v2()` 以 55000（`对上前置/源码元数据漂移`）失败；这是受限角色 harness 的授权/围栏与 upward 闭包见证相互影响，不是产品路径。为定位曾在验证树临时收窄函数授权、恢复 upward 绑定函数 ACL，仍未收敛（剩余 `PROJECT_SCOPE_DRAFT_ARCHIVE_TRIGGER_MANIFEST`），未把该调试改动带入交付。

在**交付树**（323 迁移，含线 H 的 `20261119007500`）直接跑同一 lane 时，冻结 295 链在业务前停在 `INSTALL_320_CONTRACT_DETAIL_READERS` / SQLSTATE 55000：其 `jg_require_contract_direct_upward_source_v2()` 的源码/触发器闭包不接受新 registry 后继（`migrationCause=UPWARD_TRIGGER_BODY`）。这是冻结链仍钉 322 的既有缺口（线 H 回执已登记），不是本轮产品改动。

## 6. 最终迁移数

**323**。本修复未新增迁移（优先复用既有 SECURITY DEFINER 只读入口），`check:migration-baseline` 为 clean。

## 7. 未覆盖风险与边界

1. `contract_finance_acceptance` 的 bank/restore/core/payment 未在本轮实跑：这些 lane 的 `source.json`/内容派生材料（`bank/execution-files.json`、`restore/app-inputs.json` 等）都按 322 终态钉住，且本轮产品源码变更会改变其内容摘要；要跑必须像线 G 一样把 295 冻结链 322→323 全量重基线（含派生材料重算），并在业务前修好上述 upward 闭包缺口。本轮未做该重基线，也未伪造结果。
2. task410 lane 的完整 `PASSED` 回执未取得：**业务 6/6 已通过**，失败点在业务后的 harness 收尾（见第 5 节），需单独修 harness 的授权/围栏模型。
3. 部署侧的运行时授权仍是前提：如果真实受限角色没有绑定表 SELECT / reader EXECUTE，产品扫描会以 42501 失败；本修复只消除「被误判为安装不可核验」的 503，不改变需要哪些授权。
4. ACL 指纹放宽的边界：owner 授予任意受限角色的非转授 EXECUTE 都会被接受；owner 本身、body、`search_path`、`proconfig`、触发器与 registry 后继仍全部按哈希/形状钉住；`PUBLIC` 与 GRANT OPTION 仍拒绝。
5. task410 lane 的受限角色 harness（`jg_task01_login` + `jg_task01_replay` + 全表/函数授权 + hba 放行）只是验证脚手架，未提交到产品分支；交付分支只含目录修复与真库契约用例。

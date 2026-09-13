# 本机 PostgreSQL 16 动态门

本入口把当前受 `RUN_*` 控制的数据库测试纳入一次性本机 PostgreSQL 16 runner。清单以
`database-dynamic-gate-manifest.json` 为机器真相；可编排不等于已经通过，必须以执行收据为准。

当前迁移基线由 `migrations/` 实际目录确定，目前是 169 个目录，终点为
`20260912100000_pol284_participant_history_integrity`。

## 迁移基线检查与同步

基线由 `generate-database-migration-baseline.cjs` 从迁移目录排序、计数并计算终点
`migration.sql` 的 SHA-256 后派生。默认检查和预览均为只读；只有显式 `--sync` 才会
以同目录临时文件原子更新 canonical manifest。同步前后都不得修改业务迁移目录。

```bash
pnpm check:migration-baseline
pnpm preview:migration-baseline
pnpm sync:migration-baseline
```

`check`/`validate` 在 source-directory drift 时以非零退出；`preview` 报告 drift 但不写入；
`sync` 仅允许 canonical manifest 目标，重复执行幂等。动态门 validator 与所有受控 runner
复用同一 `migration-baseline.cjs` 派生接口。

## 只读检查

以下命令不会调用 Git、Docker、PostgreSQL 或子测试 runner：

```bash
node services/api/prisma/run-database-dynamic-gate-local.cjs
node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest
node services/api/prisma/run-database-dynamic-gate-local.cjs --list
node services/api/prisma/run-database-dynamic-gate-local.cjs --list --group payment_execution
node --test services/api/prisma/run-database-dynamic-gate-local.test.cjs
```

## 动态执行

只有同时满足以下条件才会执行：

- 提供当前工作树精确的 40 位候选 SHA；
- 提供确认串 `LOCAL_PG16_DYNAMIC_GATE`；
- 工作树完全干净，候选 SHA 与 `HEAD` 一致；
- `NODE_ENV` 不是 `production`；
- 进程没有继承 `DATABASE_URL` 或任何 `*_DATABASE_URL`；
- Docker context 解析为本机 Unix socket 或 Windows named pipe；
- 本机已经缓存 `postgres:16`，入口不会拉取镜像；
- 源码仍精确包含 169 个迁移目录及当前终点迁移。

执行格式如下，`<CURRENT_40_CHAR_SHA>` 必须手工替换为已核验候选：

```bash
node services/api/prisma/run-database-dynamic-gate-local.cjs \
  --execute \
  --candidate-sha <CURRENT_40_CHAR_SHA> \
  --confirm LOCAL_PG16_DYNAMIC_GATE
```

不提供 `--group` 时仍按清单执行全部 15 组。CI 可以重复提供 `--group <清单组名称>`，只执行选中的组：

```bash
node services/api/prisma/run-database-dynamic-gate-local.cjs \
  --execute \
  --group payment_execution \
  --candidate-sha <CURRENT_40_CHAR_SHA> \
  --confirm LOCAL_PG16_DYNAMIC_GATE
```

组名必须来自 `database-dynamic-gate-manifest.json`；未知组和重复组均失败关闭。多组始终按清单顺序执行，
收据中的测试数、文件数和组结果只覆盖本次选中范围。`--list --group <组名>` 可在不调用 Git、Docker、
PostgreSQL 或子测试 runner 的情况下预览同一选择。

不提供 `--group` 的全量入口先生成 Prisma Client 并构建 API，然后按清单串行调用 15 组 runner。前 14 组保持独立收据；`remaining_dynamic_postgresql16` 由
`run-database-dynamic-remaining-local.cjs` 再按专库和环境开关拆成 17 个子组，覆盖 149 条动态用例。
每个 runner 自建仅绑定 `127.0.0.1` 的一次性 PostgreSQL 16 容器/数据库并自行清理；任一组失败即停止。
最终标准输出是一行机器可读 JSON 收据，固定登记候选 SHA、迁移基线、镜像 ID、实际执行组及其测试覆盖。

排查或票据级验证可以直接对第 14 组 runner 指定一个精确子组，例如
`node services/api/prisma/run-database-dynamic-remaining-local.cjs --group generic_database_constraints`。
未知、重复或其他参数均失败关闭；不带参数时仍执行全部子组，不能用子组收据冒充全量收据。

严禁把生产库、自然生产库、生产备份恢复库或远程 Docker endpoint 用作本入口目标。本入口也不会触发生产自然备份。

## 当前覆盖

canonical manifest 当前登记 53 个文件、237 条 pending tests，全部已有本机 PostgreSQL 16 runner，`remaining=0`。其中 `operating_projection_pol108` 覆盖 1 个文件、8 条用例，`remaining_dynamic_postgresql16` 覆盖 37 个文件、149 条用例。

#284 的 `participant_history_integrity` 子组使用独立数据库 `jiangkong_participant_history_integrity_test`，在同一文件内执行原有经营档案 17 条与参与公司历史完整性 13 条，共登记 30 条；完整 Jest 文件另含 2 条非 pending 的错误映射守卫，因此专组执行时显示 32/32。其中包含激活时拒绝未来覆盖断点、允许半开区间无缝接续，以及以最小运行时角色 `SET ROLE` 执行合法停止/删除、拒绝直接写 fence 表的权限回归：

```bash
node services/api/prisma/run-database-dynamic-remaining-local.cjs \
  --group participant_history_integrity
```

该子组同时固定 `RUN_PROJECT_OPERATING_PROFILE_DB_TESTS=1`、`RUN_PARTICIPANT_HISTORY_INTEGRITY_DATABASE=1` 和各自数据库 URL，并继承经营账写入密钥门禁。完整文件、测试数和 runner 映射始终以 `database-dynamic-gate-manifest.json` 为准。

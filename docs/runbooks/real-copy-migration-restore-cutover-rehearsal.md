# 真实副本无损迁移、恢复与切换演练手册

正式样本演练使用同一业务时间点的数据库与附件版本，核对原记录、在途审批签字和附件字节。
[切换技术方案 D10](../plans/2026-11-05-enterprise-simplification-technical-plan.md#d10真实资料保留迁移及上线切换)

已完成的真实派生副本演练及当前缺项见[Issue #424 恢复与切换证据索引](../progress/2026-11-24-issue-424.md#恢复与切换证据索引)。
下文的 328 基线和 261 → 277 步骤记录 2026-11-24 的 PostgreSQL 16 虚构副本演练。
后续演练的候选、迁移账及样本范围以各自回执为准。

本手册**不授权**连接生产、读取真实备份、迁移真实数据、部署或发布。生产执行必须
另行取得对精确候选 SHA、目标环境、备份、恢复演练和业务写入的授权。演练数据必须
是脱敏/虚构副本，不得把真实业务金额、账号、文件或签字带入演练库。

## 1. 固定输入与边界

| 项 | 值 |
| --- | --- |
| 代码基线 | 执行分支 tip（本次 `line-am-424`，基线 `3640ece6e`） |
| 迁移总数 | 328（`services/api/prisma/migrations/` 下 328 个目录） |
| 旧副本前缀 | 261，终点 `20261111140000_contract_direct_upward_retention_acl_source_v3` |
| 增量迁移 | 67 条（262–328） |
| 数据库 | 一次性 `postgres:16`，仅监听 `127.0.0.1` 随机端口 |
| 数据 | 虚构多公司/项目/合同/结算/付款/采购/历史接管/审计 |

为什么旧前缀取 261：这是企业简化批次（2026-11-18 起）之前最后一个迁移，与仓库
既有 `current259/current261` 技术前置对齐。必须用**同一前缀**构建旧副本，不能用
当前 Schema 反推。

前置检查：

```bash
git status --porcelain                # 必须为空
ls -d services/api/prisma/migrations/*/ | wc -l   # 328
docker image inspect --format '{{.Id}}' postgres:16
docker ps -q                          # 记录开始前的运行容器，仅用于区分并行演练
test "${NODE_ENV:-}" != production
```

## 2. 构建 261 前缀旧副本

普通 `prisma migrate deploy` 无法从空库重放到 261：迁移
`20261108220000_contract_archive_v2_authority` 要求生产归档应用角色/ACL 供应，
`20261118221000` 与 `20261118223000` 还要求生产归档安装器的函数前态/闭包行。
因此旧副本必须复用仓库 CI 的 staged migration fixture（它会在 204 前安装 ACL/角色，
在 213/215/218/221 执行 tail qualification）。

1) 生成 261 前缀目录（schema、lock 与前 261 个迁移目录逐字复制）：

```bash
DRILL_ROOT=$(mktemp -d /tmp/jg424-drill.XXXXXX)
PREFIX="$DRILL_ROOT/legacy261"
mkdir -p "$PREFIX/migrations"
cp services/api/prisma/schema.prisma "$PREFIX/schema.prisma"
cp services/api/prisma/migrations/migration_lock.toml "$PREFIX/migrations/"
i=0
for d in $(ls -d services/api/prisma/migrations/*/ | sort); do
  i=$((i+1)); [ $i -gt 261 ] && break
  cp -R "$d" "$PREFIX/migrations/$(basename "$d")"
done
test "$(ls "$PREFIX/migrations" | wc -l)" -eq 262   # 261 目录 + lock
```

2) 启动一次性容器并通过 staged fixture 重放：

```bash
DRILL_ROOT="$DRILL_ROOT" LEGACY_SCHEMA="$PREFIX/schema.prisma" \
  node docs/progress/evidence/2026-11-24-issue-424/build-legacy-replica.cjs
```

脚本在启动前将本轮容器名、标签值和本地 Docker 地址写入 `container-ownership.json`。若启动或就绪检查失败，按记录的容器名和标签核对归属，再清理本轮容器。脚本只创建自己的容器（标签 `jg.local-ci-dynamic-migration`），输出
`LEGACY_261_APPLIED` 和 `containerId`，并把连接信息写入
`$DRILL_ROOT/container.json`（0600，含随机密码，演练结束必须删除）。

```bash
CID=$(node -p "require('$DRILL_ROOT/container.json').containerId")
DB=jiangkong_line_a_real_db
docker exec "$CID" psql -U jiangkong -d "$DB" -tAc \
  "select count(*), max(migration_name) from _prisma_migrations where finished_at is not null"
```

判据：计数 **261**，终点为上表前缀终点，且不存在 `finished_at is null` 的行。
不满足则停止，不要继续灌数据。

## 3. 载入虚构数据

```bash
python3 docs/progress/evidence/2026-11-24-issue-424/seed.generate.py "$DRILL_ROOT/seed.sql"
docker exec -i "$CID" psql -U jiangkong -d "$DB" -v ON_ERROR_STOP=1 -X -q -f - \
  < "$DRILL_ROOT/seed.sql"
```

种子以 `SET LOCAL session_replication_role = replica` 关闭业务触发器（模拟旧应用
已写入的历史快照），但所有 NOT NULL/CHECK/唯一约束仍生效；外键由种子保证一致。
灌入后必须复核，不能只看“插入成功”：

```sql
select 'AuditLog',count(*) from "AuditLog" union all
select 'OperatingTakeoverRow',count(*) from "OperatingTakeoverRow" union all
select 'Contract',count(*) from "Contract" union all
select 'Settlement',count(*) from "Settlement" union all
select 'PaymentExecution',count(*) from "PaymentExecution";
```

判据（本次实测）：`AuditLog=20000`、`OperatingTakeoverRow=12000`、`Contract=80`、
`Settlement=120`、`PaymentExecution=360`；孤儿结算/申请/执行、付款合计不一致、
血缘跨合同、结算行合计不一致均为 **0**。任何一项非 0 时停止并修正种子，不得用
改金额或删行让检查通过。

## 4. 只读基线与可恢复备份

```bash
docker exec -i "$CID" psql -U jiangkong -d "$DB" -X -A -t -v ON_ERROR_STOP=1 -f - \
  < docs/progress/evidence/2026-11-24-issue-424/metrics.sql > "$DRILL_ROOT/metrics-pre.txt"
docker exec "$CID" pg_dump -Fc -U jiangkong -d "$DB" > "$DRILL_ROOT/pre.dump"
shasum -a 256 "$DRILL_ROOT/pre.dump"
```

`metrics.sql` 输出三类稳定口径：

- `H|表名|行数|md5`：21 张关键表按**旧列清单**计算的整表内容摘要；
- `M|...`：合同/结算/付款/接管/审计及公司、项目维度金额合计；
- `I|...`：结算→版本、申请→结算、执行→申请、付款合计、血缘、审计、文件摘要。

恢复并比对（必须使用独立库名，禁止覆盖源库）：

```bash
docker exec "$CID" createdb -U jiangkong jg424_restore_pre
docker exec -i "$CID" pg_restore -U jiangkong -d jg424_restore_pre --exit-on-error \
  < "$DRILL_ROOT/pre.dump"
docker exec -i "$CID" psql -U jiangkong -d jg424_restore_pre -X -A -t -v ON_ERROR_STOP=1 -f - \
  < docs/progress/evidence/2026-11-24-issue-424/metrics.sql > "$DRILL_ROOT/metrics-restore-pre.txt"
diff -u "$DRILL_ROOT/metrics-pre.txt" "$DRILL_ROOT/metrics-restore-pre.txt"
```

判据：`diff` 为空。否则备份不可信，停止迁移。

## 5. 前向迁移（261 → 可达的 277）

设置 fixture 技术角色（该角色由 staged fixture 创建；生产由安装器负责，不能照抄）：

```bash
APP_OID=$(node -p "require('$DRILL_ROOT/staged-handle.json').setup.appOid")
OWNER_OID=$(docker exec "$CID" psql -U jiangkong -d postgres -tAc \
  "select oid from pg_roles where rolname='jiangkong'")
docker exec "$CID" psql -U jiangkong -d postgres -c \
  "ALTER DATABASE $DB SET app.contract_archive_v2_application_role_oid = '$APP_OID'"
docker exec "$CID" psql -U jiangkong -d postgres -c \
  "ALTER DATABASE $DB SET app.contract_archive_v2_file_caller_oids = '[$OWNER_OID]'"
export HOME="$DRILL_ROOT/home" XDG_CACHE_HOME="$DRILL_ROOT/home/.cache" CHECKPOINT_DISABLE=1
export DATABASE_URL="postgresql://jiangkong:<从 container.json 读取>@127.0.0.1:<port>/$DB?schema=public"
```

### 5.1 第一道门：`20261118221000_contract_legacy_guard_relation_namespace`

```bash
pnpm --filter @jiangkong/api exec prisma migrate deploy \
  --schema prisma/schema.prisma
```

预期在 `20261118221000` 失败（错误为 `query returned no rows`：干净重放没有
生产安装器写入的函数前态）。这是**已知的安装器前置**，按以下受控步骤继续：

```bash
docker exec -i "$CID" psql -U jiangkong -d "$DB" -v ON_ERROR_STOP=1 -f - \
  < services/api/prisma/line-a-replay-archive-install-shim.sql
pnpm --filter @jiangkong/api exec prisma migrate resolve --rolled-back \
  20261118221000_contract_legacy_guard_relation_namespace
pnpm --filter @jiangkong/api exec prisma migrate deploy \
  --schema prisma/schema.prisma
```

shim 只复现生产安装器对三个函数体的精确前后态；前态不匹配会拒绝执行。它不写业务
数据、不授予新权限。

### 5.2 第二道门：`20261118223000_contract_normal_generated_archive_assignment_lock`

继续迁移会在 `20261118223000` 停止：

```text
ERROR: NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_SCOPE
```

原因：`public.jg_contract_direct_upward_closure_v2` 必须恰有一行安装闭包。
较早的迁移定义受控安装例程，普通 Prisma 重放不会调用该例程。应从新的隔离副本运行
仓库的归档安装链（`.github/task12-install-295/contract-finance`），该链在适用的
历史前缀使用专用数据库角色、TLS 和实际安装读回生成闭包，再顺序迁移。**不得**手工插入伪造闭包行，也不得用
`migrate resolve --applied` 假装应用；那会让后续校验、审计和文件归属全部失真。

处置：把失败尝试标记为回滚，保留干净的 277 迁移账：

```bash
pnpm --filter @jiangkong/api exec prisma migrate resolve --rolled-back \
  20261118223000_contract_normal_generated_archive_assignment_lock
pnpm --filter @jiangkong/api exec prisma migrate status   # 预期 exit 1，剩余 51 条待应用
```

判据：

```sql
select count(*) filter (where finished_at is not null)                as applied,
       count(*) filter (where rolled_back_at is not null)             as rolled_back,
       count(*) filter (where finished_at is null and rolled_back_at is null) as pending
from _prisma_migrations;
```

本次实测：`277 / 2 / 0`，无重复 finished 名称。若真实授权环境已执行生产归档安装器，
可在已授权的隔离环境复验 278。后续逐段验证，以当前候选的逐段回执定位后值偏差。安装器执行前不得继续。

## 6. 迁移后校验

```bash
docker exec -i "$CID" psql -U jiangkong -d "$DB" -X -A -t -v ON_ERROR_STOP=1 -f - \
  < docs/progress/evidence/2026-11-24-issue-424/metrics.sql > "$DRILL_ROOT/metrics-post.txt"
diff -u "$DRILL_ROOT/metrics-pre.txt" "$DRILL_ROOT/metrics-post.txt"
```

预期 `diff` 只包含新增表（本次 18 张，如 `PublicCashCustody`、
`RegisteredFundTransfer`、`ProjectOwnerSettlementEntry`）和
`_prisma_migrations` 行数变化；**所有旧表的行数、内容摘要、金额、审计摘要、血缘
检查必须完全一致**。本次 330 张旧表变化数 0，H/M/I 不一致数均为 0。

任何差异都按“停写、导出差异、保留新事实、前向修复”处理；不得用旧备份覆盖来
消除差异。

## 7. 恢复演练（迁移后）

```bash
docker exec "$CID" pg_dump -Fc -U jiangkong -d "$DB" > "$DRILL_ROOT/post.dump"
docker exec "$CID" createdb -U jiangkong jg424_restore_post
docker exec -i "$CID" pg_restore -U jiangkong -d jg424_restore_post --exit-on-error \
  < "$DRILL_ROOT/post.dump"
docker exec -i "$CID" psql -U jiangkong -d jg424_restore_post -X -A -t -v ON_ERROR_STOP=1 -f - \
  < docs/progress/evidence/2026-11-24-issue-424/metrics.sql > "$DRILL_ROOT/metrics-restore-post.txt"
diff -u "$DRILL_ROOT/metrics-post.txt" "$DRILL_ROOT/metrics-restore-post.txt"
```

判据：`diff` 为空。生产恢复还必须核对角色/ACL、扩展、数据库级 GUC、文件存储
（COS 对象版本）与业务时间点；本演练只覆盖数据库逻辑内容。

完整 329 条迁移的普通付款演练已复用[封存恢复入口的分段方式](../../.github/task12-install-295/contract-finance/restore/restore.cjs)，
按 `pre-data`、`data`、`post-data` 顺序各自提交，并保留完整迁移账和全部触发器。
单事务恢复曾在安装 `RegisteredFundTransfer_consistency` 时失败。分段恢复通过后，
在同一恢复库完成普通付款盘点、冻写、切换与公开签批。[329 隔离回执](../progress/2026-11-24-issue-424.md#普通付款-329-全量安装后的恢复接续)

## 8. 数据库连接权限与增量恢复预演

1) 检查新连接能否被拒绝。以下命令只用于本演练新建的虚构数据库。正式冻写验收还需停止应用写入、排空连接池并验证已有写事务无法继续提交。

```bash
APP_ROLE=$(node -p "require('$DRILL_ROOT/staged-handle.json').plan.appName")
docker exec "$CID" psql -U jiangkong -d "$DB" -c \
  "REVOKE CONNECT ON DATABASE $DB FROM PUBLIC; REVOKE CONNECT ON DATABASE $DB FROM \"$APP_ROLE\""
docker exec "$CID" psql -U jiangkong -d "$DB" -tAc \
  "select has_database_privilege('$APP_ROLE','$DB','CONNECT')"   # 必须 f
```

owner 仍可连接（迁移/核对会话）；重新跑 `metrics.sql` 必须与冻结前一致；迁移账
不得有 pending 行。

在恢复写入前，可对本次虚构恢复副本 `jg424_restore_post` 盘点在途旧合同审批。准备同一
演练目录下的 `contract-signature-files` 本地签名副本和第 7 节的两份一致指标。通过
`ISSUE424_CONTRACT_PLAN_READER_URL` 提供同一容器内 `jg424_contract_reader` 的连接配置。
该账号使用默认只读事务，对 `ContractVersion`、`ApprovalInstance`、`ApprovalActionLog`、
`ApprovalDelegation`、`HandwrittenSignatureVersion` 和 `FileObject` 授予读取权限即可。

```bash
DRILL_ROOT="$DRILL_ROOT" pnpm --silent --filter @jiangkong/api inspect:issue424-contract-cutover
```

留存一行汇总 JSON。缺候选人证据、签名文件或存在歧义的旧轮次需核对原资料，盘点不启用并联审批。

普通合同付款可在同一虚构恢复副本盘点结算付款、已签结算付款、合同预付款和合同直接付款。
沿用本地签名副本和两份恢复指标。用 `ISSUE424_PAYMENT_PLAN_READER_URL` 提供独立
`jg424_payment_reader` 账号，默认事务为只读。该账号只需读取 `PaymentRequest`、
`ApprovalInstance`、`ApprovalActionLog`、`HandwrittenSignatureVersion` 和 `FileObject`。

```bash
DRILL_ROOT="$DRILL_ROOT" pnpm --silent --filter @jiangkong/api inspect:issue424-payment-cutover
```

留存汇总 JSON。`replayed` 表示可回放原审批事实；按阻断原因核查原动作和签名，不据此开放并联审批。

固定的普通付款小演练在独占 PostgreSQL 16 容器创建一个虚构付款，备份并恢复至
`jg424_restore_post`。它沿用只读盘点的恢复身份和签名校验，验证停写时的审批轮次校验和并联写入，
随后恢复本机审批入口。演练固定使用本地私有签名文件和 `db push` 建立的库结构，范围限于该笔虚构付款。

```bash
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api build
NODE_ENV=test node docs/progress/evidence/2026-11-24-issue-424/rehearse-ordinary-payment.cjs
```

核对回执中的 `COMPLETE` 和容器清理结果。切换前后原付款和签名一致，应有一条切换审计和两条
待办通知。重复切换沿用原回执，过期坐标拒绝，解冻后财务可先于项目经理签批，重复签批返回 403。

2) 在本演练新建库中恢复初始连接权限，使用 owner SQL 构造恢复校验数据。执行前核对初始 ACL 与以下 GRANT 一致。正式开放验收需由应用身份走公开写入口。

```bash
docker exec "$CID" psql -U jiangkong -d "$DB" -c \
  "GRANT CONNECT ON DATABASE $DB TO PUBLIC; GRANT CONNECT ON DATABASE $DB TO \"$APP_ROLE\""
docker exec -i "$CID" psql -U jiangkong -d "$DB" -v ON_ERROR_STOP=1 \
  -f - < docs/progress/evidence/2026-11-24-issue-424/increment.sql
```

`increment.sql` 适用于独立虚构副本，固定标识的插入在一个事务内执行。标识冲突时整笔失败，已有记录保留。此处用于恢复比较，应用重跑的业务幂等仍需独立验证。脚本写入一张新合同/版本（`numericProtocolVersion=2`、
`amountYuan=1234.5678`）、一份结算草稿、一个资金账户和两条审计。判据：
`Contract 80→81`、`ContractVersion 107→108`、`Settlement 120→121`、
`RegisteredFundAccount 0→1`、`AuditLog 20000→20002`；未涉及的旧表摘要保持一致。涉及新增行的表需按原记录范围另行比较。

3) 切换后备份并恢复：重复第 7 节（文件名改 `postcut.dump`），除增量外
`diff` 为空；增量必须存在于恢复副本。

## 9. 回滚演练

### 9.1 写前回滚（可执行）

```bash
docker exec "$CID" createdb -U jiangkong jg424_rollback_pre
docker exec -i "$CID" pg_restore -U jiangkong -d jg424_rollback_pre --exit-on-error \
  < "$DRILL_ROOT/pre.dump"
docker exec -i "$CID" psql -U jiangkong -d jg424_rollback_pre -X -A -t -v ON_ERROR_STOP=1 -f - \
  < docs/progress/evidence/2026-11-24-issue-424/metrics.sql > "$DRILL_ROOT/metrics-rollback-pre.txt"
diff -u "$DRILL_ROOT/metrics-pre.txt" "$DRILL_ROOT/metrics-rollback-pre.txt"
```

判据：`diff` 为空；迁移账回到 261；增量 ID 不存在；旧版查询（如
`select count(*),sum("amountCents") from "PaymentExecution"`）仍返回
`360 / 306616050`。

### 9.2 写后回滚边界（必须停写并前向修复）

写后直接用旧备份恢复会抹掉切换后的新增合同/结算/账户/审计（本次实测
`AuditLog 20002→20000`、`Contract 81→80`）。因此：

1. 立即停写、保留新库与日志；
2. 导出切换后全部增量（按业务时间点、ID 清单和审计）；
3. 恢复旧备份并重新前向迁移到目标版本；
4. 按清单重放增量，逐项对账；
5. 复核通过后再开放写入。

本演练已验证第 3–4 步：`pre.dump` → 迁移到 277 → 重放 `increment.sql`，其
`metrics` 与切换后主库**逐字节一致**。

## 10. 清理（必须执行）

```bash
docker rm -f -v "$CID"
docker ps -aq --no-trunc --filter "id=$CID"   # 本演练容器必须无输出
```

删除前确认容器 ID 与 `container.json` 一致；只删除本演练容器，不接管、不重启、
不删除其它历史容器或工作树。按本轮记录核对关联卷，随后清理已确认归属本轮的演练目录，其中包括含凭据的临时文件。

## 11. 失败处理矩阵

| 现象 | 处理 |
| --- | --- |
| 261 前缀构建失败/账不符 | 停止；核对迁移目录逐字复制、schema/lock 哈希；不得跳迁移 |
| 204/205 安装器门拒绝 | 说明未使用 staged fixture；停止，不得手工授角色/改迁移 |
| 221000 `query returned no rows` | 应用 `line-a-replay-archive-install-shim.sql`，`resolve --rolled-back` 后重试 |
| 223000 `NORMAL_ARCHIVE_ASSIGNMENT_INSTALL_SCOPE` | 停止；等待生产归档安装器；禁止伪造闭包行或 `resolve --applied` |
| 旧表行数/摘要/金额不一致 | 停止；导出差异；前向修复；不得删行/改金额/旧备份覆盖 |
| 备份恢复 `diff` 非空 | 备份不可信；保留现场，重新备份/恢复；不得继续切换 |
| 冻结后应用仍可连接 | 检查 PUBLIC/角色 CONNECT 与连接池；重新冻结并复验 |
| 切换后增量缺失 | 立即停写，查事务/outbox/审计；保留新事实，前向修复 |
| 容器/磁盘残留 | 只按本演练标签/ID 删除；按记录的容器 ID 与卷名复核 |

## 12. 未覆盖与前置限制

- 328 全量：本次在 277 被生产归档安装器阻断；需在真实安装器执行后继续 278–328。
- 退款、实际采购批次等实体位于 278+ 被阻断段，未在本副本中覆盖。
- 应用层 HTTP/审批/待办/短信/PDF/文件字节与 COS 版本恢复未覆盖；本演练只验证
  PostgreSQL 逻辑数据的迁移、备份、恢复、切换与回滚口径。
- 并发写入、长事务、中断恢复的真实窗口未覆盖；只验证了迁移失败后的
  `resolve --rolled-back` 续跑与账本不重复。

# 正式数据库备份身份与恢复验证

当前契约采用独立只读备份连接。完整备份必须包含受保护的
`OperatingLedgerWriteSecret`、`OperatingLedgerWriteContext`；API 运行角色仍不得直接读取它们。
本契约不改变 Schema、应用角色、归零保护或生产激活门。

## 连接与文件

| 用途 | 正式文件 | 读取范围 |
| --- | --- | --- |
| 独立数据库备份连接 | `/etc/jiangkong/db-backup-database.env` | 唯一 `DATABASE_URL`，文件为备份进程所有、0600、普通非符号链接文件 |
| 业务对象隔离元数据 | `/etc/jiangkong/api.env` | 只解析唯一 `COS_BUCKET`，不采用其中的数据库连接、不执行文件内容 |
| 独立 COS 备份凭据 | `/etc/jiangkong/db-backup.env` | 沿用既有白名单、私有备份 bucket、校验上传与留存规则 |

`run-production-db-backup.sh` 使用 `DB_BACKUP_DATABASE_ENV_FILE`，默认上述独立数据库文件。
旧 `DATABASE_ENV_FILE` 或继承的 `DATABASE_URL`/`PG_DATABASE_URL` 不能替代它。
部署前备份也使用 `DB_BACKUP_DATABASE_ENV_FILE`；`BUSINESS_ENV_FILE` 对应 API 文件，保留业务
bucket 拒绝规则。缺少文件、权限不符或解析失败即停止，不回退到 API/owner 连接。

正式入口强制 `DB_BACKUP_READ_ONLY_ROLE_REQUIRED=true`。角色预检运行在只读事务中，只读
系统目录，不创建角色、不执行 grant；拒绝 superuser、数据库创建/角色创建/复制/BYPASSRLS
能力、数据库或用户 schema 创建权、用户表所有权、直接或继承的表写权限及序列 USAGE/UPDATE。
所有用户 schema 的表/序列均须具备完整 SELECT。RLS 等 pg_dump 拒绝仍按失败处理，不排除表或
生成部分成功收据。该预检不是独立控制面签发或正式 Schema 兼容收据。

独立角色的名称、目标数据库、对象创建者与未来对象读取授权由 operator 在新生产授权中锁定。
需要让其读取全部待备份用户表及序列，而不授予业务写权限、对象所有权或应用受控写函数权限。
本交付不自动配置角色、设置口令或修改 default privileges；如既有权限/继承/RLS 与契约冲突，停止
并单独审查。密钥、数据库连接和环境文件原文不进入日志或 Git。

## 本地验证

```bash
node --test scripts/ops/db-backup-read-role.test.mjs
pnpm verify:db-backup-read-role:local --receipt <new-absolute-local-receipt.json>
```

第二条仅使用本机 Docker、官方缓存 postgres:16、网络隔离与 tmpfs，不连接生产、没有宿主目录挂载。
验证真实完整 dump/独立恢复、控制面表与 bigint 精度、API 拒读、危险身份/写权限拒绝、RLS 失败清理
和 root 入口连接分离。它不验证真实 COS 上传、不替代原完整17门或自然 Cron 运行收据。

## 当前生产差距与执行顺序

2026-10-10 的已授权只读快照：正式仓库 `56fd5243`，API停止，配置冻结all；正式PG16有171项
成功迁移，缺当前候选的第172项模板快照迁移；最新备份三件套为9月20日，今日无dump，监控inactive。
日志尾部有 `OperatingLedgerWriteSecret` 权限拒绝；实际当前备份账号及其授权尚未在本地阶段复核。
本地确定性复现证明默认 API 连接与秘密表拒读规则不相容，但不据此猜测全部现场原因。

后续生产操作逐项另行报批，不能直接执行本文作为授权：

1. 对最终合并 SHA 取得原完整本机17门和 merge-head CI，确认现场身份与现有备份/监控安装路径。
2. 核对独立备份角色的准确权限和对象创建者；保存现有配置、脚本、权限及服务状态的私有快照与摘要。
   按精确批准的角色/文件范围配置独立凭据，安装同SHA备份脚本和角色预检文件；API角色保护保持。
3. 单独批准一次备份及私有 COS 写入范围后，运行既有 root 备份入口；核验新三件套、校验和、真实
   pg_restore结构及远端内容哈希。手动补救恢复点与自然 Cron 验收分开记录。
4. 另行批准生产派生隔离恢复，分别验证数据库和私有对象；不把 pg_restore --list 视为真实恢复。
5. 先核实监控停止是否属于维护窗口要求及已有告警通道是否获准发送运维告警，再批准启动 service/timer。
   沿用原调度、去重和安全约束，保存真实自然调度结果；不改时间、伪造收据或触发通知冒充自然成功。
6. 新备份/恢复/角色/冻结证据齐全后，继续 #296 当前候选兼容迁移及收据，再 #122→#123→#124。
   #123 激活阶段要求迁移次数0，不能在那里补执行第172项迁移或调用通用部署入口。

## 失败与回滚

任何身份、权限、凭据、dump、checksum、上传或恢复异常都停止后续迁移/激活，保持维护及写冻结。
备份失败不发布不完整三件套。保留失败日志与既有备份，不调用业务数据清零或恢复业务流量。

回滚只能按预先批准的精确快照恢复本次变动的脚本、配置及监控状态。只撤销本次新增且仍一致的备份
角色授权；不删除或改动未知角色/文件/既有授权。恢复旧脚本并不证明完整备份已恢复，不能放开 API
对秘密表的读取。凭据文件回滚与独立角色撤销需核对所有权及摘要；备份和控制面证据保留。

### 只读能力复核边界

预检同时检查当前身份及PG16允许`SET ROLE`切换的身份，不依赖`INHERIT`标记。备份无需调用应用`SECURITY DEFINER`入口，因此可直接调用的用户schema定义者权限函数/过程只要具有EXECUTE即拒绝（包括PUBLIC、继承及可切换角色授予）；不按函数名或volatility猜测其是否安全。仅触发器专用返回类型不属可直接调用入口。只读成员关系可保留，任何写入/所有者能力均停止，不自动撤权或修改业务函数。

此外拒绝可切换身份持有的ADMIN OPTION角色管理权、数据库/schema/关系所有权（含撤销自身CREATE后仍保留的所有权）和PG16服务器执行、写文件、信号、checkpoint、写全库及订阅管理角色能力。只读连接不应具有这些运维或升级通道。PG16身份切换、成员管理及所有者语义按[系统权限函数](https://www.postgresql.org/docs/16/functions-info.html)、[GRANT](https://www.postgresql.org/docs/16/sql-grant.html)及[预定义角色](https://www.postgresql.org/docs/16/predefined-roles.html)核验；本地回归不证明生产角色符合契约。

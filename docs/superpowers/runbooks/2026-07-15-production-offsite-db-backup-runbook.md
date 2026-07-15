# 建工智管生产数据库异机 COS 备份与恢复手册

日期：2026-07-15

状态：发布前 P0 操作手册；仓库能力已实现，云端桶、CAM、生产安装和真实恢复尚待执行。

## 1. 不可违反的边界

- 数据库备份桶必须独立于业务文件桶和访问日志桶。
- 不得把数据库备份凭据写入 API 环境文件、GitHub Secrets、仓库、日志或命令参数。
- API 进程继续只使用业务文件桶 CAM；数据库备份 CAM 只由 root 备份任务读取。
- 生产迁移前必须同时存在本地 dump、SHA-256 和 `.offsite.json` 收据；任一缺失都不得停止 API 或执行迁移。
- 恢复只能进入实际连接名为 `jiangkong_restore_*` 的空数据库，禁止对正式库运行恢复或 `prisma migrate reset`。
- 本手册中的占位值不得原样用于生产。

## 2. 腾讯云资源

### 2.1 独立备份桶

建议创建：

| 项目 | 要求 |
| --- | --- |
| 桶名 | `jiangkong-prod-db-backups-1438687719` |
| 地域 | 成都 `ap-chengdu` |
| 访问权限 | 私有读写 |
| 服务端加密 | SSE-COS；上传器同时对每个对象显式请求 `AES256` |
| 版本控制 | 开启 |
| CDN / 静态网站 / 回源 | 全部关闭 |
| 访问日志 | 写入现有独立日志桶的专用前缀；不得写回业务桶或备份桶自身 |
| 生命周期 | P0 至少保留 30 天；不得在首次真实恢复演练完成前启用自动删除 |

腾讯云官方说明：COS 版本控制可保留同名对象的不同版本并支持还原；生命周期可用于历史版本清理。参见：[版本控制配置](https://cloud.tencent.com/document/product/436/19884)、[数据安全概述](https://cloud.tencent.com/document/product/436/50200)。

### 2.2 独立 CAM

为备份任务创建独立 CAM 密钥，只授权下列操作：

- `name/cos:PutObject`
- `name/cos:HeadObject`
- `name/cos:GetObject`

资源必须收敛到：

```text
qcs::cos:ap-chengdu:uid/1438687719:jiangkong-prod-db-backups-1438687719/database-backups/*
```

首轮 P0 不授予 `DeleteObject`、ACL、桶配置、业务 `uploads/*` 或日志桶权限。上传、元数据验证和下载所需 action 可对照腾讯云官方的[上传对象](https://cloud.tencent.com/document/product/436/112224)、[下载对象](https://cloud.tencent.com/document/product/436/112225)和[查询对象元数据](https://cloud.tencent.com/document/product/436/65941)。

策略模板：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "name/cos:PutObject",
        "name/cos:HeadObject",
        "name/cos:GetObject"
      ],
      "resource": [
        "qcs::cos:ap-chengdu:uid/1438687719:jiangkong-prod-db-backups-1438687719/database-backups/*"
      ]
    }
  ]
}
```

创建后必须使用 CAM 策略模拟器或实际最小权限账号确认：目标前缀 PUT/HEAD/GET 成功；删除、桶配置、业务桶和日志桶访问全部失败。

## 3. 生产服务器安装

以下步骤必须在目标候选 SHA 已位于 `/opt/jiangkong` 后执行，但不需要启动生产部署。

1. 复制示例并仅在服务器本地填写真实值：

   ```bash
   sudo install -o root -g root -m 600 \
     /opt/jiangkong/scripts/ops/db-backup.env.example \
     /etc/jiangkong/db-backup.env
   sudoedit /etc/jiangkong/db-backup.env
   ```

2. 确认权限和配置文件没有被 Git 跟踪：

   ```bash
   sudo stat -c '%A %U %G %n' /etc/jiangkong/db-backup.env
   git -C /opt/jiangkong status --short
   ```

3. 安装 root 专用每日任务。先保留旧任务，手工验证新命令成功后再替换：

   ```bash
   sudo env \
     DATABASE_ENV_FILE=/etc/jiangkong/api.env \
     DB_BACKUP_ENV_FILE=/etc/jiangkong/db-backup.env \
     DB_BACKUP_OFFSITE_REQUIRED=true \
     BACKUP_DIR=/srv/jiangkong-backups/db \
     /opt/jiangkong/scripts/ops/db-backup.sh
   ```

   命令成功后应输出一个本地 `.dump` 路径，并同时生成：

   ```text
   <dump>
   <dump>.sha256
   <dump>.offsite.json
   ```

4. 检查收据只含桶、地域、对象键、大小、哈希和上传时间，不含 Secret：

   ```bash
   sudo python3 -m json.tool <dump>.offsite.json
   ```

5. 手工命令验证后，将 root crontab 中原 `02:30` 本机备份命令替换为仓库受控入口；`db-backup.sh` 自身使用 `flock`，定时任务与发布前备份不能重叠执行：

   ```cron
   30 2 * * * /opt/jiangkong/scripts/ops/run-production-db-backup.sh >> /var/log/jiangkong-backup.log 2>&1
   ```

## 4. 上传成功判定

`db-backup.sh` 的执行顺序固定为：

1. 生成 PostgreSQL custom dump。
2. 校验非空并执行 `pg_restore --list`。
3. 生成本地 SHA-256，权限固定为 `600`。
4. 上传 dump，COS 返回成功后执行 HEAD 校验大小、SHA 元数据和 SSE-COS。
5. 重新 GET 完整远端对象并计算 SHA-256，确认远端真实内容可读。
6. 对 `.sha256` 文件重复 PUT、HEAD、GET 校验。
7. 最后原子生成 `.offsite.json` 收据。

每个对象最多进行 3 次完整上传与验证，短暂网络错误会重试；3 次失败仍会阻断。上传器使用腾讯云简单 PUT，按官方接口上限在文件超过 5 GiB 时提前失败，届时必须先升级为分块上传，不得绕过校验门禁。参见：[PUT Object](https://cloud.tencent.com/document/product/436/7749)、[公共请求头部](https://cloud.tencent.com/document/product/436/7728)、[对象加密](https://cloud.tencent.com/document/product/436/63744)。

任一步失败：

- 命令以非零状态退出；
- 已验证的本地 dump 和 checksum 保留；
- 不生成 `.offsite.json`；
- 部署脚本在停止 API 和数据库迁移前终止；
- 可能存在没有配对 checksum 的远端孤儿 dump，后续按对象键人工核查，不自动删除。

## 5. 从 COS 下载并进行真实恢复

1. 从 `.offsite.json` 取得 `backupObjectKey`、`checksumObjectKey`、`backupSha256` 和 `checksumSha256`。不得把 Secret 打印到终端历史或工单。

2. 在 root 的临时目录下载 checksum 和 dump；以下值均来自收据：

   ```bash
   sudo install -d -o root -g root -m 700 /srv/jiangkong-restore-download
   sudo node /opt/jiangkong/scripts/ops/cos-backup-transfer.mjs download \
     --file /srv/jiangkong-restore-download/<dump>.sha256 \
     --object-key <checksumObjectKey> \
     --sha256 <checksumSha256> \
     --env-file /etc/jiangkong/db-backup.env
   sudo node /opt/jiangkong/scripts/ops/cos-backup-transfer.mjs download \
     --file /srv/jiangkong-restore-download/<dump> \
     --object-key <backupObjectKey> \
     --sha256 <backupSha256> \
     --env-file /etc/jiangkong/db-backup.env
   ```

   上传器只按数据解析 root `600` 配置文件中的五个白名单键，不执行其中的 shell 内容；禁止把真实密钥直接拼到命令行，最终演练记录不得包含环境值。

3. 新建隔离数据库，并确认名称和连接目标：

   ```text
   jiangkong_restore_YYYYMMDD
   ```

4. 使用一个干净的候选代码检出执行恢复门禁，并将恢复库升级到精确候选 SHA。候选检出可以位于受控临时目录，不要求替换当前生产运行时；检出必须没有任何 tracked 或 untracked 修改，并已完成 `pnpm install --frozen-lockfile`。在 root 维护 shell 中交互读取隔离库连接串，避免把密码写入命令历史：

   ```bash
   sudo -i
   umask 077
   set -o pipefail
   read -rsp '隔离恢复库连接串: ' RESTORE_DATABASE_URL
   printf '\n'
   export RESTORE_DATABASE_URL

   RESTORE_DATABASE_NAME_CONFIRMATION='jiangkong_restore_YYYYMMDD' \
   BACKUP_FILE='/srv/jiangkong-restore-download/<dump>' \
   APPLY_CANDIDATE_MIGRATIONS=true \
   CANDIDATE_REPO_ROOT='<候选代码绝对路径>' \
   CANDIDATE_SHA_CONFIRMATION='<待最终批准的固定 40 位候选 SHA>' \
   '<候选代码绝对路径>/scripts/ops/db-restore-drill.sh' \
     | tee /srv/jiangkong-restore-download/restore-evidence.txt

   unset RESTORE_DATABASE_URL
   ```

   脚本会先在任何数据恢复前核对候选检出的精确 SHA 和工作区洁净度；恢复完成后以同一隔离连接执行候选 `prisma migrate deploy` 与 `prisma migrate status`，并要求数据库已完成迁移数与候选目录中的 `migration.sql` 数量完全一致。输出证据包含隔离库名、备份文件名/哈希、迁移前数量、候选 SHA、候选迁移数量、最终迁移数量和核心表计数，不输出数据库连接串。

5. 记录但不提交敏感值：远端对象键、dump 大小、开始/结束时间、RPO、RTO、执行人和复核人；候选 SHA、SHA-256、迁移数量与核心表计数由脚本输出固定证据。

6. 删除隔离库与临时下载文件前，第二人复核恢复记录。不得删除 COS 对象。

## 6. 发布硬门禁

`deploy-production-server.sh` 默认以 root 身份读取：

```text
/etc/jiangkong/api.env
/etc/jiangkong/db-backup.env
```

数据库环境文件只按数据解析 `DATABASE_URL` 和用于隔离校验的 `COS_BUCKET`，不会作为 shell 脚本执行；备份配置只接受五个 `DB_BACKUP_COS_*` 键和本地保留天数白名单键。凭据文件必须是绝对路径、非符号链接、无组/其他权限，备份凭据文件必须由 root 拥有。每次 COS 请求有 120 秒硬超时，超时按失败处理并进入既定重试或部署阻断流程。

部署流程强制 `DB_BACKUP_OFFSITE_REQUIRED=true`，无法通过配置文件关闭。只有本地 dump、checksum 和远端收据全部非空后，才会停止 API、执行 Prisma 迁移和替换运行时。

## 7. Go / No-Go 证据

以下证据全部齐全后，才可关闭数据库异机备份 P0：

- 独立桶配置截图：私有、成都、SSE-COS、版本控制、生命周期。
- 独立 CAM 策略和拒绝测试，不包含 Secret 值。
- root 凭据文件权限证据。
- 一次定时任务备份和一次发布前备份的 `.offsite.json` 收据。
- 从 COS 完整下载并恢复到 `jiangkong_restore_*` 的记录。
- 恢复脚本绑定最终候选 SHA，`pg_restore --list`、候选 Prisma 迁移部署/status、精确迁移数量和核心表计数全部通过。
- RPO/RTO 与执行人、复核人记录。
- 业务、财务、合同、项目和技术最终 Go / No-Go 签认。

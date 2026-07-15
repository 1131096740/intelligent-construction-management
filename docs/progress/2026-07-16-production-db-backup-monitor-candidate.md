# 生产数据库异机备份失败/陈旧告警候选

日期：2026-07-16

状态：本地实现和测试完成；未推送、未部署、未修改生产配置或业务数据。候选 SHA 以本轮交付回复为准。

## 1. 目标与基线

- 生产运行时与 `origin/main` 当前均为 `b857a4269aa907e0550470cece52c846bcbb7623`，生产数据库已完成 51 个迁移。
- 永久每日 03:00 异机日备与每月 1 日 03:30 异机月备保持原样。
- 2026-07-16 首次自然 03:00 日备已经通过：`jiangkong-20260716-030001.dump` 为 254,832 字节、440 项，dump/checksum/收据均为 `600 root:root`，上传时间为 03:00:02，日志无失败词。
- 现有 `/etc/jiangkong/healthcheck.env` 已配置生产告警通道，但此前没有数据库备份专用失败、陈旧、完整性和恢复通知。

## 2. 实现范围

| 文件 | 职责 |
| --- | --- |
| `scripts/ops/check-production-db-backup.mjs` | 只读分析最新日备收据、配套 dump/checksum、时间窗口、权限、对象键、大小、哈希和 PostgreSQL dump 结构 |
| `scripts/ops/check-production-db-backup.sh` | root 入口、SMTP/Webhook 通知、故障指纹去重、恢复通知和验证缓存原子写入 |
| `scripts/ops/check-production-db-backup.test.mjs` | 正常、失败、陈旧、损坏、缓存、去重和恢复回归测试 |
| `scripts/ops/systemd/jiangkong-db-backup-monitor.service` | root oneshot、复用现有告警环境、只读备份目录和受限 systemd 沙箱 |
| `scripts/ops/systemd/jiangkong-db-backup-monitor.timer` | 每 15 分钟、持久化调度，确保服务器重启后补检 |
| `scripts/ops/go-live-safety-self-test.sh` | 将新监控测试纳入既有生产运维安全门禁 |
| `docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md` | 安装、验收、回滚和生产边界 |

没有修改 `services/api`、`apps/web-admin`、Prisma、迁移、数据库、路由、权限、金额、文件上传、现有备份 cron 或 COS API。

## 3. 判断口径

1. 03:15 前，最新有效收据不得超过 26 小时。
2. 03:15 后，必须存在生产当地日期当天、02:50 之后上传的日备收据；补做的当天受控备份可以恢复健康。
3. 最新收据必须是受控备份目录中的 root `600` 普通文件，配套 dump/checksum 同样必须为 root `600` 普通文件。
4. 收据必须指向获批的成都生产备份桶及 `database-backups/daily/`，对象文件名必须与本地文件一致。
5. dump 大小、dump SHA-256、checksum SHA-256 和 checksum 内容必须互相一致。
6. 每个新 dump 必须通过 `pg_restore --list`；验证缓存只在同一批文件的设备号、inode、大小、mtime 和 ctime 全部未变化时生效。
7. 同一故障只通知一次；故障内容变化时重新通知；恢复后通知一次并清除活动告警。
8. 通知通道失败时不写“已经送达”的状态，后续 timer 会继续尝试。

## 4. 安全边界

- service 以 root 运行只为读取既有 root `600` 备份证据；备份目录在 systemd 中只读，只有 `/var/lib/jiangkong-db-backup-monitor` 可写。
- 监控不读取 `/etc/jiangkong/db-backup.env`，不接触数据库连接串或 COS CAM Secret。
- 只复用 systemd `EnvironmentFile=-/etc/jiangkong/healthcheck.env` 注入的告警通道；脚本不会输出 SMTP 密码、Webhook 地址或环境内容。
- `pg_restore` 使用参数数组执行，不经过 shell；对象键和文件名只用于比较，不拼接命令。
- 收据、dump、checksum 和状态目录拒绝符号链接或不安全权限；所有状态采用临时文件加原子替换。
- 失败文案明确“无法确认恢复点”而不是错误宣称“数据库没有记录”。

## 5. 测试结果

- `node --test scripts/ops/check-production-db-backup.test.mjs`：13/13 通过。
- 覆盖：正常 03:00 收据、日/月收据共存、非获批 COS 桶/地域、03:15 后当天日备收据缺失、26 小时陈旧、JSON 损坏、权限过宽、dump 哈希失配、`pg_restore` 失败、验证缓存、同故障去重、恢复通知、SMTP/Webhook Secret 不进入进程参数和 systemd unit 约束。
- `bash -n scripts/ops/check-production-db-backup.sh`：通过。
- 新测试已接入 `scripts/ops/go-live-safety-self-test.sh`，最终全量门禁结果在本轮交付回复中记录。

## 6. 生产安装与回滚门禁

- 本候选形成后立即停止在发布候选状态，不推送 `main`、不执行应用部署、不安装 systemd unit。
- 后续必须先由用户批准交付回复中的精确 40 位 SHA，再按运行手册 3.1 节只安装监控脚本和 unit。
- 安装前后都要核对现有 03:00/03:30 cron 文本未变化；首次手工 service 检查必须健康后才能启用 timer。
- 回滚只禁用并移除监控 timer/service 与两个监控脚本；不删除备份、收据、COS 对象，不修改 cron、API 或数据库。
- 状态目录默认保留审计；确认不再需要后才单独删除。

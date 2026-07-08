# P0-5A 生产验收 Runbook

日期：2026-07-03
状态：真实试运行前安全验收清单
范围：Web/API 生产或生产等价环境；覆盖历史接管、项目付款审批表、结算附件模板和综合费用最小闭环；不包含新部署平台、CI/CD 改造、云资源自动开通、真实密钥读取上传或生产数据库自动操作。

## 验收原则

- 先验收能不能安全试运行，再扩大功能。
- 自动脚本只做只读辅助检查：环境变量形态、默认值风险、本机转换器可用性；仅在显式设置 `CHECK_DATABASE_STATE=true` 时做 seed 账号只读查询；不读 COS、不输出密钥值。
- 人工验收必须留痕：负责人、日期、截图或日志路径、问题和整改结论。
- 真实密钥、真实账号密码、COS Secret、数据库连接串完整值不得进入仓库、聊天、截图或共享文档。
- seed 通用密码 `Jgzg@2026` 只允许开发演示使用，真实试运行前必须停用或改掉。

## 自动辅助检查

在源码工作区、生产等价验收工作区，或包含 `services/api/scripts/verify-production-readiness.cjs` 的部署包中加载 API 环境变量后运行；生产最小运行目录若不包含源码脚本，应在发布前的验收工作区留存输出。

```bash
set -a
. /etc/jiangkong/api.env
set +a
pnpm --filter @jiangkong/api verify:production-readiness
# 可选：只读检查 seed 用户和 refresh token 是否停用。
CHECK_DATABASE_STATE=true pnpm --filter @jiangkong/api verify:production-readiness
```

脚本位置：`services/api/scripts/verify-production-readiness.cjs`。

脚本会检查：

- `NODE_ENV` 是否为 `production`；
- `WEB_ORIGIN` 是否为 HTTPS；
- `DATABASE_URL` 是否为 PostgreSQL，是否仍使用默认演示账号；
- `JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`FILE_DOWNLOAD_SECRET` 是否存在且不像默认值；
- 环境变量中是否仍出现 `Jgzg@2026`；
- `FILE_STORAGE_DRIVER` 是否为 `cos`；
- `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION` 是否存在且不像占位值；
- `FILE_UPLOAD_MAX_BYTES` 是否为正整数；
- `DOC_CONVERTER_COMMAND` 是否可执行；
- `DOC_ALLOWED_FONTS` 是否包含合同母版要求字体。

脚本不能证明：

- COS 桶策略一定是私有；
- PostgreSQL 一定不公网暴露；
- 备份一定可恢复；
- HTTPS 证书一定会自动续期；
- 合同母版 DOCX 逐页人工验收已通过；
- 权限矩阵真实账号操作无误。

这些必须按下方人工验收完成。

## 1. 环境变量和密钥检查

| 验收项 | 方法 | 通过标准 | 负责人 | 结果 |
| --- | --- | --- | --- | --- |
| API 运行环境 | 自动脚本 + 进程配置 | `NODE_ENV=production` | 运维 | 待验收 |
| Web 来源 | 自动脚本 | `WEB_ORIGIN` 为正式 HTTPS 域名 | 运维 | 待验收 |
| 数据库连接 | 自动脚本 + 人工复核 | 不使用 `jiangkong/jiangkong` 演示账号；连接生产库或生产等价库 | 运维 | 待验收 |
| JWT 密钥 | 自动脚本 | access / refresh secret 均已配置，非占位、非本地默认 | 运维 | 待验收 |
| 文件下载签票密钥 | 自动脚本 | `FILE_DOWNLOAD_SECRET` 已配置，非占位、非本地默认 | 运维 | 待验收 |
| COS 密钥 | 自动脚本 | Secret ID / Secret Key 仅存在服务器环境或密钥管理处，不入仓 | 运维 | 待验收 |
| 前端环境 | 人工复核构建配置 | Web 构建指向正式 API，不含密钥 | 运维 / 前端 | 待验收 |

人工要求：

- 检查服务器环境文件权限，例如 `/etc/jiangkong/api.env` 仅部署用户或 root 可读。
- 密钥变更后必须重启 API，并确认旧 refresh token 处理策略。
- 如 DNSPod Token 用于证书续期，只能放在服务器专用 env 文件，权限建议 root 600；暴露后立即吊销重建。

## 2. seed 通用密码停用 / 改密

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 环境变量无 seed 密码 | 自动脚本 | 不出现 `Jgzg@2026` | 待验收 |
| seed 账号不可登录 | 人工登录验证 | seed 手机号 + `Jgzg@2026` 登录失败 | 待验收 |
| 真实账号已改密 | 人工账号清单 | 真实试运行用户完成个人密码设置 | 待验收 |
| refresh token 已撤销 | 人工 SQL/后台记录 | 停用 seed 账号的 refresh token 全部 revoked | 待验收 |

建议停用 SQL 已记录在 P0-4A Runbook。执行前必须确认连接的是生产等价或正式生产库；禁止在未确认库名时执行。

## 2.1 Nginx 登录限流和安全响应头

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 登录限流 | Nginx `limit_req` | 连续错误登录出现 429 | 待验收 |
| refresh 限流 | Nginx `limit_req` | 异常 refresh 高频请求出现 429 | 待验收 |
| 安全响应头 | `curl -I` | HSTS、nosniff、frame、referrer、permissions policy 可见 | 待验收 |
| 隐藏版本 | `curl -I` | `Server` 不暴露 `nginx/x.y.z` 版本 | 待验收 |

仓库提供了最小配置片段：`deploy/nginx/jiangkong-security-snippets.conf.example`。落地后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -sI https://jgzg.site/api/health | grep -Ei 'strict-transport|x-content-type|x-frame|referrer-policy|permissions-policy|server'
```

备案完成前可把域名替换为 `https://162.14.116.192` 或服务器本机可访问地址做内部验证。

## 3. COS 私有桶和短时效下载

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 文件存储驱动 | 自动脚本 | `FILE_STORAGE_DRIVER=cos` | 待验收 |
| COS 桶私有 | 腾讯云控制台人工检查 | 桶非公开读写，无匿名访问策略 | 待验收 |
| API 上传 | 人工上传测试 | 文件经后端上传，`FileObject.bucket` 指向 COS 桶 | 待验收 |
| 短时效下载 | 人工下载测试 | 下载前需要登录和当前密码，票据约 5 分钟过期 | 待验收 |
| 公开直链 | 人工测试 | 未经 API 签票不能直接下载对象 | 待验收 |
| 下载审计 | 人工查审计 | 签票和下载动作能查到人、文件、时间 | 待验收 |

注意：脚本只检查配置项，不访问 COS，也不判断桶策略。

最小留痕命令：

```bash
set -a
. /etc/jiangkong/api.env
set +a
CHECK_DATABASE_STATE=true pnpm --filter @jiangkong/api verify:production-readiness
```

COS 抽样验收记录：

| 步骤 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 后端上传 | Web 上传一份非敏感测试附件，记录 `FileObject.id` | 待验收 |
| 存储位置 | `psql "$DATABASE_URL" -c 'select "id","bucket","objectKey" from "FileObject" order by "createdAt" desc limit 1;'` | 待验收 |
| 签票下载 | Web 输入当前密码下载，确认 200 且写 `file.download.ticket` / `file.download` 审计 | 待验收 |
| 匿名直链 | 腾讯云 COS 对象 URL 未签名访问返回 403 / AccessDenied | 待验收 |

## 4. PostgreSQL 不公网暴露

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 迁移状态 | `prisma migrate deploy` / `prisma migrate status` 留痕 | 目标库已应用当前 commit 所需迁移，执行人、时间和输出已记录 | 待验收 |
| 监听地址 | 服务器人工检查 | PostgreSQL 不监听公网地址，或仅在 VPC/本机可达 | 待验收 |
| 安全组 / 防火墙 | 云控制台人工检查 | 5432 不对公网开放 | 待验收 |
| 数据库账号 | 人工复核 | 应用账号最小权限，不使用演示账号 | 待验收 |
| 远程探测 | 外部网络人工验证 | 公网无法连接 5432 | 待验收 |

自动脚本只能识别默认演示账号和明显公网主机风险，不能替代防火墙验收。

## 5. 数据库备份和恢复演练

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 每日备份 | 人工检查计划任务 | 每日至少 1 份，路径和保留周期明确 | 待验收 |
| 备份加密 / 权限 | 人工检查 | 备份文件非公开，权限最小化 | 待验收 |
| 恢复演练 | 人工恢复到临时库 | 能从最新备份恢复到空库，并跑基本查询 | 待验收 |
| 恢复记录 | 人工留痕 | 记录备份文件、恢复目标、耗时、校验结果 | 待验收 |

建议演练流程：

1. 从生产或生产等价库生成一份 `pg_dump --format=custom` 备份。
2. 在隔离临时库恢复，禁止覆盖正式库。
3. 验证关键表数量：`User`、`Project`、`Contract`、`ContractTakeover`、`Settlement`、`PaymentRequest`、`ProjectExpenseRequest`、`FileObject`、`AuditLog`。
4. 删除临时库前保存演练记录。

仓库已提供最小脚本：

```bash
set -a
. /etc/jiangkong/api.env
set +a

BACKUP_DIR=/srv/jiangkong-backups/db scripts/ops/db-backup.sh
BACKUP_FILE=/srv/jiangkong-backups/db/<backup-file>.dump \
RESTORE_DATABASE_URL=postgresql://restore_user:restore_password@127.0.0.1:5432/jiangkong_restore \
scripts/ops/db-restore-drill.sh
```

恢复演练留痕：

| 备份文件 | 恢复目标库 | 开始时间 | 结束时间 | 表数量校验 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待验收 |

## 6. 附件 / 文件备份

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| COS 生命周期 | 控制台人工检查 | 关键对象无短期自动删除策略 | 待验收 |
| 桶版本 / 备份 | 控制台人工检查 | 有版本控制、跨桶复制或周期性备份方案之一 | 待验收 |
| 恢复抽样 | 人工抽查 | 能恢复或重新下载抽样合同、结算、付款凭证文件 | 待验收 |
| 本地临时存储 | 人工检查 | 生产不依赖 `storage/private` 作为唯一附件存储 | 待验收 |

## 7. 日志和错误告警

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| API 日志 | 人工检查 | 登录、审批、归档、付款、下载等关键动作有审计 | 待验收 |
| 进程日志 | 人工检查 | API、Web/Nginx 日志可查，且有轮转 | 待验收 |
| 错误告警 | 人工触发低风险错误 | 5xx 或进程异常能通知负责人 | 待验收 |
| 磁盘告警 | 人工检查 | 日志、备份、上传目录不会无声打满磁盘 | 待验收 |

最小健康检查：

```bash
HEALTH_URL=http://127.0.0.1:3000/health \
SERVICE_NAME=jiangkong-api \
DISK_PATH=/ \
DISK_MAX_USED_PERCENT=85 \
scripts/ops/check-runtime-health.sh
```

如已配置企业微信/飞书机器人，可加 `ALERT_WEBHOOK_URL`；也可用 SMTP 邮箱告警：

```bash
SMTP_URL=smtps://smtp.qq.com:465 \
SMTP_USER=1131096740@qq.com \
SMTP_PASSWORD=<QQ邮箱SMTP授权码> \
ALERT_EMAIL_FROM=1131096740@qq.com \
ALERT_EMAIL_TO=1131096740@qq.com \
scripts/ops/check-runtime-health.sh
```

未配置 webhook 或 SMTP 时，脚本仍会失败退出并在 systemd/cron 日志留痕。

## 8. HTTPS / 域名 / 证书续期

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| HTTPS | 浏览器人工检查 | 管理端只走 HTTPS，无混合内容 | 待验收 |
| 域名解析 | DNS 控制台 | 域名指向正式服务器 | 待验收 |
| 证书有效期 | 证书工具 / 浏览器 | 证书未过期，链完整 | 待验收 |
| 自动续期 | 人工检查 cron/systemd timer | 续期任务存在，最近一次 dry-run 或续期成功 | 待验收 |
| 续期凭据 | 人工检查 | DNSPod 等 token 权限最小，不入仓 | 待验收 |

## 9. 服务器时间同步

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| 系统时区 | 人工检查 | 明确生产时区，日志时间可解释 | 待验收 |
| NTP 同步 | `timedatectl` 或云监控 | NTP active / synchronized | 待验收 |
| 业务时间 | 人工抽查 | 登录、审批、审计、下载票据过期时间一致 | 待验收 |

短时效下载票据、JWT 过期和审计排序都依赖服务器时间，不能跳过。

## 10. 合同母版 DOCX 字体和逐页人工验收

| 验收项 | 方法 | 通过标准 | 结果 |
| --- | --- | --- | --- |
| LibreOffice 可用 | 自动脚本 | `DOC_CONVERTER_COMMAND --version` 可执行 | 待验收 |
| 字体白名单 | 自动脚本 + 人工检查 | `DOC_ALLOWED_FONTS` 包含方正小标宋简体、仿宋_GB2312、楷体_GB2312 | 待验收 |
| 字体安装 | 人工检查 | 生产等价转换机器已安装上述字体 | 待验收 |
| 工作台 live 验证 | 人工运行 | `pnpm --filter @jiangkong/api verify:contract-workbench` 通过 | 待验收 |
| 验收包 | 人工运行 | `pnpm --filter @jiangkong/api contract-master:review-pack` 生成新包 | 待验收 |
| 逐页签认 | 合同部/法务人工 | DOCX 逐页打开检查通过，不能只看 PDF/PNG | 待验收 |

验收以 [合同 Word 版式标准](../../design/建工智管_合同Word版式标准.md) 为准。

## 11. 权限安全验收账号矩阵

至少准备以下真实或生产等价测试账号。每个账号只测自己岗位，不用 `super_admin` 代替业务岗。

| 账号岗位 | 应允许 | 应拒绝 | 结果 |
| --- | --- | --- | --- |
| `contract_staff` | 新建合同、录入历史接管、上传归档件 | 确认接管、实付、付款终审 | 待验收 |
| `contract_director` | 接管确认、合同/结算归档确认、部分审批节点 | 出纳实付、技术配置越权 | 待验收 |
| `budget_staff` / `budget_director` | 发起/复核结算、记录对上审定、结算审批节点 | 实付、合同归档确认 | 待验收 |
| `finance_staff` | 业主收款、总包代付、出纳实付、付款凭证 | 合同接管确认、结算归档确认 | 待验收 |
| `finance_director` | 财务审批、项目经营查看、资金风险复核 | 代替出纳上传业务外附件 | 待验收 |
| `project_manager` | 查看本项目、确认项目归属、付款/费用相关节点 | 查看无授权项目数据 | 待验收 |
| `comprehensive_director` | 综合费用审批节点、用章相关节点 | 合同接管确认、出纳实付、跨项目查看 | 待验收 |
| `chairman` / `general_manager` | 合同和付款最终或签、项目经营查看 | 普通合同经办录入动作 | 待验收 |
| `employee` | 仅普通员工入口和本人事项 | 合同、结算、付款、文件敏感数据 | 待验收 |
| `super_admin` | 技术运维 | 业务审批、业务确认、代替负责人签认 | 待验收 |

必测场景：

1. 未登录访问写接口返回 401。
2. 无项目岗位访问项目数据返回空或 403。
3. 无岗位下载敏感文件无法签票。
4. 当前密码错误时，接管确认、业主主合同确认、实付、下载签票均失败。
5. 付款审批通过不等于实际付款，只有出纳实付后才有付款执行记录。
6. 项目付款审批表 PDF、结算附件模板下载和综合费用附件下载均需要登录、权限和审计。

## 最终放行

| 放行项 | 负责人 | 结论 | 日期 |
| --- | --- | --- | --- |
| 自动脚本无 FAIL，WARN 已人工确认 | 运维 | 待签 | 待填 |
| seed 密码和 seed 账号风险已关闭 | 运维 / 管理层 | 待签 | 待填 |
| COS、数据库、备份恢复、附件备份通过 | 运维 | 待签 | 待填 |
| HTTPS、证书续期、时间同步、日志告警通过 | 运维 | 待签 | 待填 |
| 合同母版逐页人工验收通过 | 合同部 / 法务 | 待签 | 待填 |
| 权限矩阵验收通过 | 业务负责人 / 运维 | 待签 | 待填 |
| 项目付款审批表、结算附件模板和综合费用真实单据验收通过 | 财务 / 合同部 / 综合部 / 管理层 | 待签 | 待填 |

所有放行项签完后，才能让真实项目进入 P0 试运行。

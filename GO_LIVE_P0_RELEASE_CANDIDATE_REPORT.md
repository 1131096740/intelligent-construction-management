# 建工智管 Go-Live P0 发布候选报告

> 阅读说明：下方第 0–7 节保留 2026-07-16 备份监控与首次发布的历史证据；当前合同结算治理候选以第 8 节和专项发布候选记录为准。

> 审计日期：2026-07-16
> 当前运维候选分支：`codex/production-backup-alerts`
> 已恢复验证的运行候选 SHA：`434c41a0511b0701fdc8f28e9466dfc959ef4f59`
> 已批准并部署的运行时 SHA：`b857a4269aa907e0550470cece52c846bcbb7623`
> 审计文档 HEAD：以交付回复为准；发布目标之后只新增门禁文档提交，不纳入待部署目标
> 发布前生产基线：`c1fcd2367abb2475a14f6fbb181a5aff9d3ca52e`
> 结论：2026-07-16 已完成获批 SHA 的生产技术发布、第 51 个迁移和公网只读验证，可进入受控真实试运行；全面业务 Go-Live 仍需完成历史合同、活跃合同长链路、母版/附件和普通岗位权限 UAT。数据库备份失败/陈旧告警已按独立获批 SHA 推送并安装，未重复部署应用或执行迁移。

## 0. 生产发布与后续运维

- `origin/main` 为监控来源 `48b5ec3fc91efd9f73cfa7a5eb6d4cde48e6c096`；生产应用工作树仍为已部署运行时 `b857a4269aa907e0550470cece52c846bcbb7623`，tracked diff 为空。
- GitHub Actions 发布运行 `29439598098` 的验证和服务器部署成功；生产成功应用第 51 个迁移。
- 发布前备份 `/srv/jiangkong-backups/db/jiangkong-20260716-021915.dump` 已通过本地与异机验证；本次发布没有写真实业务数据。
- 2026-07-16 03:00 永久 cron 首次自然执行成功，生成 254,832 字节、440 项的 `jiangkong-20260716-030001.dump`，checksum、收据、权限和日志均通过。
- 数据库备份监控独立于 API 运行健康检查，每 15 分钟检查收据新鲜度和恢复证据并复用现有 SMTP/可选 Webhook；已按独立获批 SHA 安装并通过首次健康检查。

## 1. 本轮 P0 收口

### 1.1 认证与会话

- Web 端将并发 `401` 收敛为单次 refresh，避免多请求同时消耗同一 refresh token。
- API 在同一数据库事务中校验、条件撤销旧 token 并签发后继 token；并发消费只有一个请求成功。
- refresh token 新增随机 UUID `jti`，解决同一用户同一秒内签发冲突。
- 验证端兼容部署前已签发的无 `jti` token，旧 token 仍必须通过签名、时效、用户与数据库一次性撤销校验；成功换新后即进入新格式。

### 1.2 权限、文件与错误语义

- 仅对“按岗位过滤的聚合台账读取”加载用户任意项目岗位，项目级合同员可读取后端已按可见项目过滤的资料/台账。
- 上述放行不适用于业务写动作；无项目上下文的写权限不会借用其他项目岗位。
- 无权下载返回 `403`，链接过期/篡改、资料未确认等可修正请求返回 `400`，不再误报 `500`。
- 历史接管未确认、额度不足、实付超过可分摊额度等付款业务拦截返回 `400`；错误审批人返回 `403`。
- 金额计算、可付额度事实、元分转换、文件上传 API 和下载鉴权逻辑未改变。

### 1.3 数据库

- 新增第 51 个 Prisma 迁移，在 `ContractVersion_status_check` 和 `PaymentTermsVersion_status_check` 的完整原有状态集上增加 `superseded`。
- 迁移只替换约束，无 `INSERT`/`UPDATE`/`DELETE`/字段删除；约束使用 `NOT VALID`，对新写入立即生效，不因历史行阻断上线。
- PostgreSQL 16 空库完整应用 51 个迁移；事务内实测 `effective -> superseded` 通过，非法状态被数据库拒绝。

### 1.4 Web 关键流程

- 付款、结算、合同详情在同路由由 A 切换到 B 时立即清除 A 的事实和敏感对话框；慢响应 A 不能覆盖 B。
- 合同变更金额统一按“元”输入，提交前使用现有安全转换函数转为“分”。
- 新增同路由慢响应浏览器回归，并修复付款工作台 E2E 的登录等待竞态和全局 mock 漏请求。

### 1.5 发布与恢复

- 生产 GitHub Actions 改为手动发布，必须输入 40 位小写目标 SHA 和精确确认语。
- 只允许部署 `origin/main` 祖先提交，checkout SHA、服务器 HEAD 和最终部署 SHA 必须一致。
- 生产环境门禁、P0 E2E、E2E TypeScript 校验、失败证据上传已接入发布工作流。
- `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 已分别固定到经 GitHub API 核验的当前官方 v4 完整提交 SHA，移除可变 `@v4` 供应链引用；提交 `eaaffee56d1657f98631edc7ef41016baffe9887` 只修改该工作流，不改变应用、迁移或生产运维脚本。
- 数据库备份改为 custom dump 临时文件写入，通过 `pg_restore --list` 和 SHA-256 后原子发布，权限为 `600`。
- 新增独立 COS 数据库备份传输器，不复用业务文件桶和 API CAM；备份密钥只允许由 root `600` 配置读取，不进入 API 环境、仓库、GitHub Secrets 或命令参数。
- 每个 dump 与 checksum 均执行 PUT、HEAD 元数据/SSE-COS 校验和完整 GET 回读 SHA-256；请求有 120 秒硬超时，单对象最多重试 3 次，只有两类对象全部验证后才原子生成 `.offsite.json` 收据。
- 生产定时入口和发布脚本强制 `DB_BACKUP_OFFSITE_REQUIRED=true`；远端验证失败时保留本地 dump/checksum，但在停止 API 和 Prisma 迁移之前硬停止。备份任务使用 `flock` 防止定时任务与发布前备份并发。
- 本地清理只删除已有异机收据的过期备份；没有收据的本地备份不会因保留策略被清理。
- 恢复演练脚本只允许连接实际库名为 `jiangkong_restore_*` 的空 `public` schema，并校验 checksum、档案列表、Prisma 迁移和核心表计数；发布候选模式还会在恢复前核对候选检出的精确 40 位 SHA 与洁净工作区，恢复后对同一隔离库执行候选 `migrate deploy/status`，并要求完成迁移数与候选目录完全一致。
- 部署前先构建和备份，再停 API/迁移/替换运行时；迁移或新运行时失败时恢复旧 API/Web 快照并重新健康检查。数据库迁移不自动逆转。
- 云端资源、生产 root 配置、日/月调度、无人值守收据、永久 03:00 首次自然收据、真实恢复及备份陈旧/失败监控安装已按 `docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md` 完成。

### 1.6 审批规则收口

- 重大合同变更增强路由由“预算主管 → 财务主管 → 合同主管 → 董事长/总经理或签”收口为“财务主管 → 合同主管 → 董事长/总经理或签”。
- 材料/机械与劳务/专业分包结算的“合同部主管 + 预算部主管”会签节点改为合同部主管单独审批；结算其他前后节点保持不变。
- 预算角色、共享权限字典、可选审批资格和既有冻结实例继续保留；未改变金额、付款、权限、状态、审批执行器、路由、数据库或元分转换。

## 2. 生产等价验证

### 2.1 本地隔离环境

- PostgreSQL 16 临时容器，本机端口 55432，脱敏 seed/test 数据，本地文件存储；已删除容器。
- API 以 `NODE_ENV=production` 和生产密钥长度约束启动。
- 真实 HTTP 链路已通过：首次改密 → 历史合同接管 → 资料上传/鉴权下载 → 主管确认 → 结算模板检查/预览/发布 → 结算审批/归档/生效 → 付款申请/超额拦截/审批 → 实付/凭证 → 财务入账 → PDF 归档 → 审计日志。
- 通过编号：`HT-UAT-go-live-20260715l -> JS-UAT-go-live-20260715l -> FK-UAT-go-live-20260715l`。
- 真实 custom dump 在隔离空库 `jiangkong_restore_go_live` 恢复成功；二次恢复被“目标非空”门禁拒绝。
- 新增候选迁移真实引擎演练：使用 PostgreSQL 16 隔离容器构造 50 个迁移的源库，生成真实 custom dump 后恢复到 `jiangkong_restore_candidate`；恢复脚本绑定当时固定候选 `c59f1b9deb11bdcea8c5540fd265a843584e302a`，确认迁移前 50，成功应用第 51 个迁移，`prisma migrate status` 最新，最终完成迁移数与候选目录同为 51。临时数据库、容器和 worktree 已清理；这证明仓库控制链可用，但不能替代尚未执行的生产真实数据异机恢复。

### 2.2 当前生产只读快照

- 生产 SHA：`b857a4269aa907e0550470cece52c846bcbb7623`，与 `origin/main` 一致。
- `https://jgzg.site/` 和 `/api/health` 均返回 200/healthy；HSTS、`nosniff`、`DENY` frame policy 等安全响应头存在。
- Let's Encrypt 证书有效期至 2026-09-29；`certbot.timer` enabled/active。
- API、Nginx、PostgreSQL 均 active；API 仅监听 `127.0.0.1:3000`，PostgreSQL 仅监听 `127.0.0.1:5432`。
- UFW active，入站仅放行 SSH/80/443（IPv4/IPv6）。
- NTP 已同步，时区 `Asia/Shanghai`。
- 磁盘使用率 17%，可用内存约 2.9 GiB，swap 约 1.9 GiB。
- 生产库 51 个迁移全部完成；第 51 个迁移 `20260715150000_contract_superseded_status_constraints` 已成功应用。
- `FILE_STORAGE_DRIVER=cos`，生产 `COS_BUCKET=jiangkong-prod-files-1438687719`、`COS_REGION=ap-chengdu`；数据库、JWT/Refresh、下载签名、COS CAM 和 Web Origin 配置均已设置（未输出密钥值）。
- 健康检查每 5 分钟执行且连续返回 `runtime health ok`；过去 24 小时 API warning/error 级别日志为空。

### 2.3 COS 证据

以用户提供的腾讯云控制台验收记录为准：

- 业务桶 `jiangkong-prod-files-1438687719`，成都 `ap-chengdu`，私有读写、SSE-COS、版本控制、90 天历史版本、删除标记清理。
- 访问日志已实际产生；独立日志桶 `jiangkong-prod-cos-logs-1438687719` 私有/SSE-COS，日志前缀 `cos-access/jiangkong-prod-files/`，365 天删除。
- 生产 CAM 仅可操作 `uploads/*`；审计账号只看配置、不读文件内容；生产 API 账号不能访问日志桶。
- 监控告警已绑定，盗刷风险检测 0 个未通过项；未启用 CDN，与后端鉴权下载架构一致。
- 数据库备份桶 `jiangkong-prod-db-backups-1438687719` 位于成都 `ap-chengdu`，私有、SSE-COS、版本控制；日备当前/历史版本保留 30 天，月备当前版本保留 365 天、历史版本保留 30 天，不开 CDN。
- 专用子用户 `jiangkong-prod-db-backup` 只有编程访问，策略资源仅为 `database-backups/*`，只允许 `PutObject`、`HeadObject`、`GetObject`；删除、前缀外、业务桶、日志桶和桶级 HEAD 均实测 403。凭据只保存在生产 root `600` 文件中，未进入聊天或仓库。

### 2.4 发布权限边界只读复核

- 2026-07-15 公网 `https://jgzg.site/` 与 `/api/health` 均为 200，TLS 验证通过，证书有效期至 2026-09-29；健康接口不暴露构建 SHA，因此公网健康不能单独证明服务器当前提交。
- GitHub `origin/main` 与生产均为 `b857a4269aa907e0550470cece52c846bcbb7623`，生产库已完成 51 个迁移；API、Nginx、PostgreSQL、Cron 和公网 `/api/health` 正常。
- 仓库为 private，GitHub API 对 main branch protection 返回“需升级方案”，`production` Environment 及其环境级 Secret/Reviewer 当前不可查询；生产 SSH 凭据仍是仓库级 Actions Secrets。
- 用户选择移除方案后，`jigege9527` 已于 2026-07-16 从直接协作者中删除。GitHub 权限接口回读为 `none`，直接协作者清单只剩所有者 `1131096740`，且没有该账号的待处理邀请；非所有者可写协作者边界已关闭。
- 生产工作流继续以精确 40 位目标 SHA、固定确认语、`origin/main` 祖先校验、全量验证和服务器 SHA 校验防止误部署；三个官方 Actions 已在 `eaaffee56d1657f98631edc7ef41016baffe9887` 固定到完整提交 SHA。GATE-32 的权限与供应链子项已通过，只剩最终发布目标 SHA 待用户签认。

### 2.5 生产异机备份与候选绑定恢复

- 生产 root 已安装日备/月备配置和固定工具，配置均为 `600 root:root`；永久工具位于 `/usr/local/lib/jiangkong-offsite-backup/`，未修改生产业务代码。既有每日 02:30 本地备份保留，新增每日 03:00 异机日备和每月 1 日 03:30 异机月备，共享锁防止并发；专用日志为 root `600`，logrotate 每日检查、保留 30 份并压缩。
- 手工日备和月备均生成 254,606 字节、`600`、`pg_restore --list` 440 项的 custom dump；日备、月备分别进入 `database-backups/daily/` 和 `database-backups/monthly/`，dump/checksum/收据齐全。月备标记 `manual_monthly_offsite_backup=passed`。
- 一次性 22:55 调度调用与永久 cron 相同的生产入口，自动生成 `jiangkong-20260715-225500.dump`，SHA-256 为 `4ce66df48cd099c24c1e735a1676b742286719e845742755b70486ec03f5c858`，440 项；从 COS 独立下载的 dump/checksum 哈希一致、与本地逐字节相同，证明无人值守能力而非手工冒充定时结果。
- 使用上述 COS 对象创建隔离库 `jiangkong_restore_20260715_225500_434c41a0`，候选 checkout 精确绑定 `434c41a0511b0701fdc8f28e9466dfc959ef4f59` 且洁净；恢复原始 50 个迁移后应用第 51 个候选迁移，最终为 `51|0|0`，`prisma migrate status` 为最新。
- 隔离库恢复 71 张 public 表；核心计数为 User 10、Project 1、Contract 4、ContractTakeover 1、FileObject 14、AuditLog 166、ContractVersion 4、PaymentTermsVersion 4。两项新 CHECK 约束存在、允许 `superseded`，历史非法状态均为 0；核验阶段启用 `default_transaction_read_only=on`。
- 隔离数据库、候选 checkout、恢复工具和输入临时目录均已删除；正式 22:55 本地备份、checksum、offsite receipt 和 COS 对象按策略保留。最终标记为 `offsite_database_restore_drill=completed`、`isolated_restore_and_candidate_migration=passed`、`isolated_restore_readonly_verification=passed`、`isolated_restore_cleanup=passed`。
- 恢复证据绑定的是运行候选 `434c41a0…`。已发布目标 `b857a426…` 在其后新增审批节点定义、项目经理入口资格、对应只读展示、UAT 脚本顺序和文档，不新增数据库迁移或生产运维脚本；既有异机备份与 50 → 51 恢复能力证据因此继续覆盖该次发布。数据库备份监控来源 `48b5ec3f…` 已单独测试、审批和安装；它不修改备份生成、数据库 Schema 或迁移，因此没有重做数据库数据恢复演练。

## 3. 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| 全量单元/结构测试 | 3,215 通过：shared-domain 62 + Web 633 + API 2,520 |
| API/Web production build | 通过 |
| Web `check:ui` | 通过 |
| Web `typecheck:e2e` | 通过 |
| P0 Playwright | 本轮候选以 9 workers 复验 34 通过 / 2 条件跳过 / 0 失败；生产 build 预览模式，CI 仍显式单 worker。此前并发超时用例已完成单线程与完整串行复验，不通过删除或弱化测试换取结果 |
| Prisma validate | 通过 |
| 英文业务错误扫描 | 自测通过；213 个生产 TS，51 处精确允许的内部英文哨兵 |
| COS 传输单测 | 7/7 通过：私密配置解析、签名脱敏、PUT/HEAD/GET、SSE/哈希、超限拒绝、原子下载、不覆盖已有文件 |
| 运维故障注入自测 | 通过：锁冲突、业务桶复用、配置注入/权限、远端短暂与持续失败、本地证据保留、生产库名/非空库拦截、候选 SHA/洁净度/迁移失败/迁移数量门禁、部署迁移失败恢复、新运行时失败回滚 |
| 数据库备份监控测试 | 13/13 通过：正常、日/月收据共存、非获批 COS 桶/地域、缺失、陈旧、坏收据、权限、哈希、dump 结构、缓存、故障去重、恢复通知和 Secret 不进入 curl 参数 |
| Linux/日月备份回归 | 通过：GNU `stat -c` 优先、BSD `stat -f` 回退、收据大小为数值、日/月配置和同一生产入口可切换 |
| 真实本地备份/恢复 | 通过 |
| 真实生产异机备份/恢复 | 通过：独立 COS 下载、运行候选 `434c41a0…`、50 → 51 迁移、只读核验和清理 |
| 真实本地长链路 UAT | 通过 |
| Workflow YAML / `git diff --check` | 通过 |

Web 生产构建仍提示主 chunk 约 1.43 MB（gzip 约 384 KB），不阻断桌面端首次上线，但列入 P1 性能分包任务。

## 4. 依赖与供应链审查

- `pnpm audit --prod` 因上游 npm 旧 audit 端点返回 HTTP 410，未能作为有效门禁，不得记为“0 漏洞”。
- 补充 OSV 扫描在整个 lockfile 中命中 19 个公告/13 个包，包含开发依赖；对生产依赖树逐项审查后：
  - NestJS SSE 响应注入公告：仓库没有 `@Sse()` 路由；
  - `file-type` DoS 公告：业务代码没有导入 `file-type` 或 Nest `FileTypeValidator`；
  - `qs` 公告：业务代码没有调用受影响的 `qs.stringify` 非默认组合；
  - `uuid@8.3.2` 由 ExcelJS 间接引入，当前路径使用 v4，不调用受影响的 v3/v5/v6 外部 buffer 路径。
- 未在上线前强制主版本 override，避免在最终阶段引入未验证的兼容性变化。P1 必须建立可用的 SCA 门禁并升级 Nest/Vite/Vitest 等依赖。

相关公告：[GHSA-36xv-jgw5-4q75](https://osv.dev/vulnerability/GHSA-36xv-jgw5-4q75)、[GHSA-5v7r-6r5c-r473](https://osv.dev/vulnerability/GHSA-5v7r-6r5c-r473)、[GHSA-j47w-4g3g-c36v](https://osv.dev/vulnerability/GHSA-j47w-4g3g-c36v)、[GHSA-q8mj-m7cp-5q26](https://osv.dev/vulnerability/GHSA-q8mj-m7cp-5q26)、[GHSA-w5hq-g745-h8pq](https://osv.dev/vulnerability/GHSA-w5hq-g745-h8pq)。

## 5. 实际修改范围

- 发布门禁：`.github/workflows/deploy-production.yml`。
- 浏览器门禁：`apps/web-admin/playwright.config.ts` 在 CI 显式串行执行，测试内容、断言和单用例超时未弱化。
- Web 认证与详情：`apps/web-admin/src/api/http.*`、合同/结算/付款详情页及其定向测试。
- Web 浏览器门禁：`apps/web-admin/e2e/`相关用例、`playwright.config.ts`、`tsconfig.e2e.json`、`package.json`。
- API 认证/权限/文件/付款：`services/api/src/auth/`、`file/file.service.*`、`payment/payment-request.service.*`。
- 数据库与 UAT：`20260715150000_contract_superseded_status_constraints`、约束验证测试、`verify-trial-run.cjs`。
- 审批规则：合同变更运行时与读模型、合同工作台读模型、结算冻结路由、Web 只读审批配置、两条 UAT 脚本及对应回归测试。
- 运维：既有 `db-backup.sh`、`db-restore-drill.sh`、`deploy-production-server.sh`、`cos-backup-transfer.mjs` 与日/月 root 定时入口保持不变；本轮只新增 `check-production-db-backup.mjs/.sh`、定向测试、独立 systemd service/timer，并将测试接入 `go-live-safety-self-test.sh`。
- 操作手册：`docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md`。
- 进度与报告：`PROGRESS.md`、本报告。

`packages/shared-domain` 和 `apps/web-admin/src/routes` 无差异。本轮确有意修改 `services/api` 和 `apps/web-admin/src/api/http.*`，用于修复已证实的上线 P0 问题，不是响应式治理范围外的机械扩张。

## 6. 当前 Go-Live 阻断项

### P0-1 生产数据库异机备份与恢复已关闭

- 独立桶、最小权限 CAM、root 配置、手工日/月备、同入口无人值守调度、独立 COS 下载、候选绑定隔离恢复、只读核验和清理均已通过。
- 已恢复验证运行候选为 `434c41a0511b0701fdc8f28e9466dfc959ef4f59`，已发布运行时为 `b857a4269aa907e0550470cece52c846bcbb7623`；生产已完成 51 个迁移和运行时切换，本次发布未写真实业务记录。
- 永久 03:00 cron 首次自然运行收据已经通过；备份陈旧/失败告警候选尚待单独批准和安装。生产 API CAM 策略非当前版本 3 继续保留，当前不得删除或切换。

### P0-2 真实业务验收未完成

- 约 20 个已签在执行合同的历史接管与历史余额复核。
- 3–5 个活跃合同的结算、付款审批、实付、凭证、入账、审计长链路。
- 合同母版 DOCX 逐页签认、生产中文字体/LibreOffice 转 PDF 复核。
- 真实合同场景/模板映射与普通岗位权限矩阵 UAT。
- 业务负责人、财务负责人和技术负责人共同给出 Go / No-Go 结论。

2026-07-16 只读预检进一步确认：生产运行、seed 停用、COS、LibreOffice 和必需中文字体技术项已通过；当前只有 4 份合同、1 份历史接管草稿、0 结算、0 付款，附件归档只有历史接管类型，不能替代真实 UAT。预检当时发现生产缺少 `budget_director`；用户随后永久取消重大合同变更和结算中的预算强制审批，生产已发布 `b857a426…` 并运行新规则，可以按新规则开展真实 UAT。详细证据与材料清单见 `docs/progress/2026-07-16-real-business-uat-preflight.md`。

### P0-3 技术发布与数据库备份监控安装已关闭

- 用户已明确批准并完成 `b857a4269aa907e0550470cece52c846bcbb7623` 的推送、部署和第 51 个迁移。
- 应用发布时 `origin/main`、生产服务器 HEAD 和发布工作流 SHA 均为 `b857a426…`，运行 `29439598098` 成功；监控来源随后单独快进到 `origin/main`，没有再次运行应用部署工作流。
- 用户随后独立批准 `48b5ec3fc91efd9f73cfa7a5eb6d4cde48e6c096`；该 SHA 已快进推送到 `origin/main`，生产只从获批 Git 对象安装数据库备份监控脚本和 systemd unit，应用工作树仍为 `b857a426…`。
- 生产复跑监控测试 13/13；首次手工检查和 11:45:51 第一次自然 timer 均确认现有恢复点健康，timer enabled/active，原 cron 指纹、51 个迁移和 Web/API 健康均未改变。

### P0-4 GitHub 发布权限边界已关闭

- private 仓库当前没有可用的 main branch protection 或 production required reviewer 门禁。
- `jigege9527` 已按用户授权移除，权限为 `none`；直接协作者只剩所有者 `1131096740`，无待处理邀请。
- 三个生产 Actions 已固定完整 SHA。当前平台方案仍没有强制双人审批能力，但已不存在第二个可修改 main/工作流或触发手工部署的直接协作者；运行时发布 SHA 已完成签认，新运维候选继续由 P0-3 管理。

## 7. 发布与回滚方案

### 发布前

1. 永久 03:00 首次自然收据已通过；不得擅自删除或切换生产 API CAM 策略版本 3。
2. 完成 P0-2 业务 UAT/签认。
3. 数据库备份监控代码复核、精确 SHA 签认、推送和生产安装已完成。
4. 首次手工健康检查与 timer 启用已完成；应用部署和数据库迁移未重复执行。
5. 正常检查、故障去重和恢复通知已由生产服务器本地隔离测试覆盖；现有 03:00/03:30 cron 未改变。真实 SMTP 故障/恢复通知不做未经通知的生产假告警注入。

### 发布后验证

- 服务器 HEAD 与批准 SHA 一致；51 个迁移完成。
- API/Nginx/PostgreSQL/health timer active；内外网 health 正常。
- 登录、旧 refresh token 换新、首次改密、中文文件 COS 上传/鉴权下载、合同/结算/付款详情同路由切换、合同变更元分转换执行最小冒烟。
- 确认迁移前 dump/checksum 存在，健康日志无新错误。

### 回滚

- 迁移失败：不替换新运行时，重启旧 API。
- 运行时/健康失败：自动恢复旧 API/Web 快照并重启。
- 本次数据库迁移只扩展状态 CHECK 约束，对旧运行时向后兼容，回滚代码时保留该迁移，不自动回滚数据库。
- 如必须恢复数据，先将迁移前备份恢复到 `jiangkong_restore_*` 隔离库复核，再由用户单独授权维护窗口；禁止对生产执行 `prisma migrate reset`。

## 8. 2026-07-17 合同结算治理后续候选（验证中）

> 本节是对 2026-07-16 已发布基线的后续候选补充，不改写上文的历史发布证据。
> 最终 40 位 SHA：**待 Task 22 提交后回填**
> 当前结论：**No-Go / 本地代码与自动化门禁已收口，等待最终 SHA 隔离 UAT、生产备份 61→69 恢复演练、真实业务签认和用户精确 SHA 授权。**

### 8.1 变更范围

- 已批准业务规格：新合同审批，签署/用印/归档，双方授权，合同变更与 10% 上限，结算单与冻结签名，税务/计价事实，我方公司主体。
- 生产文档已知运行基线为 `6c382a39…` 和 61 个迁移；候选共 69 个迁移，生产尚未部署的 8 个迁移为 M52–M58 与 M69 `20260719100000_unified_file_business_binding_guard`。M69 用 54 项中心引用清单、54 个统一触发器和同一事务级锁收口合同、结算、零星采购及其他域的文件绑定；不主动改写业务数据，存量冲突时失败关闭。
- 新增旧实例过渡工具默认只读；生产 apply 必须使用精确 SHA、精确 manifest、操作人和确认语，且需用户在部署/迁移授权之外再次单独批准。

### 8.2 待回填门禁

| 门禁 | 当前状态 | 备注 |
| --- | --- | --- |
| 最终 40 位候选 SHA | 待填 | 不得使用未提交工作树或短 SHA |
| 相对 `origin/main` 和生产 SHA 的提交/文件清单 | 待填 | 待候选固定 |
| shared/API/Web 定向与全量门禁 | 通过 | shared 102/102；Web 98 文件 784/784；API 177 套通过、4 套条件跳过，3914 通过/15 跳过；typecheck、lint、Prisma validate/generate、业务错误检查、`check:ui` 通过 |
| API/Web production build | 通过 | 最新 `origin/main` 合并后重跑 |
| P0 E2E | 通过 | Chromium 53 通过/2 条件跳过/0 失败 |
| 六视口浏览器验收 | 通过 | 28/28 定向验收与 P0 六视口回归通过；阶段截图位于 `/tmp/jiangkong-contract-settlement-visual-a67c-final-2` |
| 完整脱敏隔离 UAT | 合并阶段通过，最终 SHA 须重跑 | `task22-merge-20260719a`：执行 SHA `a67c3092…`，20/20 治理矩阵与 `HT-UAT-* → JS-UAT-* → FK-UAT-*` 全链通过；证据 SHA-256 `a476d9acec8f84712a9bddca803ff0b5e89f3e50cd55ef208a0be45fa9c37fb9`；后续合并了新主线，不冒充最终 SHA 证据 |
| 生产备份→`jiangkong_restore_*`→61→69 | 待演练 | 必须绑定本次最终 SHA；本地 fresh M1→69 和 `origin/main` 61→69 已通过 |
| transition preview / 隔离 apply / 幂等 / 漂移回滚 | 本地模块级隔离演练通过，最终候选 CLI 门禁须重跑 | `task22-20260718T160702Z`：首次 2/0、二次 0/2、漂移整批零写入、付款事实不变；dirty shared worktree 调用 committed HEAD module，不是最终 release gate |
| 业务/财务/技术 Go / No-Go | 待签认 | 脱敏自动 UAT 不取代真实业务签认 |

### 8.3 发布和过渡授权边界

1. **授权 A**：用户针对最终 40 位 SHA 明确批准推送、Web/API 部署、生产尚未完成的 M52–M58 与 M69 迁移和生产验证。
2. **授权 B**：窗口 A 稳定后，用户针对 transition preview 的精确 manifest 和当前生产 SHA 再次批准生产 `--apply`。
3. 授权 A 不得默认包含授权 B；普通的“同意上线”不能取代两次精确授权。
4. 在授权 B 之前，transition 在生产只允许只读 preview；不得终止或改写旧实例。

### 8.4 Task 22 隔离验证发现

- PostgreSQL 真实执行发现合同变更锁查询把 `FOR SHARE` 用于 `UNION`，已改为分开加锁并通过并发回归。
- 完整付款链发现新治理结算确认事实未进入旧归档表，旧容量查询会把已生效结算误判为 0 元；已在共享读取点合并 legacy 归档确认与已确认的受治理最终签名合成件，未伪造旧归档记录。
- 一次性编排器会自行创建/迁移/seed PostgreSQL 16，启动仅本机 API 与 local 文件存储，依次执行 20 项治理 UAT 和完整 P0-5B，再无论成功失败均清理运行时；运行命令和两窗口授权边界见专项 Runbook。
- 上述证据不取代最新 `origin/main` 合并审计、最终洁净 SHA 重跑、生产备份恢复或真实人员签认。

transition 模块级隔离演练使用 runId `task22-20260718T160702Z`、执行 HEAD `2bef123cfbdc231cba41d212b17ed6f9cd5f0c30`、PostgreSQL `16.14` 和 M1–M58 共 58 个迁移。manifest digest 为 `a4ac20b349f0a157228d072d876cfad7c8dd70f82a06beaa2703930a0eee24fc`，manifest 文件 SHA-256 为 `8f7e8f7c0175e690a1625e55dc5f25262605f22d54a0ea7aaee91ca6abdb4c5d`；首次 apply 为 `applied=2/alreadyProcessed=0`，二次为 `0/2`，漂移批次零 transition 审计、零替代草稿写入，付款申请/实付/入账及已付金额事实不变，cleanup 通过。机器收据 `/tmp/task22-20260718T160702Z-transition-evidence.json` 的 SHA-256 为 `67a272e0378033bd77c35783ffbd90c0bca009fff5fec48d8aa5999f03424bdf`。

该收据产生于 dirty shared worktree，演练直接调用 committed HEAD module，而非从洁净候选执行 CLI 端到端发布命令；数据来自本地合成隔离库，也不是生产备份恢复。因此生产备份 → `jiangkong_restore_*` → 最终候选 M69 的 61→69 恢复演练继续保持“待演练”，最终固定 SHA 后还必须重跑洁净候选 CLI release gate。

详细候选证据见 `docs/progress/2026-07-17-contract-settlement-governance-release-candidate.md`，执行步骤见 `docs/superpowers/runbooks/2026-07-17-contract-settlement-governance-release.md`。

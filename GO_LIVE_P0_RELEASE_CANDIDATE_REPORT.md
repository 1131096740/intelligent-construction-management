# 建工智管 Go-Live P0 发布候选报告

> 审计日期：2026-07-16
> 候选分支：`codex/go-live-p0`
> 已恢复验证的运行候选 SHA：`434c41a0511b0701fdc8f28e9466dfc959ef4f59`
> 待批准发布目标候选 SHA：`eaaffee56d1657f98631edc7ef41016baffe9887`
> 审计文档 HEAD：以交付回复为准；发布目标之后只新增门禁文档提交，不纳入待部署目标
> 生产基线：`c1fcd2367abb2475a14f6fbb181a5aff9d3ca52e`
> 结论：代码与本地生产等价验证已达到发布候选标准，生产数据库异机备份、无人值守上传、独立下载和候选绑定隔离恢复 P0 已通过，生产工作流 Actions 已固定到完整提交 SHA；正式 Go-Live 仍为 **No-Go**，剩余门禁是关闭 GitHub 协作者写权限、完成真实业务 UAT/签认，并由用户明确批准发布目标候选 SHA。

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
- 云端资源、生产 root 配置、日/月调度、无人值守收据及真实恢复已按 `docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md` 完成；永久 03:00 首次自然调度收据和备份陈旧/失败告警继续作为上线运维观察项，不推翻已经通过的同入口无人值守验证。

## 2. 生产等价验证

### 2.1 本地隔离环境

- PostgreSQL 16 临时容器，本机端口 55432，脱敏 seed/test 数据，本地文件存储；已删除容器。
- API 以 `NODE_ENV=production` 和生产密钥长度约束启动。
- 真实 HTTP 链路已通过：首次改密 → 历史合同接管 → 资料上传/鉴权下载 → 主管确认 → 结算模板检查/预览/发布 → 结算审批/归档/生效 → 付款申请/超额拦截/审批 → 实付/凭证 → 财务入账 → PDF 归档 → 审计日志。
- 通过编号：`HT-UAT-go-live-20260715l -> JS-UAT-go-live-20260715l -> FK-UAT-go-live-20260715l`。
- 真实 custom dump 在隔离空库 `jiangkong_restore_go_live` 恢复成功；二次恢复被“目标非空”门禁拒绝。
- 新增候选迁移真实引擎演练：使用 PostgreSQL 16 隔离容器构造 50 个迁移的源库，生成真实 custom dump 后恢复到 `jiangkong_restore_candidate`；恢复脚本绑定当时固定候选 `c59f1b9deb11bdcea8c5540fd265a843584e302a`，确认迁移前 50，成功应用第 51 个迁移，`prisma migrate status` 最新，最终完成迁移数与候选目录同为 51。临时数据库、容器和 worktree 已清理；这证明仓库控制链可用，但不能替代尚未执行的生产真实数据异机恢复。

### 2.2 当前生产只读快照

- 生产 SHA：`c1fcd2367abb2475a14f6fbb181a5aff9d3ca52e`，与 `origin/main` 一致。
- `https://jgzg.site/` 和 `/api/health` 均返回 200/healthy；HSTS、`nosniff`、`DENY` frame policy 等安全响应头存在。
- Let's Encrypt 证书有效期至 2026-09-29；`certbot.timer` enabled/active。
- API、Nginx、PostgreSQL 均 active；API 仅监听 `127.0.0.1:3000`，PostgreSQL 仅监听 `127.0.0.1:5432`。
- UFW active，入站仅放行 SSH/80/443（IPv4/IPv6）。
- NTP 已同步，时区 `Asia/Shanghai`。
- 磁盘使用率 17%，可用内存约 2.9 GiB，swap 约 1.9 GiB。
- 生产库 50 个已部署迁移全部完成；候选的第 51 个迁移尚未执行。
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
- GitHub `origin/main` 与生产仍为 `c1fcd2367abb2475a14f6fbb181a5aff9d3ca52e`，生产库保持 50 个已完成迁移；API、Nginx、PostgreSQL、Cron 和公网 `/api/health` 在备份安装、恢复及清理前后均正常。运行候选未部署，第 51 个迁移只在隔离恢复库执行。
- 仓库为 private，GitHub API 对 main branch protection 返回“需升级方案”，`production` Environment 及其环境级 Secret/Reviewer 当前不可查询；生产 SSH 凭据仍是仓库级 Actions Secrets。
- 直接协作者共有两名：所有者 `1131096740` 为 admin，`jigege9527` 为 write。用户已明确要求将 `jigege9527` 降为只读；2026-07-16 实际提交 `permission=pull` 后回读仍为 `write`，没有形成降权。原因是该 private 仓库归个人账号所有，GitHub 官方规则明确个人私有仓库的协作者只能获得 write，不能获得 read-only。上线前必须选择“移除该协作者”或“迁入 Organization 后授予 read”，本轮未擅自执行任一扩大影响的操作。官方依据：[Permission levels for a personal account repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)。
- 生产工作流继续以精确 40 位目标 SHA、固定确认语、`origin/main` 祖先校验、全量验证和服务器 SHA 校验防止误部署；三个官方 Actions 已在 `eaaffee56d1657f98631edc7ef41016baffe9887` 固定到完整提交 SHA。该供应链子项已关闭，协作者写权限仍使 GATE-32 保持待验收。

### 2.5 生产异机备份与候选绑定恢复

- 生产 root 已安装日备/月备配置和固定工具，配置均为 `600 root:root`；永久工具位于 `/usr/local/lib/jiangkong-offsite-backup/`，未修改生产业务代码。既有每日 02:30 本地备份保留，新增每日 03:00 异机日备和每月 1 日 03:30 异机月备，共享锁防止并发；专用日志为 root `600`，logrotate 每日检查、保留 30 份并压缩。
- 手工日备和月备均生成 254,606 字节、`600`、`pg_restore --list` 440 项的 custom dump；日备、月备分别进入 `database-backups/daily/` 和 `database-backups/monthly/`，dump/checksum/收据齐全。月备标记 `manual_monthly_offsite_backup=passed`。
- 一次性 22:55 调度调用与永久 cron 相同的生产入口，自动生成 `jiangkong-20260715-225500.dump`，SHA-256 为 `4ce66df48cd099c24c1e735a1676b742286719e845742755b70486ec03f5c858`，440 项；从 COS 独立下载的 dump/checksum 哈希一致、与本地逐字节相同，证明无人值守能力而非手工冒充定时结果。
- 使用上述 COS 对象创建隔离库 `jiangkong_restore_20260715_225500_434c41a0`，候选 checkout 精确绑定 `434c41a0511b0701fdc8f28e9466dfc959ef4f59` 且洁净；恢复原始 50 个迁移后应用第 51 个候选迁移，最终为 `51|0|0`，`prisma migrate status` 为最新。
- 隔离库恢复 71 张 public 表；核心计数为 User 10、Project 1、Contract 4、ContractTakeover 1、FileObject 14、AuditLog 166、ContractVersion 4、PaymentTermsVersion 4。两项新 CHECK 约束存在、允许 `superseded`，历史非法状态均为 0；核验阶段启用 `default_transaction_read_only=on`。
- 隔离数据库、候选 checkout、恢复工具和输入临时目录均已删除；正式 22:55 本地备份、checksum、offsite receipt 和 COS 对象按策略保留。最终标记为 `offsite_database_restore_drill=completed`、`isolated_restore_and_candidate_migration=passed`、`isolated_restore_readonly_verification=passed`、`isolated_restore_cleanup=passed`。
- 恢复证据绑定的是运行候选 `434c41a0…`。从该提交到待批准发布目标 `eaaffee5…` 只新增 Markdown 文档并固定 `.github/workflows/deploy-production.yml` 的三个 Actions 引用，应用、数据库迁移和生产运维脚本树均未变化，因此恢复与第 51 个迁移证据仍适用于将要部署的运行树；这不等同于声称对 `eaaffee5…` 做过精确 SHA 恢复。若应用、迁移或生产运维脚本再次变化，必须重新评估恢复演练，不得沿用本证据。

## 3. 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| 全量单元/结构测试 | 3,211 通过：shared-domain 62 + Web 631 + API 2,518 |
| API/Web production build | 通过 |
| Web `check:ui` | 通过 |
| Web `typecheck:e2e` | 通过 |
| P0 Playwright | 34 通过 / 2 条件跳过 / 0 失败；生产 build 预览模式，CI 显式单 worker。首次在本机 9 worker 并发下有 2 条页面循环超时；失败用例单线程 2/2 通过，随后完整 36 条串行复验通过 |
| Prisma validate | 通过 |
| 英文业务错误扫描 | 自测通过；213 个生产 TS，51 处精确允许的内部英文哨兵 |
| COS 传输单测 | 7/7 通过：私密配置解析、签名脱敏、PUT/HEAD/GET、SSE/哈希、超限拒绝、原子下载、不覆盖已有文件 |
| 运维故障注入自测 | 通过：锁冲突、业务桶复用、配置注入/权限、远端短暂与持续失败、本地证据保留、生产库名/非空库拦截、候选 SHA/洁净度/迁移失败/迁移数量门禁、部署迁移失败恢复、新运行时失败回滚 |
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
- 运维：`db-backup.sh`、`db-restore-drill.sh`、`deploy-production-server.sh`、`go-live-safety-self-test.sh`、`cos-backup-transfer.mjs` 及测试、日/月 root 定时入口和备份环境示例；GNU/BSD `stat` 兼容修复已包含在运行候选。
- 操作手册：`docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md`。
- 进度与报告：`PROGRESS.md`、本报告。

`packages/shared-domain` 和 `apps/web-admin/src/routes` 无差异。本轮确有意修改 `services/api` 和 `apps/web-admin/src/api/http.*`，用于修复已证实的上线 P0 问题，不是响应式治理范围外的机械扩张。

## 6. 当前 Go-Live 阻断项

### P0-1 生产数据库异机备份与恢复已关闭

- 独立桶、最小权限 CAM、root 配置、手工日/月备、同入口无人值守调度、独立 COS 下载、候选绑定隔离恢复、只读核验和清理均已通过。
- 已恢复验证运行候选为 `434c41a0511b0701fdc8f28e9466dfc959ef4f59`，待批准发布目标候选为 `eaaffee56d1657f98631edc7ef41016baffe9887`；两者的应用、迁移和生产运维脚本相同。生产仍是 `c1fcd236...` 和 50 个迁移，没有部署或业务数据写入。
- 永久 03:00 cron 首次自然运行收据、备份陈旧/失败告警，以及生产 API CAM 策略非当前版本 3 的上线前复核仍需进入运维清单；当前不得删除该策略版本。这些观察项不否定已完成的恢复能力，但必须在最终 Go/No-Go 中有负责人和结论。

### P0-2 真实业务验收未完成

- 约 20 个已签在执行合同的历史接管与历史余额复核。
- 3–5 个活跃合同的结算、付款审批、实付、凭证、入账、审计长链路。
- 合同母版 DOCX 逐页签认、生产中文字体/LibreOffice 转 PDF 复核。
- 真实合同场景/模板映射与普通岗位权限矩阵 UAT。
- 业务负责人、财务负责人和技术负责人共同给出 Go / No-Go 结论。

### P0-3 发布授权未给出

- 候选分支尚未推送，`origin/main` 和生产仍为 `c1fcd236...`。
- 当前待批准发布目标候选为 `eaaffee56d1657f98631edc7ef41016baffe9887`；必须先由用户对该 40 位 SHA 明确批准，才能快进 `main` 并手动触发生产 environment 工作流。
- 本报告形成前未推送、未部署、未执行第 51 个生产迁移、未写入真实业务数据。

### P0-4 GitHub 发布权限边界未签认

- private 仓库当前没有可用的 main branch protection 或 production required reviewer 门禁。
- 除仓库所有者外，`jigege9527` 仍持有 write 权限，可修改 main/工作流并触发手工部署。用户要求的只读降权已尝试，但 GitHub 个人私有仓库不支持只读协作者，回读仍为 write。
- 上线前必须由用户明确授权二选一：移除 `jigege9527`；或先将仓库迁入 Organization，再授予该账号 read。三个生产 Actions 的完整 SHA 固定已经完成，不再是本项阻断。

## 7. 发布与回滚方案

### 发布前

1. 观察永久 03:00 首次收据并确认备份陈旧/失败告警，复核但不擅自删除生产 API CAM 策略版本 3。
2. 完成 P0-2 业务 UAT/签认。
3. 关闭 P0-4 发布权限边界：移除 `jigege9527`，或把仓库迁入 Organization 后授予 read，并记录授权发布人和复核人。
4. 用户明确批准发布目标候选 `eaaffee56d1657f98631edc7ef41016baffe9887`。
5. 将候选提交纳入 `origin/main`，再以 `eaaffee56d1657f98631edc7ef41016baffe9887` 手动启动 `Deploy Production`，输入精确确认语。
6. 发布脚本先构建、快照旧运行时、创建并验证迁移前备份，任一步失败立即停止。

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

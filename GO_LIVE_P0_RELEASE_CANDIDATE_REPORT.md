# 建工智管 Go-Live P0 发布候选报告

> 审计日期：2026-07-15
> 候选分支：`codex/go-live-p0`
> 目标 SHA：以本报告所在的最终候选提交及交付回复为准
> 生产基线：`c1fcd2367abb2475a14f6fbb181a5aff9d3ca52e`
> 结论：代码与本地生产等价验证已达到发布候选标准，仓库侧异机数据库备份硬门禁已经完成；正式 Go-Live 仍为 **No-Go**，需先在腾讯云完成独立备份桶/CAM、生产安装和真实异机恢复演练，完成真实业务 UAT/签认，并由用户明确批准目标 SHA。

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
- 数据库备份改为 custom dump 临时文件写入，通过 `pg_restore --list` 和 SHA-256 后原子发布，权限为 `600`。
- 新增独立 COS 数据库备份传输器，不复用业务文件桶和 API CAM；备份密钥只允许由 root `600` 配置读取，不进入 API 环境、仓库、GitHub Secrets 或命令参数。
- 每个 dump 与 checksum 均执行 PUT、HEAD 元数据/SSE-COS 校验和完整 GET 回读 SHA-256；请求有 120 秒硬超时，单对象最多重试 3 次，只有两类对象全部验证后才原子生成 `.offsite.json` 收据。
- 生产定时入口和发布脚本强制 `DB_BACKUP_OFFSITE_REQUIRED=true`；远端验证失败时保留本地 dump/checksum，但在停止 API 和 Prisma 迁移之前硬停止。备份任务使用 `flock` 防止定时任务与发布前备份并发。
- 本地清理只删除已有异机收据的过期备份；没有收据的本地备份不会因保留策略被清理。
- 恢复演练脚本只允许连接实际库名为 `jiangkong_restore_*` 的空 `public` schema，并校验 checksum、档案列表、Prisma 迁移和核心表计数。
- 部署前先构建和备份，再停 API/迁移/替换运行时；迁移或新运行时失败时恢复旧 API/Web 快照并重新健康检查。数据库迁移不自动逆转。
- 云端资源、生产 root 配置、定时任务替换及真实恢复的操作边界见 `docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md`；这些外部步骤尚未执行，不计为已完成。

## 2. 生产等价验证

### 2.1 本地隔离环境

- PostgreSQL 16 临时容器，本机端口 55432，脱敏 seed/test 数据，本地文件存储；已删除容器。
- API 以 `NODE_ENV=production` 和生产密钥长度约束启动。
- 真实 HTTP 链路已通过：首次改密 → 历史合同接管 → 资料上传/鉴权下载 → 主管确认 → 结算模板检查/预览/发布 → 结算审批/归档/生效 → 付款申请/超额拦截/审批 → 实付/凭证 → 财务入账 → PDF 归档 → 审计日志。
- 通过编号：`HT-UAT-go-live-20260715l -> JS-UAT-go-live-20260715l -> FK-UAT-go-live-20260715l`。
- 真实 custom dump 在隔离空库 `jiangkong_restore_go_live` 恢复成功；二次恢复被“目标非空”门禁拒绝。

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
| 运维故障注入自测 | 通过：锁冲突、业务桶复用、配置注入/权限、远端短暂与持续失败、本地证据保留、生产库名/非空库拦截、迁移失败恢复、新运行时失败回滚 |
| 真实本地备份/恢复 | 通过 |
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
- 运维：`db-backup.sh`、`db-restore-drill.sh`、`deploy-production-server.sh`、`go-live-safety-self-test.sh`、`cos-backup-transfer.mjs` 及测试、root 定时入口和备份环境示例。
- 操作手册：`docs/superpowers/runbooks/2026-07-15-production-offsite-db-backup-runbook.md`。
- 进度与报告：`PROGRESS.md`、本报告。

`packages/shared-domain` 和 `apps/web-admin/src/routes` 无差异。本轮确有意修改 `services/api` 和 `apps/web-admin/src/api/http.*`，用于修复已证实的上线 P0 问题，不是响应式治理范围外的机械扩张。

## 6. 当前 Go-Live 阻断项

### P0-1 仓库门禁已完成，生产异机闭环尚未执行

生产当前仍每日 02:30 执行旧的同机备份，整机/磁盘故障会同时损失主库与备份。仓库已经具备独立 COS 上传、全量回读验证、收据、本地保留、并发锁、生产定时入口和部署前硬阻断，但没有生产云资源和真实恢复证据前，不能关闭此 P0。

正式 Go-Live 前必须：

1. 按操作手册创建独立私有数据库备份桶（建议 `jiangkong-prod-db-backups-1438687719`，成都，SSE-COS，版本控制），不复用业务桶或日志桶。
2. 创建独立 CAM，仅允许备份前缀 `PutObject`、`HeadObject`、`GetObject`；拒绝删除、桶配置、业务桶和日志桶。
3. 在生产安装 root `600` 的 `/etc/jiangkong/db-backup.env`，手工执行一次并取得 dump、checksum、远端收据。
4. 将旧 02:30 任务替换为仓库受控 root 入口，再取得一次定时任务收据。
5. 从异机桶完整下载一份备份，在 `jiangkong_restore_*` 空隔离库完成真实恢复，记录迁移/核心表校验、RPO、RTO、执行人与复核人。

### P0-2 真实业务验收未完成

- 约 20 个已签在执行合同的历史接管与历史余额复核。
- 3–5 个活跃合同的结算、付款审批、实付、凭证、入账、审计长链路。
- 合同母版 DOCX 逐页签认、生产中文字体/LibreOffice 转 PDF 复核。
- 真实合同场景/模板映射与普通岗位权限矩阵 UAT。
- 业务负责人、财务负责人和技术负责人共同给出 Go / No-Go 结论。

### P0-3 发布授权未给出

- 候选分支尚未推送，`origin/main` 和生产仍为 `c1fcd236...`。
- 必须先由用户明确批准最终 40 位候选 SHA，才能快进 `main`并手动触发生产 environment 工作流。
- 本报告形成前未推送、未部署、未执行第 51 个生产迁移、未写入真实业务数据。

## 7. 发布与回滚方案

### 发布前

1. 按异机备份手册完成云端资源、生产安装、定时备份和真实恢复，并完成 P0-2 业务签认，固定 Go 结论。
2. 用户明确批准候选 SHA。
3. 快进 `main`，再以同一 SHA 手动启动 `Deploy Production`，输入精确确认语。
4. 发布脚本先构建、快照旧运行时、创建并验证迁移前备份，任一步失败立即停止。

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

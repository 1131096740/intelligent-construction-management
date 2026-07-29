# 合同工作台五包 Release A 生产发布收据

日期：2026-07-29

## 发布结论

- 用户授权的精确候选：`3ad17a85e8c67003551cec2fb1a9fe44afd0d243`
- 实施基线：`a0bbfacb5008abbcb255a96c79cb0bd05c76db56`
- 隔离分支：`codex/whole-site-five-packages`
- `origin/codex/whole-site-five-packages`、`origin/main`、本地 `main` 和生产
  `/opt/jiangkong` 均已 fast-forward 到精确候选。
- 生产从 `ea567274c1c5b34393b51d9dee7a469ed6791989` 前向更新到精确候选，
  checkout 洁净。
- Release A 已按 `DEPLOY_SCOPE=api-only` 和
  `DEPLOY_CONFIRMATION_MODE=immediate` 完成；只替换 API 运行时，不发布 Web。
- 当前切换模式仍为 `release-a`，canary 数为 0；retention systemd 单元只安装，
  timer 为 `disabled/inactive`，service 为 `inactive`。
- 本次没有执行 transition apply、retention apply、真实业务写入或物理删除。

Release A 技术发布和只读验收通过。实施包 5 Task 5 的生产备份、隔离恢复、推送、
fast-forward、增量迁移、API-only 部署及只读健康检查已经完成；Task 6–15 仍未完成，
不能据此宣称五包生产全阶段完成。

## 备份与隔离恢复证据

### 自然备份

- 文件：`jiangkong-20260729-030001.dump`
- 大小：807,280 字节
- SHA-256：
  `c452679ead3a0c2e1b7f1e3e4416bcd4b90e8c689aa04ddf5c91412d3ec10e97`
- `pg_restore --list`：1,374 项
- 权限：`root:root 600`
- 自然 Cron：03:00:01 开始，03:00:02 完成
- 异机桶：`jiangkong-prod-db-backups-1438687719`，地域 `ap-chengdu`
- checksum、异机收据、对象路径、无遗留 `pg_dump/pg_restore` 进程及公网健康均通过。

异机对象被独立下载到隔离目录并复核：字节数、SHA-256 和 1,374 项目录均与本地
自然备份一致。下载证据保留，未物理删除。

### 候选隔离恢复

- 首次隔离库：`jiangkong_restore_20260729_3ad17a85`
- 首次迁移因 root Corepack 选择 pnpm 11，而 Node 20 缺少其要求的
  `node:sqlite`，在候选迁移步骤失败；隔离库保留，没有删除。
- 使用项目兼容的 pnpm 9.15.9 在第二个隔离库
  `jiangkong_restore_20260729_3ad17a85_r2` 重试。
- 恢复后迁移从 91/109 前向完成到 109/109，候选 SHA 精确匹配，RTO 9 秒。
- 核心计数：User 11、Project 2、Contract 1、ContractTakeover 0、Settlement 0、
  PaymentRequest 0、ProjectExpenseRequest 0、FileObject 30、AuditLog 327。
- 隔离库草稿只读预检为 `ready=1/manualReview=0/blocking=0`，报告 SHA-256：
  `3799e018523906e03739390f6c0bbf1cde016053e3516d8bcc19a102673e70ed`。

### 生产迁移前与部署内备份

- 短停 API 前新备份：`jiangkong-20260729-224658.dump`
- 大小：813,422 字节
- SHA-256：
  `6e2858167487ca22e4445c5167aecec527093ecf82ef2eea005a634f51957ca6`
- 部署脚本内备份：`jiangkong-20260729-225046.dump`
- 大小：1,003,659 字节
- SHA-256：
  `8280545bb0c648e5441a5dcf8cf31c4282d6960340f792d8b5bb7b8fae6de982`
- `pg_restore --list`：1,658 项
- 部署备份 checksum 通过，异机收据指向
  `database-backups/daily/2026/07/29/jiangkong-20260729-225046.dump`。

## 迁移与生产只读预检

- 迁移前生产为 91/109。
- 按用户确认的顺序先生成新备份，短停 API，前向应用迁移 91→109，运行生产只读
  草稿预检，再启动旧 API；随后执行 API-only 部署。
- 当前生产迁移为 109/109，失败 0，回滚 0；迁移头为
  `20260728138000_project_affiliate_company_contract`。
- 生产预检报告状态：`blocked`
- 汇总：`ready=0/manualReview=0/blocking=1`
- 唯一阻断原因：`FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION:1`
- 数据库 fingerprint：
  `cea281848f875b0d683cf1998bffbd6b5b5661868fd7cbff3a27ccabee430225`
- 报告 SHA-256：
  `5fd2a64ebbc5b8be542e620f7d23ab4fe2c324ffb5c3a600bfd4b3363058e97b`

该阻断不要求回退 Release A，因为 Release A 只要求生成并保存只读报告，且新后端继续
兼容旧数据；它明确阻断 Task 6 transition apply。该记录必须人工处置并重新生成
fingerprint/报告后，才能另行申请 transition 授权。

## 发布后只读验收

| 验收项 | 结果 |
| --- | --- |
| 精确 SHA | 生产、远端 main 和获批候选均为 `3ad17a85e8c67003551cec2fb1a9fe44afd0d243` |
| Git 状态 | 生产 `main...origin/main`，工作树洁净 |
| 服务 | `jiangkong-api`、Nginx、PostgreSQL、Cron 均为 active |
| API 健康 | 本机 `127.0.0.1:3000/health` 与公网 `/api/health` 均返回 200/ok |
| HTTPS | HTTP 请求 301 到 HTTPS |
| 权限负向 | 未认证 `/api/projects` 返回 401 |
| 运行健康 | `check-runtime-health.sh --strict-recent-logs` 通过 |
| 日志 | 部署后 API warning 级别及以上日志为 0 |
| 迁移 | 109/109，失败 0，回滚 0 |
| retention | timer disabled/inactive，service inactive |
| 未授权 apply | transition batch 审计 0，retention batch 审计 0 |

受保护记录在迁移、部署前后保持：

| 记录 | 数量 |
| --- | ---: |
| User | 11 |
| Project | 2 |
| Contract | 1 |
| ContractVersion | 1（`draft`） |
| ContractDraftCheckpoint | 0 |
| ContractTakeover | 0 |
| Settlement | 0 |
| PaymentRequest | 0 |
| FileObject | 33 |
| AuditLog | 342 |

生产 checkout 原有 4 个未跟踪部署遗留文件会阻断精确候选的洁净工作树门。它们经
只读审计后被可逆移动到
`/srv/jiangkong-release-a-preserved/production-untracked-before-3ad17a85`，
没有物理删除。候选 clone、隔离 worktree、两座恢复库、异机下载证据和该保全目录
均继续保留。

## 未执行事项与下一发布门

以下事项没有被本次授权覆盖，也没有执行：

1. production transition apply 或对阻断草稿的人工/自动业务修改；
2. retention preview/apply、timer enable/start 或任何对象/记录物理删除；
3. 真实合同、接管、结算、付款、文件或签名写入；
4. Release B 全量 Web 发布、旧写 410 切换、canary 岗位写烟测；
5. Release C1/C2、旧接口删除、小程序退役和生产数据清理。

Runbook 要求的“已登录新精确 GET”和“旧 Web 保存旧草稿”会涉及生产登录状态或真实
业务写入。本次授权明确禁止真实业务写入，且没有可复用的获授权只读会话，因此没有
执行，不能记为通过。Release A 的公开 API 健康、未认证权限负向、数据库只读计数和
旧 Web 静态页面可访问已验证；真实岗位读/写验收留给另行明确授权的 Release B。

下一合法步骤是：人工审阅
`FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION` 的单条阻断记录，明确其保留、修正或迁移
口径；若需要修改生产数据，必须另行授权 Task 6 的记录范围、操作者、报告 SHA、
数据库 fingerprint、batch 和 transition apply。物理删除继续使用独立删除授权门。

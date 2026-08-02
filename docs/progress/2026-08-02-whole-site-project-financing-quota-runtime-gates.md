# 实施包 5 Task 11：项目垫资额度 F1/F2/F3 运行门禁资产

## 当前结论

本切片只为已提交的项目垫资额度 F1 申请、F2 审批和 F3 人工终止补齐专用运行门禁资产：

- PostgreSQL 16 空库、迁移保留数据、真实双 backend 并发、幂等、签名失败零写、Audit
  中段回滚和终态不可变 verifier；
- Chromium/WebKit 在桌面与移动端的 F3 终止关键路径；
- root/API/Web 的显式 opt-in 命令、结构测试和安全清理边界。

代码和静态门已经完成，但 **PostgreSQL 与浏览器动态门尚未执行**。当前结论只能表述为
“门禁资产候选”，不能表述为 F1/F2/F3 已达到发布门，更不能外推为 Task 11、实施包 5 或
五包发布候选完成。

## 授权边界

用户本轮授权精确限定为 `spot-procurement.review-approve`、空库 **114** 个迁移及其签名并发
门禁。当前分支已经包含项目垫资额度第 115、116 个迁移，目标动作和迁移终点均不同。该授权
不能静默扩展为本 runner，因此本切片没有：

- 启动 Docker、PostgreSQL、preview 或浏览器；
- 连接本机或生产数据库；
- push、合并、部署或执行迁移；
- 修改生产业务数据，或执行 retention、purge、旧表旧字段清理及其他物理删除。

实际执行必须等待用户针对新的精确候选 SHA、116 个迁移、融资额度专用 runner、
`127.0.0.1:4194` preview 和四格浏览器范围另行授权。

## PostgreSQL runner

新增 `services/api/prisma/run-project-financing-quota-concurrency-local.cjs`，由 root 和 API
package 的 `verify:project-financing-quota-concurrency:local` 显式进入。runner 默认不执行，且：

- 拒绝 `NODE_ENV=production`，数据库 URL 只允许回环地址和七个精确一次性专库；
- 不继承业务 `DATABASE_URL`，密码、端口、容器名和临时目录每次随机生成；
- 只使用本机已有 `postgres:16`，执行 `image inspect` 和 `--pull=never`，不挂载 volume，
  仅发布随机 `127.0.0.1` 端口；
- `DOCKER_HOST` 未设置时允许使用当前 context，但 `docker context inspect` 必须返回非空、
  可解析且精确为本机 Unix socket 或 Windows npipe；验证后把后续命令固定到该
  `DOCKER_HOST` 并删除 `DOCKER_CONTEXT`，避免 context 漂移；
- endpoint/context 未验证或容器尚未尝试启动时，cleanup 绝不调用 Docker；只有本机验证
  通过且已尝试启动本精确容器时，才允许执行精确 `docker rm --force`；
- SIGINT/SIGTERM 共用单一幂等清理 Promise，最终移除监听器；子进程、精确容器和
  `mkdtemp` 临时目录均纳入 guaranteed cleanup。

### 迁移演练资产

runner 固定以下发布坐标：

- pre-115 根：114 个迁移，终点
  `20260728161000_spot_procurement_application_revision_status`；
- F1：第 115 个迁移
  `20260802010000_project_financing_quota_request_idempotency`，并固定 migration SHA-256；
- F3：第 116 个迁移
  `20260802020000_project_financing_quota_termination_idempotency`，并固定 migration SHA-256。

五个隔离的 pre-115 数据库场景将验证：

1. 无冲突历史额度升级后四个 request snapshot 字段仍全部为 `NULL`，不伪造历史事实；
2. 重复额度附件使第 115 个迁移失败且整段 DDL/业务事实回滚；
3. 跨业务文件绑定使迁移失败且回滚；
4. 附件作为 replacement child 时失败且回滚；
5. 附件作为 replacement parent 时失败且回滚。

每个冲突场景都保留迁移前业务快照，验证失败后新增列不存在、业务事实不变、第 115 个迁移
未完成；随后只清除精确测试冲突、执行 `migrate resolve --rolled-back` 并恢复至完整 116 个
迁移。主库和历史 F3 库还将验证首次/二次 deploy、零待办、status、`_prisma_migrations`
数量/终点/checksum，以及历史已终止额度的 action/fingerprint 继续为 `NULL` 且九个终止事实
受数据库 trigger 冻结。

### 十三个 opt-in 实库场景

`project-financing-quota-concurrency.spec.ts` 默认跳过，只在 runner 自行生成的专库环境中开启：

- F1：同 idempotency key 的双 backend 单创建/重放；额度附件与其他业务的正反向复用均由
  数据库硬阻断且零写；真实 `AuditLog BEFORE INSERT`/`P0001` 后 quota、审批和 Audit 回滚；
- F2：财务主管节点与董事长/总经理 OR 节点的不同 action 单赢家和稳定 409；同 actionId 在
  首事务已提交但首响应被暂缓时发生重叠重试，得到一条 applied、一条 replayed，不把它
  外推为两个 pre-commit 事务竞争；真实 PostgreSQL 产生的 P2010/40001、
  P2010/40P01 以及自然 Serializable P2034 进入生产错误映射；真实 Audit 故障后额度、审批、
  ActionLog、AuditLog 全事务回滚；
- F3：终止和新增资金占用使用不同 backend、显式 Serializable 并按两种锁顺序竞争，最终
  状态、资金分配和终止 Audit 必须对应唯一合法结果；同 actionId 重叠重放、不同 action
  稳定冲突；缺签、签名文件/SHA 漂移零写；CAS 后真实 Audit 故障全回滚；九个终止坐标逐项
  变异均由 PostgreSQL 以 23514 拒绝，最终整行保持不变。

测试夹具使用一致的财务主管初审和董事长终审事实；并发证明使用独立 backend PID、锁等待
观测和持久化结果对照，不能只统计 fulfilled/rejected 数量。

## 浏览器门禁资产

新增专用 Playwright config 和 E2E，不复用外部 server：

- 只绑定 `127.0.0.1:4194`，`reuseExistingServer=false`，执行 production build 后 strict-port
  preview；报告、截图、trace 和其他产物全部写入系统临时目录；
- 四格固定为 Chromium/WebKit × 1366×768/390×844；
- 覆盖 fresh capability、精确四字段终止 POST、双击单 POST、成功后权威 GET、未知结果以
  完全相同 actionId/body 重试、成功回执后只续读 GET、4xx 后重新 preflight、生命周期令牌
  漂移零 POST和跨项目迟到响应隔离；
- 每格检查 console、pageerror、unhandled、错误 overlay、页面和嵌套横向溢出、对话框/确认
  按钮的视口及遮挡，并保存成功截图。

四格目前只有结构与类型证据，没有实际启动 preview 或浏览器。

## 已完成的静态验证

本切片当前验证结果：

- API runner + runtime Jest：2 suites 通过，16 项通过；13 个实库用例按 opt-in 正确跳过；
- API typecheck、完整 `src` lint、production build：通过；
- Prisma validate：使用不可连接的回环虚拟 URL 通过，未建立数据库连接；
- runner `node --check`：通过；
- Web browser-gate structure：6/6 通过；
- Web E2E typecheck：通过；
- Web 专用 E2E/config/structure scoped lint：通过；
- Web typecheck、完整 lint、`check:ui`、production build：通过；
- `git diff --check`：通过。

独立静态终审已先发现并关闭真实竞态、九坐标假覆盖、mock Audit、F1 反向文件复用、远程
Docker cleanup、空 context fail-open、context TOCTOU、F1 假并发和 SQLSTATE 合成证据等
缺口。最终浏览器和实库 spec 终审为 P0/P1/P2 均为 0；runner 终审为 P0/P1 均为 0，保留两项
不影响当前实现的 P2：源码结构断言不能替代真实运行，且未来若有人引入 `-v=...` 或
`--volumes-from`，现有无挂载正则尚不能自动识别。当前 runner 实际命令不含这些参数。

## 仍缺的发布证据

取得新精确授权后，必须在干净、可追溯到该候选 SHA 的隔离 worktree 中执行：

1. runner 的五类 pre-115 场景、完整 116 迁移、第二次零待办和十三个实库用例；
2. Chromium/WebKit 四格动态门并人工核对成功截图；
3. runner 退出后核对精确容器、监听端口和临时目录均无残留。

在以上三项真实证据完成前，F1/F2/F3 运行门保持未关闭，实施顺序不得进入 Task 12。

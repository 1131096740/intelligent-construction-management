# 实施包 5 Task 11：正式零星采购申请审批签名冻结

## 当前结论

本子任务只处理：

- `spot-procurement.review-approve`

申请审批的 `approve` 动作现在会在同一数据库事务中冻结审批人、实际代表账号、审批岗位和
有效手写签名版本；`reject`、`return_to_applicant` 与既有撤回动作不会伪造签名快照。
本子任务已经完成失败测试、最小实现、真实 PostgreSQL 16 空库迁移、坐标并发、缺签和
SHA 漂移零写、Audit 中段故障全事务回滚及静态门禁。它只闭合 Task 11 的一个独立切片，
不代表 Task 11、实施包 5 或五包发布候选完成。

本轮未连接生产，未推送、合并、部署、执行生产迁移或修改生产业务数据；没有执行
retention、业务草稿 purge、正式业务记录删除、AuditLog/checkpoint 清理、旧表旧字段删除
或其他物理删除。

## RED 与最小实现

### RED

改造前的失败证据锁定：

- 申请审批成功动作只在 `metadata.reviewRoleKey` 保存岗位，没有写顶层
  `approvedRoleKey` 与 `representedUserId`；
- `approve` 没有冻结 `signatureFileIdSnapshot`、`signatureSha256Snapshot` 与
  `signatureVersionIdSnapshot`；
- 缺少有效 canvas 签名或文件/版本 SHA 漂移时，流程仍可能进入审批动作写入；
- 没有证明签名已写、最终节点已完成、付款/收货草稿和三条 Audit 已出现后发生 Audit
  故障时，全部事实会一起回滚；
- 本地 PostgreSQL runner 默认执行完整零采联合 verifier，不能满足本轮只运行申请审批
  签名门禁的精确授权范围。

新增测试后，runner scope 结构测试先形成 `13 passed / 1 failed` 的 RED，再实施选择器；
服务测试先锁定成功审批、缺签、SHA 漂移、驳回和退回的预期写入边界。

### GREEN

后端最小实现位于
`SpotProcurementApplicationService.review()`：

1. 仍先完成根单、版本和审批实例锁定，以及 pilot、权限、自审、申请人、精确三坐标、
   意见、canonical real-form 和无下游事实校验；
2. 只有 `decision=approve` 才调用 `snapshotApprovalSignature(..., { required: true })`；
3. 签名快照发生在第一笔持久写入之前；缺签、非 canvas、FileObject 非 active、文件和版本
   SHA/size 漂移均以 400 失败，审批节点、根单、版本、ActionLog、Audit、付款和收货零写；
4. 成功 ActionLog 精确写入：
   - `approvedRoleKey`
   - `representedUserId=actorUserId`
   - `signatureFileIdSnapshot`
   - `signatureSha256Snapshot`
   - `signatureVersionIdSnapshot`
5. `reject` 与 `return_to_applicant` 仍记录岗位和代表账号，但不查询或写入签名三元组；
6. 既有撤回事务和状态迁移未改。

为避免扩大本轮本机数据库授权，新增
`SPOT_PROCUREMENT_CONCURRENCY_SCOPE=application-review-approve`。runner 只把显式 scope
传入其自行生成的本地临时环境；verifier 只接受 `full` 或该精确 scope，其他值失败关闭。
限定 scope 在公共初始化后只执行三段申请审批验证并立即返回，不运行撤回、付款、收货、
票据或其他联合场景。无 scope 时保留原 `full` 行为，既有门禁入口不变。

## 真实 PostgreSQL 16 证据

用户明确授权后，本轮在本机执行限定 runner：

```text
SPOT_PROCUREMENT_CONCURRENCY_SCOPE=application-review-approve
node services/api/prisma/run-spot-procurement-concurrency-local.cjs
```

runner 自行生成随机密码和随机本地端口，仅连接：

```text
127.0.0.1:61264/jiangkong_spot_procurement_concurrency_verify
```

执行结果：

- PostgreSQL 镜像：`postgres:16`；
- 第一次 `prisma migrate deploy`：空库完整应用 114 个迁移；
- 第二次 `prisma migrate deploy`：`No pending migrations to apply`；
- `prisma migrate status`：`Database schema is up to date`；
- `_prisma_migrations`：成功迁移数 114，终点迁移恰好 1 条；
- 终点迁移：`20260728161000_spot_procurement_application_revision_status`；
- 审批坐标并发：双真实 backend PID 锁等待后恰好一个成功，陈旧请求严格 409；节点
  `0→1`，唯一 ActionLog/Audit，签名岗位/账号/文件/SHA/版本精确匹配，付款/收货为 0；
- 缺签与签名版本 SHA 漂移：均为 400，根单、版本、审批实例、ActionLog、Audit、付款、
  收货全部与调用前完全一致；
- Audit 中段注入故障：事务内已观察签名 ActionLog、最终审批节点、已批根单/版本、1 条付款、
  1 条收货和 3 条 Audit，抛错后事务外全部回到调用前，新增行数均为 0。

限定 verifier 的三条运行回执均通过：

```text
ok spot application review coordinates
ok spot application approval signatures
ok spot application approval audit rollback
```

一次性容器
`jiangkong-spot-concurrency-1785574378540-57159` 已由 guaranteed cleanup 删除；独立复核
`docker ps --all` 对该精确容器无输出，端口 61264 无监听，`/tmp` 无
`jiangkong-spot-concurrency-*` 临时目录。未触碰既有其他容器。

### 本轮独立授权复验

用户在后续 Task 11 收口期间对同一限定范围重新明确授权后，再次执行相同
`application-review-approve` runner。复验只连接随机回环地址
`127.0.0.1:58022/jiangkong_spot_procurement_concurrency_verify`，空库 114 个迁移、第二次
零待办、终点迁移唯一、签名坐标并发单赢家、缺签/签名版本 SHA 漂移零写及 Audit 中段
全事务回滚全部通过。guaranteed cleanup 删除一次性容器
`jiangkong-spot-concurrency-1785587561677-76992` 后，独立只读核对确认该容器无输出、58022
无监听且 `/tmp` 无同前缀临时目录。本次复验未连接生产，也未执行授权范围外的业务场景。

### 本次新授权第三轮独立复验

用户再次明确授权同一精确范围后，第三次执行
`SPOT_PROCUREMENT_CONCURRENCY_SCOPE=application-review-approve` 限定 runner。本轮只连接
`127.0.0.1:64563/jiangkong_spot_procurement_concurrency_verify`：空库完整应用 114 个迁移，
第二次 deploy 明确零待办，`migrate status` 已同步，且终点迁移
`20260728161000_spot_procurement_application_revision_status` 恰好一条。

三段真实 PostgreSQL 16 回执全部通过：

- 双 backend 形成真实锁等待，签名坐标并发恰好一个 winner，loser 以陈旧坐标 409 失败；
- 缺签与签名版本 SHA 漂移均在 ActionLog、审批节点、根单、版本、付款、
  收货和 Audit 写入前失败，调用前后事实完全相同；
- Audit 中段故障注入时，事务内已观察签名 ActionLog、最终审批节点、已批根单/版本、付款、
  收货与三条 Audit，抛错后事务外全部回到调用前且新增行数为零。

guaranteed cleanup 删除一次性容器
`jiangkong-spot-concurrency-1785595782733-49329` 和临时目录后，独立只读复核确认精确容器
查询无输出、64563 无监听、`/tmp` 无 `jiangkong-spot-concurrency-*` 临时目录。本轮未连接
生产、未触碰其他容器，也未运行该限定 scope 之外的撤回、付款、收货、票据或其他业务场景。

### 本轮新授权第四次独立复验

用户再次明确授权同一精确范围后，第四次执行
`SPOT_PROCUREMENT_CONCURRENCY_SCOPE=application-review-approve` 限定 runner。本轮只连接
`127.0.0.1:56575/jiangkong_spot_procurement_concurrency_verify`：空库完整应用 114 个迁移，
第二次 deploy 明确零待办，`migrate status` 已同步，且终点迁移
`20260728161000_spot_procurement_application_revision_status` 恰好一条。

三段真实 PostgreSQL 16 回执再次全部通过：

- 双 backend 形成真实锁等待，签名坐标并发恰好一个 winner，loser 以陈旧坐标 409 失败；
- 缺签与签名版本 SHA 漂移均在 ActionLog、审批节点、根单、版本、付款、收货和 Audit
  写入前失败，调用前后事实完全相同；
- Audit 中段故障注入时，事务内已观察签名 ActionLog、最终审批节点、已批根单/版本、付款、
  收货与三条 Audit，抛错后事务外全部回到调用前且新增行数为零。

runner 的 guaranteed cleanup 删除一次性容器
`jiangkong-spot-concurrency-1785605040990-33105` 和临时目录。随后独立只读复核确认精确容器
查询无输出、56575 无监听、`/tmp` 无 `jiangkong-spot-concurrency-*` 临时目录。本轮未连接
生产、未触碰其他容器，也未运行该限定 scope 之外的撤回、付款、收货、票据或其他业务场景。

### 2026-08-02 第五次独立授权复验

当前分支已包含融资额度第 115、116 个迁移，直接运行当前 runner 会越过用户只授权的
114 迁移边界。因此本轮先核对祖先关系，并从祖先提交
`6ff707b7cc147ee9b3b89be824980a8058455677` 创建一次性只读代码快照；该快照固定
`EXPECTED_MIGRATION_COUNT=114`，终点仍为
`20260728161000_spot_procurement_application_revision_status`，且申请审批服务、签名 helper
和限定 verifier 与当前分支对应实现无差异。快照本地构建通过后，只执行：

```text
SPOT_PROCUREMENT_CONCURRENCY_SCOPE=application-review-approve
```

一次性 PostgreSQL 16 仅绑定
`127.0.0.1:64463/jiangkong_spot_procurement_concurrency_verify`。空库首次完整应用 114 个
迁移，第二次 deploy 明确零待办，`migrate status` 同步，迁移表证明终点恰好一条。三段
限定回执再次全部通过：

- 双 backend 真实锁等待后审批坐标并发单赢家，陈旧请求 409，ActionLog/Audit 唯一且签名
  岗位、代表账号、文件、SHA 和版本精确匹配；
- 缺签与文件/版本 SHA 漂移均在根单、版本、节点、ActionLog、Audit、付款和收货写入前
  失败，调用前后事实完全一致；
- Audit 中段注入故障时已在事务内观察签名 ActionLog、终审状态、付款、收货和三条 Audit，
  抛错后事务外全部回滚且新增行数为零。

runner guaranteed cleanup 删除精确容器
`jiangkong-spot-concurrency-1785633403439-44761` 及其运行时临时目录。独立复核中，
`docker ps --all` 对该容器无输出、64463 无监听、`/private/tmp` 无
`jiangkong-spot-concurrency-*` 目录；固定 114 范围所用的一次性代码快照也已删除。当前工作树
HEAD 仍为 `ea8f5aae80cdb82b29535ae09d2fb18ef3284997`，本次证据只绑定 114 迁移零采审批切片，
不证明当前 116 迁移融资额度门禁。未连接生产、未触碰其他容器，也未运行授权范围外场景。

## 测试与静态门禁

当前精确 diff 的验证结果：

- 目标 5 套 API Jest：5/5 套通过，125 项通过、9 项既有条件跳过；
- 其中申请服务：55/55；runner 结构与清理：14/14；
- API 全量（签名业务实现完成后）：270 套通过、19 套条件跳过，5255 项通过、51 项跳过；
- API `tsc --noEmit`：通过；
- API 全量 `src` lint：通过；
- API production build：通过；
- 业务英文错误门禁：400 个生产 TypeScript 文件通过，54 处允许的内部英文哨兵；
- 两个 CommonJS runner `node --check`：通过；
- `git diff --check`：通过；
- Prisma validate：使用专用虚拟本机 URL 通过，未建立数据库连接；
- Prisma Client 未因本切片改变 Schema；此前已按用户授权完成 generate。

## 独立复核与剩余边界

实现与 PostgreSQL verifier 的独立复核结果：

- P0：0
- P1：0
- P2：共享签名渲染器已有覆盖，但当前切片未新增零采申请 ActionLog 到 PDF 图片的专用回归；
  这不影响审批事实冻结，后续处理 A5 专用渲染链时必须补齐。

真实 PostgreSQL 16 运行补齐了此前唯一缺失的运行时证据；静态 runner 测试不再被当作
真实并发的替代品。

## 本切片闭合与下一步

本切片可提交聚焦 conventional commit。Task 11 下一独立阻断是零星采购付款审批：
`SpotProcurementPaymentService.review()` 仍须按同一不变量冻结 approve 的岗位、代表账号和
签名三元组，并证明 reject/return/withdraw/payer-changed reapproval/void 不伪造签名；A5
读取和专用 PDF 渲染链也须随后闭合。完成这些动作前不得进入 Task 12，也不得把本切片外推
为实施包 5 或五包发布候选完成。

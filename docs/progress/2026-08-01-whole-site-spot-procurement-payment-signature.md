# 实施包 5 Task 11：零星采购付款审批签名与正式表单

## 当前结论

本子任务闭合以下范围：

- `spot-procurement.payment.review-approve` 的岗位、代表账号与手写签名版本冻结；
- `reject`、`return_to_applicant`、`withdraw`、`payer_changed_reapproval` 与 `void` 不伪造签名；
- 零星采购申请 A4 和付款 A5 从冻结 ActionLog 读取并绘制签名图片；
- 付款审批行锁单赢家、缺签/SHA 漂移零写和 Audit 中段故障回滚的真实 PostgreSQL 16 门禁。

本切片没有修改 Prisma Schema 或新增迁移，只复用既有签名快照列和第 114 个终点迁移。
它闭合 Task 11 的付款审批签名与 A4/A5 专用渲染阻断，但不代表 Task 11、实施包 5 或
五包精确发布候选已经完成。

本轮未连接生产，未推送、合并、部署、执行生产迁移或修改生产业务数据；没有执行
transition、retention、业务草稿 purge、正式业务记录删除、AuditLog/checkpoint 清理、
旧表旧字段删除或其他物理删除。

## RED 与后端不变量

改造前的失败证据锁定：

- 付款审批成功动作没有在顶层冻结 `approvedRoleKey`、`representedUserId` 和签名
  file/SHA/version 三元组；
- 缺少有效 canvas 签名或文件/版本 SHA 漂移时，没有付款审批专用的零写证明；
- 审批节点快照损坏时，旧顺序会先读取签名，未做到节点不变量优先失败关闭；
- 驳回、退回、撤回、付款主体变更重审和作废若复用成功动作字段，可能制造不存在的签名；
- A4/A5 只打印姓名和日期，没有将审批时冻结的图片嵌入正式 PDF；
- 渲染器吞掉损坏图片异常时，会产生缺签但看似成功的正式文档；
- 付款 A5 若用当前人员岗位或中文岗位名称回填，会把历史未冻结动作、申请人或上轮审批
  错映射为当前轮签名。

最小实现保持既有串行事务、根/版本/付款/审批锁、pilot、权限、自审、意见、金额、付款主体
和付款方式校验。完整冻结节点先通过 `approveCurrentNode` 校验，只有 `decision=approve` 才在
第一笔持久写入前调用 `snapshotApprovalSignature(..., { required: true })`。成功 ActionLog
精确写入：

- `approvedRoleKey`；
- `representedUserId=actorUserId`；
- `signatureFileIdSnapshot`；
- `signatureSha256Snapshot`；
- `signatureVersionIdSnapshot`。

缺签、非有效文件和文件/版本 SHA 漂移均以 400 失败；付款、审批实例、ActionLog、Audit、
余额账户、reservation 和流水保持调用前快照。驳回和退回不查询签名；撤回、付款主体变更
重审与作废不写虚假岗位、代表账号或签名三元组。

## A4/A5 正式渲染

审批表读取链现在把 ActionLog 顶层 `approvedRoleKey` 和已完成完整性校验的冻结签名文件
buffer 传给零采渲染器：

- 只接受 `actionKey=approve` 且精确岗位匹配的日志；
- 历史没有岗位快照的动作不按当前人员岗位补签；
- 付款主体变更重审时，只使用最后一条 `payer_changed_reapproval` 之后的当前审批轮；
- 申请 A4 绘制物资主管、项目经理两张冻结签名；
- 付款 A5 绘制项目经理、综合部主管、财务主管、董事长/总经理四张冻结签名；
- 经办人格只打印申请时经办人姓名，不伪造审批签名；
- 签名图片下方保留冻结姓名与动作日期；
- 损坏或不受 PDFKit 支持的图片直接使正式渲染失败，不再吞错生成缺签 PDF。

专用 PDF 测试解码内容流并核对 A4 恰好 2 次、A5 恰好 4 次图片绘制和 Image XObject；
同时锁定损坏 A5 图片必须 reject。

## 真实 PostgreSQL 16 证据

用户为本轮单独授权后，只执行：

```text
SPOT_PROCUREMENT_CONCURRENCY_SCOPE=payment-review-approve
node services/api/prisma/run-spot-procurement-concurrency-local.cjs
```

限定 scope 只运行付款审批三段门禁，不运行申请审批、撤回、实付、收货、票据或完整联合
verifier。runner 生成随机密码和随机 loopback 端口，最终有效运行只连接：

```text
127.0.0.1:65448/jiangkong_spot_procurement_concurrency_verify
```

最终运行结果：

- PostgreSQL 镜像：`postgres:16`；
- 第一次 `prisma migrate deploy`：空库完整应用 114 个迁移；
- 第二次 `prisma migrate deploy`：`No pending migrations to apply`；
- `prisma migrate status`：`Database schema is up to date`；
- `_prisma_migrations`：成功迁移数 114，终点迁移恰好 1 条；
- 终点迁移：`20260728161000_spot_procurement_application_revision_status`；
- 行锁竞争：两个真实 backend PID 形成直接阻塞，恰好一个批准成功，loser 严格 409；付款
  进入 `approved_pending_payment`、审批实例完成、唯一 ActionLog 的岗位/账号/签名三元组
  精确匹配、Audit 恰好一条，余额账户、reservation 和流水不变；
- 缺签与版本/文件 SHA 漂移：均为 400，付款、审批、ActionLog、Audit 和余额全部零变化；
- Audit 中段故障：事务内已观察签名 ActionLog、审批完成、付款待实付、Audit 落库且余额
  未变，随后注入异常；事务外全部恢复调用前快照，ActionLog/Audit 为 0。

限定 verifier 回执：

```text
ok spot payment review row lock
ok spot payment approval signatures
ok spot payment approval audit rollback
零星采购付款审批签名 PostgreSQL 16 限定门禁通过
```

首轮真实运行还形成了一条有价值的 RED：第一段并发通过后，第二个夹具因重复付款主体统一
社会信用代码触发真实 functional unique index 的 P2002；脚本立即删除容器和目录。修复后
每个夹具按 seed 派生唯一的 17 位前缀并计算 GB 32100 校验字符，静态测试直接调用正式
`assertValidUnifiedSocialCreditCode` 校验四个代码且证明 `Set.size=4`。独立复核发现并关闭
“18 位但校验位不合法”的 P2 后，才执行上述最终有效空库重跑。

最终一次性容器 `jiangkong-spot-concurrency-1785577160421-83029` 已由 guaranteed cleanup
删除；独立只读复核对该精确容器无输出，65448 无监听，两个系统临时目录根下均无
`jiangkong-spot-concurrency-*` 残留。未触碰其他容器，未连接生产。

## 测试与静态门禁

当前精确 diff 已取得：

- 付款服务目标 2 套 Jest：148 项通过；
- 付款、审批表和零采渲染目标 5 套 Jest：201 项通过、9 项既有条件跳过；
- runner 结构/清理/合法夹具：19/19；
- API 全量：270 套通过、19 套条件跳过，5266 项通过、51 项跳过；
- API `tsc --noEmit`：通过；
- API 全量 `src` lint：通过；
- API production build：通过；
- 业务英文错误门禁：400 个生产 TypeScript 文件通过，54 处允许的内部英文哨兵；
- 三个相关 CommonJS 文件 `node --check`：通过；
- Prisma validate：使用专用不可连接本机 URL 通过，未建立数据库连接；
- `git diff --check`：通过。

真实 PostgreSQL 运行补齐了静态 runner 不能替代的阻塞、事务和约束证据。夹具修复后
6 套目标测试共 220 项通过、9 项既有条件跳过，API 全量与上述静态门禁均已重新执行。

## 独立复核与下一步

独立只读审查首先给出 P0=0、P1=0、P2=1；唯一 P2 是夹具信用代码校验位不合法。该问题
已按正式业务校验器修复并完成 19/19 与真实空库重跑；修复后三处 diff 的最终只读复核为
P0=0、P1=0、P2=0。

本切片收口后仍不得宣称实施包 5 或五包完成。下一步继续依照 Task 11/12 索引核对剩余
动作、浏览器关键路径和发布矩阵；在新的精确候选形成前，不复用任何旧生产授权。

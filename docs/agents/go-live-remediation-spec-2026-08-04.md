# 建工智管上线修复范围固化

日期：2026-08-04
对象：PR #1，分支 `codex/five-package-go-live`
审查起点 / 当前远端 PR SHA：`497ee06e939f8cf3c447bc59f72d035669d96d7e`

## 1. 基线与证据边界

- PR 专用 worktree：`.worktrees/five-package-go-live`，当前 clean，HEAD 为上述 SHA。
- `origin/codex/five-package-go-live` 仍指向上述 SHA；`origin/main` 当前为 `5234fd37bc5c320922f73323af77b20317fcf5f7`。
- 当前主工作树 `/Users/leoyang/Projects/建工智管` 有用户未提交改动，不能 reset、stash、清理或覆盖。
- 本 spec 只覆盖 PR #1 NO-GO 审查后的上线修复；旧 SHA 的证据不能自动复用。每次修复后必须重新绑定精确 SHA。

## 2. 固定修复范围（不扩展产品范围）

### P0 / Task 11 / RC 门禁

1. `POST /files`：消除通用上传路由的认证即放行旁路。服务端必须执行明确的业务权限/项目范围校验；保留私有存储、审计、上传校验和幂等语义。必须有真实路由级测试，覆盖 Guard → ValidationPipe → Service 的调用顺序与拒绝结果。
2. 结算审批过期/失效状态：审批处理在不再是 `approval_pending` 或没有唯一进行中实例时，返回稳定 HTTP 409 和稳定业务码；不得转换为 500，不得写入业务状态。
3. 治理 blocker：按当前 manifest 的真实输出处理 99 个 blocker 与 3 个重复 mutation route，包括 2 个上游 manifest 问题、1 个无 Nest 绑定的 Web request、93 个 orphan wrapper 和 3 个重复 mutation route。禁止通过白名单、降级统计或删除消费者隐藏问题。
4. CI：动态数据库迁移/测试门必须针对当前精确 SHA 运行；manifest、route/action coverage 等 `--require-ready` 门必须 fail closed，不能出现“输出 BLOCKED 但退出 0”。
5. 证据：每份门禁证据包含精确 SHA、分支、运行时间、命令、结果和工作树状态；收口前执行 `git diff --check`，并确认没有证据漂移。
6. RC-06：生产等价浏览器长链覆盖真实岗位与桌面 Chromium 1366×768、移动 WebKit 390×844；覆盖 503、400/403/409、双击/重试幂等、移动端上传/下载，以及控制台错误、404、重复 POST。
7. RC-09 / 阶段 F：只在同一候选 SHA 上完成备份隔离恢复、监控与日志证据、维护/停写/恢复演练，并记录生产等价部署、readiness、回滚证据。不得触碰生产业务数据。

## 3. 明确不在范围内

- 不新增业务模块、角色、审批类型或产品能力；不扩展到 C2、Task 12、M2/M3 或历史清理。
- 不 push、不合并、不部署；不执行生产数据库、对象存储、备份或停写操作。
- 不把“P0 清零”表述为 Task 11 已通过；Task 11、RC-06、RC-09、阶段 F 必须分别有同一 SHA 的证据。
- 不修改主工作树中的既有用户改动。

## 4. 完成定义

每张票必须按 `RED 测试 → 最小修复 → 定向验证 → /code-review 等价审查 → PROGRESS 记录` 完成，并留下可复核命令和结果。最终只有在所有 P0、Task 11、RC-06、RC-09、阶段 F 门禁通过后，才能提出“允许用户单独授权生产操作”的请求；在此之前不得 push、合并或部署。

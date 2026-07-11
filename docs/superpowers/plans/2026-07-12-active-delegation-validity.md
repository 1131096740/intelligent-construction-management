# Active Delegation Validity Plan

**Goal:** 统一常驻审批委托的有效性边界：委托人与受托人都必须是启用人员，停用任一端后不得继续产生 HTTP Guard、详情可办、审批中心待办或合同/结算/付款写入权限。

**Boundary:** 只修 standing `ApprovalDelegation`；不删除或批量停用历史委托记录，不修改 frozen node `assignments`，不改变 direct → frozen assignment → standing delegation 的真实解析顺序，不做 Schema/生产数据变更。

## Shared evaluator

- 新增无 Nest DI 的共享函数，client 最小包含 `approvalDelegation.findMany` 与 `user.findMany`。
- 先按 `toUserId + enabled + startsAt/endsAt` 查询当前时间窗委托，再一次查询受托人及去重后的委托人启用状态。
- 受托人缺失/停用直接返回空；只返回存在且启用的委托人 ID，保持首次出现顺序并去重。
- `ApprovalDelegationService.activeDelegatorIds` 委托给共享函数；合同/结算/付款写侧继续在原事务 client 中调用，因此最终写入前会再次复核。

## Consumers

- `PermissionGuard.hasDelegatedProjectActionRole` 复用共享函数，再按项目岗位与 `ACTION_REQUIRED_ROLES` 判断。
- Contract/Settlement/Payment 三个 ReadService 的 standing delegation 分支复用共享函数；direct 与 frozen assignment 分支保持。
- `MeService.hasDelegatedApprovalTodo` 复用共享函数；项目支出继续不支持 standing delegation。
- 组织岗位影响模拟已同时过滤双方 active，保持现状并加显式回归。
- `listForUser` / revoke 是历史与管理账本，不按 active 隐藏记录。

## TDD and verification

- 共享函数：双端启用成功与去重；from 缺失/停用排除；to 缺失/停用返回空；时间窗查询参数固定。
- Guard：active to + inactive from + 残留岗位返回 403；双端启用继续允许。
- 三个 ReadService：无 direct/frozen assignment 时，双端启用可办、from 停用不可办。
- Me：停用 from 不产生 delegated todo/计数，双端启用保持；project expense 继续忽略。
- 写侧：保留三域调用 `activeDelegatorIds(tx, actor)` 的既有回归；共享 helper 证明其事务内结果已过滤 active。至少锁定 frozen assignment 在无 standing delegation 时仍按原规则工作。
- 组织 impact：inactive from/to 不进入 delegation coverage。
- 运行 approval/auth/read/me/三域必要 Jest、API business-errors/typecheck/lint/build、`git diff --check`；独立安全复审后更新 `PROGRESS.md`。

## Known limit

- 本切片消除所有已提交的 inactive 状态授权；不宣称解决“人员停用事务与审批事务恰好并发提交”的数据库串行化竞态。若现场需要严格并发证明，另做用户行锁/隔离级别专项。

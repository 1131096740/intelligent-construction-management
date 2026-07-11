# Role Removal Web Implementation Plan

**Goal:** 在现有“组织权限”页开放逐条岗位撤销的安全交互：管理员先查看服务端影响预览，仅在 `canApply=true` 时输入当前密码，并原样携带快照 hash 调用 apply。

**Scope:** 只接入已有 remove preview/apply；不开放岗位新增、批量变更、自动修复、legacy 迁移或生产操作。

## 1. 设计与组件边界

这是现有 TDesign 管理页中的小型功能切片，沿用既有页面、`--jg-*` token 和 TDesign 控件；不生成新的视觉概念，不引入第二套设计系统。

人员表继续保留岗位摘要，在操作列增加“岗位管理”。点击后打开独立 `OrganizationRoleRemovalDrawer`，避免把影响表、密码和状态机继续塞进现有部门/人员对话框。

抽屉固定包含：

1. 人员与“当前仅支持逐条撤销，新增尚未开放”的说明。
2. 从目录读模型生成的全局/项目岗位清单；每行一个确切 `userId/scope/projectId/roleKey`，不提供复选框。
3. 服务端预览结果：阻断项、受影响审批、当前节点、待审岗位、服务端 `canApply`、影响版本校验码。
4. 仅当 `preview.canApply=true` 且预览未过期时显示当前密码和“确认撤销”。

固定岗位字典仍只读；页面不根据项目岗位合并摘要判断底层来源，legacy shadow/规范目标完全交给后端。

## 2. API 契约

在 `organization.api.ts` 增加完整类型和两个方法：

- `previewOrganizationRoleRemoval(target)` -> `POST /organization/role-changes/preview`
- `applyOrganizationRoleRemoval(payload)` -> `POST /organization/role-changes/apply`

请求体逐字段白名单构造：

- preview 绝不发送密码或 hash。
- apply 原样发送服务端 `snapshotHash` 和当前密码，不发送 assignment ID、actor 或审计字段。
- global 不发送 `projectId`；project 必须发送。

组织 API 错误保留 HTTP status，供抽屉在 409 时把预览标记为过期并强制重新预览；其他错误只清空密码，保留目标和预览。

## 3. 纯函数与状态规则

在 `organization.config.ts` 增加：

- 从人员目录稳定生成逐条撤岗 target。
- 业务类型、mode、阻断 reason 的中文映射和安全未知值兜底。
- 影响表行转换。
- apply payload 构造与密码校验。
- target 与 preview.change 严格一致性检查。

UI 只信服务端 `canApply`：

- 即使 `blockingIssues=[]`，只要 `canApply=false` 就不显示密码。
- 即使存在影响记录，只要 `canApply=true` 仍可进入验密。
- 不按阻断项数量、reason 或 roleCoverage 在 Web 重算安全结论。

切换岗位目标、关闭抽屉、apply 成功或失败都清空密码；切换目标同时清空旧预览。409 保留旧结果用于解释，但禁用再次 apply，必须重新预览。

## 4. 页面刷新

apply 成功后不做乐观更新：

- 关闭抽屉。
- 并行重新读取组织目录与权限完整性预检。
- 两者都成功：提示岗位已撤销并已刷新。
- 任一失败：明确提示写入已生效但部分刷新失败；成功读取的数据不得被另一请求失败清空。

抽屉打开期间禁用页面刷新和其他编辑入口，避免跨目标复用旧预览。

## 5. TDD 与验证

先写 RED：

- API URL/method/请求白名单、preview 无密码/hash、apply hash/密码原样提交、409 status 保留。
- target 按全局/项目逐条稳定生成，同一项目多岗位不合并成一个写请求。
- 矛盾响应证明只信 `canApply`。
- target/preview 不一致拒绝构造 apply。
- global payload 无 projectId，project 缺 projectId 拒绝。
- 密码空白/长度边界。
- `approval_execution_semantics_not_safe`、未知 reason/business type 中文安全兜底。
- 页面结构检查：独立 drawer、无岗位新增/批量控件、成功事件同时刷新目录和完整性。

门禁：

```bash
pnpm --filter @jiangkong/web-admin test -- organization.api.test.ts organization.config.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

最后使用本地浏览器或 Playwright mock 验证“阻断不出现密码”和“放行后提交原始 hash + 密码”两个核心状态；若现有登录/数据环境无法稳定进入页面，记录具体阻断并以聚焦 mock 浏览器用例替代。

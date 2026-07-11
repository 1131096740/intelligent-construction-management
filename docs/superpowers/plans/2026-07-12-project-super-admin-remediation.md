# Project Super Admin Remediation Plan

**Goal:** 让权限完整性预检发现的规范 `ProjectMember(positionKey=super_admin)` 可以走现有“预览 -> hash -> 验密 apply -> 审计”安全链路清理，解除真实岗位新增前的 readiness 阻断。

**Boundary:** `super_admin` 仍绝不允许新增到项目范围，也不进入正常业务岗位目录；本切片只允许删除已存在的唯一规范异常事实，不自动删除、不批量修复、不连接或改写生产。

## Backend

- `PermissionImpactService` 不再把 project + `super_admin` 的 remove 目标标记为 `project_super_admin_forbidden`。
- 仍要求：人员、Position、Project 和唯一 ProjectMember 目标存在；目标重复/缺失 fail closed；legacy shadow fail closed；所有在途审批映射和 hash 规则保持。
- `super_admin` 不是任何业务审批岗位，`buildDirectFacts` 继续忽略项目级 super_admin；若出现包含该岗位的异常在途节点，仍按现有严格解析/fail-closed 处理。
- apply 继续只按事务内重新解析的唯一 `ProjectMember.id` 删除、撤销目标 refresh token并同事务审计。
- DTO 不支持 add；项目 super_admin 新增仍没有任何 API。

## Web

- 正常人员目录继续过滤项目级 super_admin，不把异常事实展示为合法项目岗位。
- 权限完整性问题表仅对满足下列全部条件的行显示“预览清理”：
  - `code=project_super_admin`
  - `source=project_member`
  - `userId/projectId/roleKey` 完整，且 `roleKey=super_admin`
- 点击后从目录读取人员、固定岗位字典构造一个单条 remediation target，注入现有岗位管理抽屉；管理员仍需手动点击预览。
- legacy `UserPosition` 来源不提供按钮，避免删除错误规范源；其他问题不提供自动修复。
- 后续 preview/canApply/hash/password/apply/双刷新完全复用现有状态机。

## TDD / verification

- Backend RED：现有 project super_admin 测试从“禁止撤销”改为“唯一规范事实可预览”；目标缺失/重复、legacy shadow 仍阻断。
- Web RED：只有 canonical project_member super_admin 行生成 remediation target；缺字段、legacy 来源和其他 code 均返回 null；页面结构只在该行开放入口并注入抽屉。
- 回归 API 组织岗位 4 套 Jest、Web 组织 3 套 Vitest、typecheck/lint、business-errors、check:ui、API/Web build、Playwright 岗位撤销 mock、`git diff --check`。
- 独立安全复审后提交；不运行生产修复。真正删除生产异常事实仍需用户明确授权、发布新版本并在 Web 中人工预览确认。

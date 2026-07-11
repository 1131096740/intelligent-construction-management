# Role Addition Web Plan

**Goal:** 在“组织权限”页为启用人员提供单条全局/项目岗位新增交互，完整复用后端 `preview -> hash -> 当前密码 -> apply -> 双刷新` 安全链路，不从人员现有岗位反推可选项目。

**Boundary:** 只支持一次新增一条岗位；不支持批量、替换、项目级 `super_admin`、legacy 迁移、自动 apply、真实数据初始化或生产操作。现有岗位撤销抽屉与项目级异常清理入口保持独立。

## Directory read contract

- `GET /organization/directory` 增加稳定排序的项目目录 `projects: [{ id, code, name, isActive }]`，只在既有全局 `super_admin` 保护下返回。
- Web 只把启用项目作为 project scope 候选；停用项目仍保留在只读响应中，便于治理核对，但不允许新增。
- 不使用 `/projects` 的业务可见范围代替治理项目目录，也不从目标人员已有 `projectPositions` 推断全公司项目。

## Web interaction

- 人员表为启用人员提供“新增岗位”；停用人员不允许进入新增流程并显示明确原因。
- 新增使用独立 TDesign drawer，目标人员固定，只允许选择：
  - scope：全局岗位 / 项目岗位；
  - project：仅 project scope 必填，来源为启用项目目录；
  - role：全局排除该人员已有全局岗位，项目排除 `super_admin` 与该人员在目标项目已有岗位。
- scope/project/role 任一变化都清空 preview、snapshot hash 和密码；不自动发起 preview。
- preview 请求不发送密码/hash；展示服务端 blocking issues、受影响节点、before/after 解析通道/岗位/自审与阻断原因。
- 只有服务端 `canApply=true`、响应 change 与当前选择完全一致且 preview 未被修改失效时，才显示当前密码和“确认新增”。
- apply 原样发送当前 change、服务端 hash 与密码；409 清空 preview/password并要求重新预览。所有失败、切换、取消、关闭和成功路径都清空密码。
- 成功后不乐观修改岗位；关闭 drawer，分别刷新组织目录和权限完整性，任一失败不覆盖另一份已成功数据。

## Fail-closed UI rules

- project scope 不得选择或提交 `super_admin`；global 不得夹带 projectId，project 必须提交非空 projectId。
- 目录 readiness 未通过时仍可打开并读取服务端 preview 阻断原因，但 UI 不自行重算或绕过 `canApply`。
- 用户、项目、岗位不在最新目录或状态已变化时停止请求并提示刷新；不静默修正非法 runtime enum。
- 不接受客户端 assignment ID，不提供 createMany/batch/auto repair。

## TDD and verification

- API directory：项目 id/code/name/isActive、稳定排序、启停均返回、既有目录岗位语义不变。
- Web API/config：运行时 add/scope 坐标校验、候选项目/岗位过滤、目标与响应严格匹配、apply payload、409 状态保留。
- Component/page：不自动 preview、切换清空、密码生命周期、停用人员、双刷新、撤销抽屉互不串状态。
- Playwright mock：选择启用项目岗位 -> preview -> 输入密码 -> apply -> 目录/完整性双刷新；同时断言 preview 无密码、apply 含 hash/密码、project super_admin 不可选。
- 运行 API targeted Jest/typecheck/lint，Web focused/full Vitest、typecheck/lint/check:ui/build、Chromium E2E、`git diff --check`；独立复审后更新 `PROGRESS.md`。

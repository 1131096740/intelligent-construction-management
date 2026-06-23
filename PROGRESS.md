# 建工智管 - 进度记录 (PROGRESS)

> 本文件是项目的**唯一进度真相**。AGENTS.md / CLAUDE.md 描述"规则与边界"，本文件描述"做到哪了"。
>
> **协同纪律**：CodeX 和 Claude 每完成一个子任务，必须在此勾选/更新，并随代码一起 commit。接手方开工第一件事就是读本文件。

图例：`[x]` 完成 · `[~]` 部分完成/有雏形 · `[ ]` 未开始

---

## 最近变更 / 下一步（滚动更新，最新在最上）

- 2026-06-23 (CodeX)：合同/付款终审 OR-sign 接入 ApprovalInstance。合同提交审批时冻结 `contract.approve` 董事长/总经理或签节点；付款申请创建时冻结 `payment.approve` 董事长/总经理或签节点；审批通过/驳回均推进或关闭实例并写 `ApprovalActionLog`，审计元数据带节点和角色。API 95 个单测 + typecheck + lint 通过。
- 2026-06-23 (CodeX)：落地结算审批最小引擎闭环。创建结算时按合同名称/相对方冻结 `settlement.approve` 节点：物资/机械类走物资员 → 物资主管 → 合同部主管+预算部主管会签 → 项目经理 → 财务总监；劳务/专业分包类走工长 → 项目总工 → 工程技术部 → 合同部主管+预算部主管会签 → 项目经理 → 财务总监。审批接口按当前冻结节点校验岗位、记录 ApprovalActionLog、支持会签节点逐人推进；`verify-core-flow.cjs` 已改为完整材料类结算审批序列。API 93 个单测 + typecheck + lint 通过。
- 2026-06-23 (CodeX)：完成 Web 管理端登录页与前端鉴权态。新增 Pinia auth store、统一 `apiFetch` Bearer 注入、401 自动 refresh 后重试/失效跳登录、`/login` 公开路由与业务页守卫；写操作 payload 移除旧 `*UserId` 表单字段，操作人统一来自 access token。`web-admin` 57 个单测 + typecheck 通过。
- 2026-06-23 (Claude)：业务写端点全部挂上鉴权。新增 `@CurrentUser()` 取登录态操作人；合同/结算/付款/文件控制器去掉 `@Public()`，12 个受守写动作各挂 `@RequireProjectRole(<action>)`；DTO 删除 `*ByUserId`，service 改为显式 `actorUserId` 参数；文件下载（票据鉴权）保留 `@Public`。`verify-core-flow.cjs` 改为多身份登录 + Bearer，并新增两条安全回归（未登录写 401、错误岗位用章 403）。本机 Docker PG + API 实跑 `verify:core-flow` 全绿；89 个单测 + typecheck + eslint 通过。
- 2026-06-23 (CodeX)：完成 services/api 认证管道：User 密码字段 + RefreshToken migration、17 岗位 seed、手机号密码登录/refresh/logout/改密/微信登录、全局 JwtAuthGuard 与 PermissionGuard（暂未挂业务端点）。
- 2026-06-22 (Claude)：认证授权设计方案 `docs/design/建工智管_认证授权设计.md`；权限核心 `packages/shared-domain/src/permissions.ts`（动作→岗位策略表、或签语义、有效岗位合并）+ 单元测试，已接入导出。
- 2026-06-22 (CodeX)：本机 Docker PostgreSQL + API 实跑 `verify:core-flow` 通过，Milestone 1 收口。
- 2026-06-22 (Claude)：新增 CLAUDE.md、PROGRESS.md，建立双 AI 协同流程。
- **下一步**：处理审批引擎的驳回上一节点 / 打回申请人，优先从结算审批实例开始做最小闭环。

---

## Milestone 1：本地可运行业务闭环

- [x] Monorepo + GitHub 远端 (origin: 1131096740/intelligent-construction-management)
- [x] Prisma schema（27 个模型）
- [x] 数据库 migrations（6 个）
- [x] seed 核心链路数据 (`prisma/seed.cjs`)
- [x] 核心读 API：合同 / 结算 / 付款 详情
- [x] 闭环验证脚本 `verify-core-flow.cjs`（覆盖合同→结算→付款全链路 + 审计核对）
- [x] **在本机数据库实跑 `verify:core-flow` 通过**

## Milestone 2：合同状态机（API 层已成型，无权限校验）

- [x] 合同草稿创建（同时建版本 v1 + 付款条款 v1）
- [x] 提交审批 → 审批通过 → 用章 → 上传归档件 → 归档确认 → 生效
- [x] 节点操作的"谁能做"权限校验（写端点挂 `@RequireProjectRole` + PermissionGuard，操作人取登录态）

## Milestone 3：结算状态机（API 层已成型）

- [x] 仅允许从 effective 合同版本创建结算
- [x] 结算审批 → 上传归档件 → 归档确认 → 生效
- [x] 结算绑定原合同版本 + 付款条款版本

## Milestone 4：付款审批与实际付款（API 层已成型）

- [x] 从生效结算创建付款申请
- [x] 后端事务校验剩余可付额度（分为单位整数）
- [x] 付款审批通过 → `approved_pending_payment`
- [x] 出纳实际付款登记 + 凭证文件
- [x] 财务流水记录
- [x] 付款 PDF 留档记录 + 最终状态 `paid`
- [x] 支持同一结算多付款申请 / 同一申请多次执行

## Milestone 5：审批引擎完善

- [x] 审批动作 / 节点模式 共享定义 (shared-domain)
- [~] 审批节点冻结服务 (`approval-freeze.service`)
- [x] 会签 / 或签 流转（结算审批支持冻结节点会签；合同/付款终审 OR-sign 已接 ApprovalInstance）
- [~] 条件节点（结算审批已按合同名称/相对方推断物资机械 vs 劳务专业分包路线；缺显式合同类型字段）
- [ ] 驳回上一节点 / 打回申请人 / 撤回
- [ ] 转审 / 委托代理
- [ ] 超时催办

## Milestone 6：文件、PDF、审计、安全

- [x] 审计日志已接入核心动作（合同/结算/付款共 12 类动作）
- [~] 私有文件上传流程（本地实现，**COS 私有桶未接**）
- [ ] 文件下载权限校验 + 短时效 URL
- [ ] 真正生成 PDF（目前仅记录归档文件，未生成）
- [ ] 文件水印 / 敏感操作二次确认

## 认证与授权（上线头号短板）

- [x] 设计方案 `docs/design/建工智管_认证授权设计.md`（登录方式：Web 手机号+密码 / 小程序微信一键登录）
- [x] 权限核心纯逻辑 + 单测 `shared-domain/permissions.ts`（动作→岗位策略表、或签、有效岗位合并）
- [x] 登录 / 员工绑定 / 会话（CodeX，手机号密码登录 + 微信登录入口；员工绑定流程待小程序阶段细化）
- [x] JWT access+refresh + 改密（CodeX）
- [x] 角色 + 岗位 + 项目授权的后端权限中间件（Guard 接 permissions.ts，已挂全部业务写端点）
- [x] 改造现有写端点：操作人取登录态（`@CurrentUser()`），不再信任请求体 `*ByUserId`（DTO 已删除该字段）
- [x] 更新 `verify-core-flow`：分步骤用不同身份登录（Bearer token）+ 安全回归（未登录 401 / 错误岗位 403）
- [x] ~~接口"前端传谁就信谁"~~ 已解决：未登录写接口 401，错误岗位 403（含 create/上传仅要求登录）

## Web 管理端

- [x] 企业后台布局
- [x] 合同 / 结算 / 付款 / 资料库 / 审计 台账页 + 详情页骨架
- [x] 核心读 API 客户端 + 页面配置测试
- [~] 写操作接入（归档、付款部分动作已 wire；已携带登录态 token）
- [x] 登录页 / 前端鉴权态（携带 access token、401 自动刷新或跳登录）

## Milestone 7：小程序移动端

- [ ] 未开始（`apps/miniprogram` 尚未建立）

## Milestone 8：部署上线

- [ ] 生产环境变量 / 密钥管理
- [ ] HTTPS / 域名
- [ ] PostgreSQL 不公开 + 每日备份且演练恢复
- [ ] 附件备份 / 日志监控 / 上线初始化脚本

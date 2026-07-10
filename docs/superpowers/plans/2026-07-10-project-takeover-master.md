# Project Takeover MVP Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不推倒现有系统的前提下，把已批准的项目接管设计实施为可用真实数据、可审计、可持续小步发布的建工智管第一版。

**Architecture:** 保留 Vue 3 + TypeScript + TDesign、NestJS、PostgreSQL、腾讯 COS 私有桶和现有 GitHub Actions 发布链路。先恢复唯一发布基线，再依次完成组织权限、合同办公化、结算办公化和付款资金闭环；所有金额、权限、状态、文件和审计规则由后端账本决定。

**Tech Stack:** Vue 3, TypeScript, TDesign Vue Next, Vite, NestJS, Prisma, PostgreSQL, Tencent COS, Jest, Vitest, Playwright, GitHub Actions.

---

## 1. 执行原则

- 业务规格以 `docs/superpowers/specs/2026-07-10-project-takeover-mvp-design.md` 为准。
- 进度以 `PROGRESS.md` 为唯一真相；每个可独立验收的子任务更新进度并单独提交。
- 不重写现有系统，不引入低代码、BPMN、ERP 运行时、第二套 UI 库或在线 Office 平台。
- 前台遵循“像办公工具”，后台遵循“像业务账本”；Word/Excel 只提供编辑体验，不覆盖结构化金额、状态和版本事实。
- 当前分支 `codex/office-workbench-plan-20260709` 以 `main` 为直接祖先；2026-07-10 基线为 `0 behind / 246 ahead`。发布前必须重新检查这一事实，不把该数字当作永久常量。
- 生产发布只允许来自 `main`，由 `.github/workflows/deploy-production.yml` 完成验证和部署。
- 每个阶段先写或刷新该阶段的逐任务计划，再执行；后续阶段的详细文件清单必须基于前一阶段完成后的真实代码，避免提前制造过期计划。

## 2. 当前基线

2026-07-10 已验证：

- API Jest：62 个测试套件中 60 个通过，1048 个测试中 1046 个通过。
- 仅有的两处失败是陈旧英文断言：
  - `services/api/src/contract-bill/contract-bill.service.spec.ts`
  - `services/api/src/business-party/business-party.service.spec.ts`
- 实际业务错误已由 `services/api/src/contract-workbench/contract-render-input-revision.ts` 中文化为“合同草稿已变化，请刷新后重试”。
- Web Vitest：39 个文件、301 个测试全部通过。
- API/Web typecheck、API/Web lint、Web `check:ui` 全部通过。
- 生产工作流只监听 `main`；当前实现尚未进入唯一生产发布主线。
- `PrivateFileStorage` 已具备 COS PUT/GET 和后端短时效下载票据，不应重写；缺口是正式生产配置验收、失败清理、文件完整性元数据和替换版本语义。
- Prisma 金额字段混用 `Int` 与 `BigInt`，`PaymentRequest`、`Settlement`、`PaymentExecution`、`FinanceRecord`、`ProjectExpenseRequest` 等核心表仍存在 32 位溢出风险。

## 3. 阶段依赖与发布节奏

```text
阶段 0 可发布基线
  -> 阶段 1 组织权限与真实业务基础
  -> 阶段 2 合同工作台与合同模板
  -> 阶段 3 结算工作台与结算模板
  -> 阶段 4 付款、报销、零星采购与资金闭环
  -> 1 个真实项目 + 约 20 个历史合同 + 3-5 个活跃合同试运行
```

- 阶段 0 内部顺序：0A 发布真相 -> 0B 大额金额 -> 0C COS -> 0D 输入校验与生产复验。
- 0B 与 0C 可在 0A 通过后从同一最新基线分别开发，但合入和数据库迁移必须串行。
- 阶段 2 的模板后端与合同工作台前端可并行；发布前必须共同通过正文/结构化数据一致性验收。
- 阶段 3 的结算模板与网页表格可并行；导入应用和金额重算必须由同一个后端规则收口。
- 阶段 4 的普通付款与报销/零星采购界面可并行；项目现金扣减事务只能有一个共享实现。

## 4. 阶段 0：恢复可发布基线

详细计划：

- `docs/superpowers/plans/2026-07-10-phase0a-release-truth.md`
- `docs/superpowers/plans/2026-07-10-phase0b-money-bigint.md`
- `docs/superpowers/plans/2026-07-10-phase0c-cos-private-files.md`
- `docs/superpowers/plans/2026-07-10-phase0d-api-validation-production.md`

交付：

- 唯一发布主线和可回滚生产基线。
- 所有业务金额 PostgreSQL `BIGINT`、API 十进制字符串、前端按元显示/录入。
- 现有 COS 能力完成生产接入、孤立对象清理和文件完整性元数据补强。
- 关键写接口具备白名单输入校验，用户只看到中文业务错误。
- 正式域名、HTTPS、数据库迁移、备份、API/Web、私有文件上传下载和审计复验通过。

退出门槛：

- `pnpm test`、`pnpm typecheck`、`pnpm lint`、Web `check:ui`、API/Web build 全部退出 0。
- 超过 2100 万元的单笔和累计金额测试通过，无 `number` 精度丢失。
- COS 上传、数据库登记、鉴权下载、过期拒绝、越权拒绝、失败清理和审计通过。
- `https://jgzg.site/api/health` 返回成功，生产 commit 与 `origin/main` 一致。

## 5. 阶段 1：组织权限与真实业务基础

主要文件与模块：

- 后端：`services/api/src/organization/`、`services/api/src/auth/guards/permission.guard.ts`、`services/api/src/auth/project-visibility.service.ts`、`services/api/src/project/`、`services/api/src/contract-takeover/`。
- 数据库：`User`、`Department`、`Position`、`UserPosition`、`ProjectMember`、`ContractTakeover`、`ProjectOwnerContract` 及对应迁移。
- 前端：`apps/web-admin/src/pages/settings/`、`apps/web-admin/src/pages/projects/ProjectRosterPage.vue`、`apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`。
- API：在 `apps/web-admin/src/api/` 新增独立 `organization.api.ts`，项目和接管继续复用现有领域 API。

任务包：

- [ ] 建立部门、人员、固定岗位、全局岗位和项目岗位的后端管理 API；所有变更写权限审计。
- [ ] 建立完整组织权限 UI：部门树、人员状态、岗位分配、项目成员范围、批量移除前影响提示。
- [ ] 固化董事长/总经理可兼任 `super_admin`，但业务审批仍按业务岗位判断。
- [ ] 固化除董事长/总经理以外的自审禁止；董事长/总经理自审要求原因、二次确认和审计。
- [ ] 完成历史接管 A/B/C 风险、独立生命周期和受限确认；争议金额不得进入下游可付款容量。
- [ ] 用 1 个真实项目的脱敏小样验证业主主合同、项目范围、文件权限和金额口径。

验收：

- 普通账号只能看到所属项目；越权 API 返回 403 且不泄漏对象是否存在。
- 组织权限变更前后均可在审计日志追溯人员、岗位、项目、操作人和时间。
- C 级合同可受限确认，但争议金额在结算和付款预览中为不可用。
- 针对性 Jest/Vitest、API/Web typecheck、lint、Web `check:ui`、Playwright 组织权限冒烟通过。

## 6. 阶段 2：合同工作台与合同模板

主要文件与模块：

- 后端：`services/api/src/contract-workbench/`、`services/api/src/contract-template/`、`services/api/src/contract-document/`、`services/api/src/contract-bill/`、`services/api/src/contract/`。
- 前端：`apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`、`apps/web-admin/src/pages/contracts/workbench/`、`apps/web-admin/src/pages/contract-templates/`。
- API：`apps/web-admin/src/api/contract-workbench.api.ts`。
- 数据库：`ContractVersion`、`PaymentTermsVersion`、`ContractBusinessTemplate*`、`ContractLayoutTemplate*`、`ContractGeneratedDocument`、`ContractOfflineRevision`。

任务包：

- [ ] 把新建合同收敛为“项目 -> 业务场景 -> 推荐模板 -> 预览/更换 -> 创建草稿”。
- [ ] 把合同工作台重构为“正文画布 + 业务侧栏 + 顶部阶段/保存/主操作”，保留现有稳定路由。
- [ ] 实现 Word 下载、线下编辑、上传修订、预览、修订历史和提交前差异检查。
- [ ] 把模板库收敛为普通用户浏览/使用、合同主管和授权管理员配置。
- [ ] 完成 Office 优先模板版本：中文变量检查、测试数据 DOCX/PDF 预览、发布后不可覆盖、克隆新版本。
- [ ] 完成合同变更/补充协议入口，新版本重新审批、用印、归档，旧结算/付款保持原版本引用。

验收：

- 合同员可从场景推荐创建草稿并完成结构化字段、付款条款、清单和 Word 往返。
- 正文金额、付款条款或清单与账本不一致时不能提交审批，并明确指出差异。
- 已发布模板不可覆盖；历史生成、审批和归档文件不随新模板变化。
- 合同变更生效后生成新合同版本，旧业务引用不漂移。

## 7. 阶段 3：结算工作台与结算模板

主要文件与模块：

- 后端：`services/api/src/settlement/`，并新增结算 Excel 导入预检/应用服务，复用现有 `exceljs`。
- 前端：`apps/web-admin/src/pages/settlements/SettlementListPage.vue`、`SettlementDetailPage.vue`，新增 `apps/web-admin/src/pages/settlements/workbench/`。
- API：在 `apps/web-admin/src/api/` 新增 `settlement-workbench.api.ts`，不在页面直接 `fetch`。
- 数据库：`Settlement`、`SettlementLine`、结算模板版本和导入批次/错误明细模型。

任务包：

- [ ] 新建结算改为选择有效合同后引出合同清单，不再先录入总金额。
- [ ] 建立全宽表格工作台：粘贴、多行编辑、批量备注、固定合计、异常抽屉和依据附件。
- [ ] 保留并统一 Excel 模板下载、导入预检、确认应用和结果导出。
- [ ] 后端按明细重算本期金额、累计金额和异常项，不信任前端合计或 Excel 公式。
- [ ] 建立结算模板的 Excel 上传、变量/列检查、测试结算与 PDF 预览、版本发布。
- [ ] 保持现有结算审批、签章归档、生效和付款来源规则不回退。

验收：

- 业务人员可从合同清单创建结算，网页录入与 Excel 导入得到一致金额。
- 导入错误逐行展示，未确认前不写业务表；重复应用具有幂等保护。
- 超量、负数、重复期间、无效合同版本等后端硬拦截通过。
- 结算归档确认后才生效并可进入付款来源。

## 8. 阶段 4：付款、报销、零星采购和资金闭环

主要文件与模块：

- 后端：`services/api/src/payment/`、`services/api/src/project-expense/`、`services/api/src/project/`、`services/api/src/approval/`。
- 前端：`apps/web-admin/src/pages/payments/`、`apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue`、现有报销/零星采购页面及配置。
- 数据库：`PaymentRequest`、`PaymentExecution`、`PaymentExecutionAllocation`、`FinanceRecord`、`ProjectExpenseRequest`、`ProjectExpenseExecution`、`ProjectOwnerContract`、`ProjectReceipt`，并新增现金池调整账本。

任务包：

- [ ] 普通付款只允许有效结算、有效合同预付款条款、已确认或受限确认的历史期初结算。
- [ ] 普通付款审批固定为经办人 -> 综合部主管 -> 项目经理 -> 财务总监 -> 董事长或总经理。
- [ ] 报销固定为申请人 -> 综合部主管 -> 项目经理 -> 财务总监 -> 董事长或总经理。
- [ ] 零星采购固定为经办人 -> 物资主管 -> 项目经理 -> 财务总监 -> 董事长或总经理。
- [ ] 付款审批不占用现金；实付确认事务绑定回单、重算来源和现金、扣减现金池、写财务记录和审计。
- [ ] 建立现金池调整账本：财务人员申请增减、财务总监确认，不允许直接覆盖余额。
- [ ] 业主有效合同控制承诺成本；超额由董事长或总经理授权，结算/付款不重复占用。
- [ ] 实付、报销和零星采购全部实现重复提交幂等、余额不足、超额、回单缺失和来源失效拦截。

验收：

- 审批通过只进入“已批准待付款”；未上传并确认回单不扣现金。
- 同一幂等键重复确认实付只产生一次扣减、一次财务记录和一次最终状态迁移。
- 现金不足时整个事务失败，回单不被绑定为成功、现金不扣减、付款状态不前进。
- 普通付款、报销、零星采购三条真实账号链路均完成审批、实付、凭证、PDF、审计。

## 9. 真实试运行与持续发布

- [ ] 在系统 UI 中建立 1 个真实项目、部门/人员/项目岗位和业主主合同。
- [ ] 接管约 20 个已签在执行历史合同，逐份复核 A/B/C、生命周期、资料缺口和可确认金额。
- [ ] 选择 3-5 个活跃合同跑通合同/变更、结算、付款、实付、凭证、PDF 和审计。
- [ ] 用户直接收集问题；每个问题按“复现 -> 规则确认 -> 最小修复 -> 自动测试 -> 用户复验 -> 发布健康检查”闭环。
- [ ] 不建设 Go-Live 签字材料和发布审批模块；保留测试、备份、迁移、健康检查和 `PROGRESS.md` 记录。

## 10. 总体验收标准

- 真实普通用户不接触内部 ID、状态码、字段名、COS Key 或英文技术错误。
- 所有金额可覆盖超过 2100 万元的单笔与累计场景，数据库、API、前端无溢出和精度丢失。
- 合同、结算、付款按原合同版本和付款条款版本可追溯。
- 私有文件只通过后端权限和短时效链接访问；上传、替换、确认、下载均可审计。
- 项目范围越权、角色越权、自审越权均有后端测试。
- 生产域名、HTTPS、备份、迁移、健康检查稳定；每次发布都能定位到 `origin/main` 的具体 commit。

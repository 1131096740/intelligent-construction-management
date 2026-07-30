# 合同工作台 Release B API 读模型二次修复候选

日期：2026-07-30
运行代码提交：`e2fb6706d24d592dfe8d95eb8565e21b81bff7e1`
直接发布基线：`7229c061bc838c2eee3ad4e85897f9d2e5de3e5a`
状态：本地门禁完成，生产保持回滚状态，等待新精确 SHA 授权。

## 1. 失败链与最小修复

`7229c061…` 已包含共享模型和 Web 保存链对 `allowsEarlyPayment` 的透传，但生产
Release B 的无 token 前置检查证明真实工作台 GET 仍返回 `undefined`。

根因是 `ContractWorkbenchService.getDraftFromExactVersion` 查询付款阶段时采用显式
Prisma `select`，其中没有选择数据库已存在的 `allowsEarlyPayment`。这使前端类型与
序列化修复没有真实输入值。

本候选只增加：

```ts
allowsEarlyPayment: true
```

它位于 `paymentTermsStage.findMany` 的只读 select。没有 Schema 或迁移变化，不改变
付款规则、金额、状态、权限、租约、revision、审计或任何写入逻辑。

## 2. TDD 证据

RED：

- 在 JSON-safe 合同工作台读模型样本中加入 `allowsEarlyPayment: true`；
- 断言 Prisma select 必须显式选择该字段；
- 目标 API 为 1 失败/62 通过；
- 唯一差异为实际 select 缺少 `allowsEarlyPayment`。

GREEN：

- API 目标：63/63；
- Web 聚合保存链：65/65；
- 读模型可 JSON 序列化并原值包含 `allowsEarlyPayment: true`。

## 3. 仓库级门禁

| 门禁 | 结果 |
| --- | --- |
| shared Vitest | 15 文件，149/149 |
| Web Vitest | 139 文件，1,248/1,248 |
| API Jest | 251 套、4,749/4,749；15 套/38 项按环境条件跳过 |
| 全仓 typecheck | 通过 |
| 全仓 lint | 通过 |
| Web E2E typecheck | 通过 |
| Web `check:ui` | 通过 |
| API build | 通过 |
| Web build | 通过；仅既有大 chunk 提示 |
| Prisma validate | 通过 |
| Prisma generate | v5.22.0 生成成功 |
| 能力矩阵 | 184 源码路由、138 Web API 请求、395 运行时路由，双向缺失 0 |
| `git diff --check` | 通过 |

Prisma validate 首次因本地没有 `DATABASE_URL` 在配置解析阶段失败；使用不连接任何
数据库的占位 PostgreSQL URL 后，validate 和 generate 均通过。

## 4. 浏览器门禁

Chromium P0 首次运行：

- 首次在沙箱内因本机回环监听 EPERM，未执行用例；
- 放宽本地 `127.0.0.1:5173` 后真实执行为 1 passed、2 条件跳过、1 failed；
- 失败用例单独重跑仍稳定失败。

Trace 证明详情 GET 返回 200，但旧 fixture 只提供 `corrections: []`，当前正式读模型
还要求 `appliedCorrections: []`。组件收到 undefined 后出现 Vue render error，因此
详情面板未完成渲染。最小测试修复只补空的 `appliedCorrections`：

- 单条历史接管 P0：1/1；
- 完整 Chromium P0：2 passed、2 条需要真实环境配置的场景 skipped。

本候选没有 Web 运行时代码变化。父候选已经完成的合同清单 Chromium + WebKit
桌面、960、640、375 共 8/8 仍适用于同一 Web 产物；本轮重新完成 Web 全量测试、
typecheck、lint、`check:ui` 和 production build。

## 5. API、页面与权限矩阵

唯一变化链：

```text
PaymentTermsStage.allowsEarlyPayment
  -> Prisma explicit select
  -> GET /contract-drafts/:versionId/workbench
  -> Web ContractDraftFieldsModel
  -> PUT /contract-drafts/:versionId
```

页面未新增直接 `fetch`。后端仍执行 DTO、当前经办人、租约、revision CAS、金额、
状态、审计和七天技术回执不变量。旧 PATCH/单确认 410、canary 503 和岗位权限没有
变化。

## 6. 生产状态与新授权门

候选 `7229c061…` 的失败回滚后：

- 生产 checkout 为 `7229c061…`；
- API/Web 运行时为发布前恢复快照；
- `CONTRACT_CUTOVER_MODE=maintenance`；
- canary 0；
- API、Nginx、PostgreSQL active，内外 health 正常；
- 目标仍为 draft/revision 12、正式编号空、审批 0、接管 0；
- 失败保存没有七天技术回执；
- 获批租约已自然过期。

本轮四枚 token 均已过期，不能重签或复用。新的候选分支 tip 必须重新获得：

1. 候选分支 push；
2. `main` fast-forward；
3. 生产 checkout 与完整部署；
4. 三 canary 精确集合；
5. 四账号新的 token 次数与 120 秒范围；
6. 仅当前经办人一次自然租约和内容相同保存；
7. 成功后才允许 `CONFIRM` 与切换 `release-b`。

transition、retention、其他业务写入和任何物理删除仍未授权。

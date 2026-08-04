# Task 11：合同旧流程修订历史页面消费

日期：2026-08-01

## 结论

`GET /contract-workbench/:contractVersionId/offline-revisions` 已从未分类后端路由收口为合同工作台的真实只读页面能力。合同磋商区域在同一版本刷新中并行读取当前磋商轮次和完整线下修订历史，只把 `negotiationRound === null` 的上线前记录展示在“旧流程修订记录”区域；这些记录没有链接、按钮或差异处置 selection，不会进入当前磋商写流程。

## 安全与一致性

- 前端 wrapper 对顶层修订、磋商轮次、比较、差异和候选字段使用精确白名单；重复 ID、私有字段、未声明字段和非法旧流程预览/比较事实整批失败关闭。
- 比较内部结构只用于验证服务端响应，不暴露进旧流程历史页面 read model。
- 版本切换、空版本和组件卸载均清空历史状态；迟到响应在赋值前校验 request/version owner。
- 后端既有实现复用合同经办人归属边界，并将 governed 与 legacy 记录按创建时间混排；新增契约测试证明返回对象及 JSON 均不泄露 fileId、previewPdfFileId、actor 或 sourceGeneratedDocumentId。
- 页面没有直接 `fetch`；这是 GET 只读能力，不伪造页面动作 registry 条目或 `availableActions`。

独立审查只发现一项 E2E P2：原断言未精确证明 governed revision 不会重复进入旧流程区域。现已补 `.legacy-revision-card` 精确 1 条且不含 governed 标签的断言，P0/P1/P2 均为 0。

## 验证

- Web 目标 Vitest：3 文件，24/24 通过；
- API 目标 Jest：1 套，16/16 通过；
- Web `typecheck`、`lint`、`check:ui`：通过；
- Web E2E `typecheck:e2e`：通过；
- API 目标 ESLint：通过；
- 四清单 write/check：
  - Web API：387 wrappers / 397 bindings；
  - 页面动作：48 actions / 297 个存量 blocker；
  - 路由用途：395 routes / 25 unclassified；
  - 综合矩阵：395 routes / 352 个存量 blocker；
- `git diff --check`：通过。

相对上一提交，本路由从 `none/unclassified` 变为 `web_api_wrapper/page`，未分类路由减少 1，综合矩阵存量 blocker 减少 1；mutation/action 指标不变。整体 Task 11 仍未完成。

## 未执行证据与边界

新增 Playwright mock 和只读断言已完成，但本机 Vite 监听 `127.0.0.1:5173` 被当前 sandbox 以 `EPERM` 拒绝；本切片未借用其他任务已经消费的 preview 提权授权，因此浏览器用例尚未实跑。

未连接生产，未 push、合并、部署、执行迁移或修改业务数据；未进入 Task 12，也未执行任何物理删除。

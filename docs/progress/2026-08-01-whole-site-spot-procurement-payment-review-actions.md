# Task 11：零星采购付款审批页面动作收口

日期：2026-08-01

## 结论

`POST /spot-procurement-payments/:paymentId/approval` 已由付款详情页的四个精确动作消费：

- A5 真实付款：审批通过、退回申请人；
- 历史付款：审批通过、退回申请人。

四个动作都只调用 `executeSpotProcurementPaymentReviewAction`。该执行器先重新读取付款详情，再校验付款坐标、表单类型、服务端 `review_approval` 动作、自审要求和页面所有权，最后才调用文件私有的 POST transport。页面没有直接 `fetch`，也没有新增服务端虽兼容但 A5 产品不提供的 `reject` 入口。

## RED 与实现

首轮 RED 证明原页面只有一个动态 submit 动作，能力来源和调用因果链均无法验证；API executor 行为 RED 又覆盖真实/历史表单、GET 后 owner 失效、动作缺失或禁用、付款/表单漂移和禁止直接 wrapper。

独立复核随后发现并关闭两项 P1 和一项 P2：

1. 历史付款在单一财务主管节点退回时，必须填写调整后供应商余额抵扣金额。金额入口只由原始服务端 `approval.currentRoleKeys` 决定，预填服务端当前余额，以字符串定点换算为分，并在 fresh GET 中再次核验；真实 A5 携带该 legacy 字段会在请求前失败关闭。
2. 历史自审使用独立“自审原因”和密码，不再把普通审批意见或退回原因冒充自审说明。
3. `return_to_applicant` 响应缺少 `newDraftPaymentId` 时按协议漂移失败关闭，不再误报“审批通过”。

最终独立复审为 P0/P1/P2 均 0。

## 验证

- Web 目标 Vitest：2 文件，106/106 通过；
- Web `typecheck`、`lint`、`check:ui`：通过；
- 四清单在只包含本切片的临时索引树中完成 write/check：
  - Web API：386 wrappers / 396 bindings；
  - 页面动作：48 actions / 297 个存量 blocker；
  - 路由用途：395 routes / 26 unclassified；
  - 综合矩阵：395 routes / 353 个存量 blocker；
- 四个付款动作均为 `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`，variant 固定为 `approve` 或 `return_to_applicant`；
- `git diff --check`：通过。

整体 Task 11 仍被全站存量未分类路由、孤儿封装和未覆盖动作阻断，以上数字不代表发布就绪。

## 边界

本切片未执行真实浏览器付款审批 E2E；GET 与 POST 之间发生的权限或状态并发变化继续由后端事务最终裁决。未连接生产，未 push、合并、部署、执行生产迁移或修改生产业务数据；未进入 Task 12，也未授权任何物理删除。

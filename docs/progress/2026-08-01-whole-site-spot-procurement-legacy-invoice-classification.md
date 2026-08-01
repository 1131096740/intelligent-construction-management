# 实施包 5 Task 11：零采旧发票接口分类与当前发票追加动作闭合

日期：2026-08-01

范围：纯本机源码、测试和治理清单；未连接生产，未执行迁移、部署、业务写入或物理删除。

## 结论

- 当前真实零采发票入口继续采用付款级附件：`POST /spot-procurement-payments/:paymentId/invoices`。
- 收货页的“追加发票”已登记为 `spot-procurement.invoice-append` 页面动作，由原始服务端 `spotReceiptCapability.availableActions#append_invoice` 支配。
- 页面动作只调用唯一 canonical executor。执行器重新读取当前收货权限和付款事实，核对采购/付款坐标、有效实付、唯一服务端动作和页面 owner，再用同一次页面尝试中稳定的上传幂等键上传临时文件，并只对捕获的付款单发起追加；权限关闭时不上传、不追加，上传后路由切换或组件卸载时不追加。
- 后端 capability 与写入守卫统一复用 `spot_procurement.invoice.append` 的岗位策略，写事务还会在采购/付款锁后复核有效实付；直接调用 API、岗位撤销和实付作废均失败关闭。POST 已确认后若页面脱离或刷新失败，页面按“已写入但未刷新”处理，不冒充零写或承诺归档生成。
- 九条旧 VAT 字典、采购级结构化发票/无票/异常及 allocation reversal 路由仅登记为 `exit_candidate`。全部生成结果保持 `deletionAuthorized=false`；后端路由、服务、Schema、历史记录和审计均未删除或改写。
- Web 中仅供测试引用、无生产消费者的 `fetchVatRateOptions` 包装和类型已移除；这不等于删除服务端 VAT 字典能力。

## 失败证据与最小修复

1. 登记动作前，页面结构测试因缺少 `spot-procurement.invoice-append` registry 项失败。
2. 初次把上传和追加两个底层 wrapper 直接登记后，生成清单显示动作调用链 `causalVerified=false`，综合矩阵 blocker 反而增加；该结果未作为完成证据。
3. 将完整流程收敛为页面直接调用的 `executeSpotProcurementInvoiceAppend` 后，生成清单对 fresh GET 和付款级 POST 均给出 `causalVerified=true`，且服务端 capability 为 `serverDerived=true`、`dominatesTrigger=true`。
4. API 回归锁定关键路径：成功时 GET→GET→上传→单 POST；fresh capability 关闭时零上传/零 POST；上传后 owner 失效时零 POST；POST 已确认后页面脱离或刷新失败不会误报零写。
5. 后端 RED 先证明 capability 缺少共享 `requiredAction` 且岗位撤销后仍可追加；最小修复后，capability、岗位守卫和有效实付不变量均由目标服务测试覆盖。

## 路由分类

以下九条只作为退出候选证据，不含删除授权：

- `GET /vat-rate-options`
- `POST /vat-rate-options`
- `PATCH /vat-rate-options/:optionId`
- `POST /spot-procurements/:procurementId/invoices`
- `POST /spot-procurements/:procurementId/no-invoice-confirmations`
- `POST /spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review`
- `POST /spot-procurements/:procurementId/invoice-exceptions`
- `POST /spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review`
- `POST /invoice-allocations/:allocationId/reversal`

## 验证证据

- Web 目标 Vitest：2 文件，115/115 通过；其中显式证明 POST 结果不明后的第二次重试复用同一上传键和 `fileId`。
- API 目标 Jest：2 套，68/68 通过。
- Web 全量 Vitest：152 文件，1539/1539 通过。
- Web `vue-tsc --noEmit`、全量 ESLint、`check:ui` 和 production build：通过。
- API typecheck、全量 ESLint 和 production build：通过。
- 六组治理检查器回归：203/203 通过。
- 四份治理清单 write/check：通过；当前 route usage 为 395 条、16 条未分类、32 条退出候选。
- 当前发票追加动作的 GET/POST 两个 binding 均有精确页面消费者和因果证明；page-action manifest 为 49 个动作、296 个存量 blocker。
- 综合矩阵为 395 条路由、341 个存量 blocker；Task 11 与实施包 5 均未完成。

`git diff --check` 通过。独立终审确认 P0/P1/P2 均为 0，先前发现的岗位策略漂移、有效实付竞态、组件/操作 owner 和上传幂等四项 P1 均已关闭。真实浏览器未获本切片 preview 授权，不在本证据中冒充已执行。

# 实施包 5 Task 11：正式零星采购退回申请人动作闭合

## 结论

本子任务只闭合：

- `spot-procurement.review-return-to-applicant`

不把 Task 11、实施包 5 或五个实施包总门禁标记为完成。下一最小切片是
`spot-procurement.withdraw`；Task 12 的旧接口退出仍不得提前。

正式零星采购的 `return_to_applicant` 继续使用既有后端状态机：

1. 当前采购及当前版本必须处于 `approval_pending`；
2. 精确进行中审批实例必须恰好一条；
3. 当前账号必须是冻结节点处理人，普通申请人不得自审；
4. 客户端必须提交当前版本、审批实例及节点三项坐标；
5. 退回意见必须是非空文字；
6. 同一事务把审批实例改为 `returned_to_applicant`、源版本改为
   `returned`，复制冻结明细和附件生成下一版 `draft`，并把采购根指向新版本；
7. 审批动作日志和业务审计记录源版本、新草稿版本及办理岗位；
8. 退回不创建付款草稿、收货单、实付、凭证或其他下游正式事实。

本轮没有修改后端生产代码、Prisma Schema 或迁移。后端原有行锁、权限优先级、
三坐标 CAS 和事务内版本迁移保持不变；本轮新增成功回归，补齐该正式状态迁移的
当前测试证据。

## RED 与最小实现

### RED

改造前的失败证据为：

- 页面把 `review_return` 留在通用 `confirmAction()` 中，直接调用底层
  `reviewSpotProcurement()`；
- 没有 fresh GET preflight、operation owner、route/detail/dialog generation
  或迟到回调隔离；
- API 复合执行器的类型和上下文校验只接受 `approve|reject`。

新增失败测试分别得到：

- 页面测试：`bindings.confirmReviewReturn is not a function`；
- API 测试：`零星采购审批上下文无效，请重新读取当前采购后再操作`。

### GREEN

最小实现：

- 将复合执行器的固定 decision 扩展为
  `approve|reject|return_to_applicant`；
- 非 `approve` 冻结 trim 后的必填意见，POST 固定携带三项审批坐标；
- 新增页面独立 `confirmReviewReturn()`，复用 approve/reject 的 capture、
  fresh preflight、current、complete、fail、finish 链；
- 通用 `confirmAction()` 不再承接退回，退回对话框固定绑定
  `confirmReviewReturn`；
- 底层 `reviewSpotProcurement()` 改为 API 文件私有实现，生产页面只消费唯一
  复合 wrapper，消除 raw transport orphan；
- 退回后的权威 GET 必须返回新草稿，页面才完成状态刷新。

前端页面没有直接 `fetch`。

## 后端不变量证据

新增 `SpotProcurementApplicationService` 成功回归，证明：

- 意见被 trim；
- `ApprovalActionLog.action=return_to_applicant`；
- 审批实例变为 `returned_to_applicant`；
- 源版本变为 `returned`；
- 新版本为 V2 `draft`，采购根 `currentVersionId` 指向新版本；
- 审计动作为 `spot_procurement.approval.return_to_applicant`，同时记录
  `sourceVersionId`、`newVersionId` 和办理岗位；
- 没有创建付款草稿或收货单。

权限先于三坐标 CAS、普通申请人自审拒绝、重复进行中实例失败关闭、陈旧坐标零写，
继续由既有同服务目标回归覆盖。

## 页面动作与能力矩阵

新增动作：

- id：`spot-procurement.review-return-to-applicant`
- capability：`spotProcurementCapability.availableActions /
  review_approval`
- handler：`confirmReviewReturn`
- wrapper：`executeSpotProcurementReviewAction`
- variant：`return_to_applicant`

生成结果：

- `serverDerived=true`
- `dominatesTrigger=true`
- `causalVerified=true`
- `accepted=true`
- `POST /spot-procurements/:procurementId/approval`：
  `mutationCoverage=covered`

相对上一个切片：

- Web transport wrapper：386 → 385；
- main binding：396 → 395；
- registered action：42 → 43；
- accepted action binding：27 → 28；
- page blocker：301 → 300；
- covered production mutation pair：保持 19；
- matrix blocker：366 → 365；
- orphan wrapper：保持 48；
- route：保持 395；
- unclassified route：保持 26。

整体能力矩阵仍为 `blocked`，不能把本动作完成表述为全站 ready。

## 浏览器关键路径

真实 production bundle 在 Chromium 和 WebKit 中运行同一目标场景：

```text
GET 初读
  -> 打开“退回采购申请人”
  -> 输入并冻结原因
  -> GET fresh preflight
  -> POST return_to_applicant + 三项坐标
  -> GET 权威刷新
  -> 新 V2 草稿
```

两浏览器均验证：

- POST 只有一次；
- 原因 trim 后为 `请补充报价依据`；
- 版本、审批实例、节点坐标与 fresh GET 完全一致；
- 权威刷新进入新草稿；
- 390×844 对话框完整，页面及嵌套区域无横向滚动；
- console error 和 pageerror 均为空。

目标场景 Chromium/WebKit 2/2 通过，退回确认截图已人工检查。HTML 报告移至：

`/tmp/jgzg-spot-return-report-20260801-final`

新场景仍位于正式零采双浏览器配置，尚未进入默认 CI P0 文件；最终发布候选需统一
决定是否并入默认 P0 集。

## 验证

- API 目标：3 套、87/87；
- Web 目标：3 文件、106/106；
- Web approve/reject/return owner 与 API 定向：2 文件、38/38；
- Web 全量：150 文件、1483/1483；
- workspace/API/Web typecheck：通过；
- Web E2E typecheck：通过；
- API/Web lint：通过；
- Web `check:ui`：通过；
- Web production build：通过，仅保留既有大 chunk warning；
- Chromium/WebKit production bundle：2/2；
- Web API、page action、route usage、capability matrix 普通 `--check`：通过；
- 上述四项 `--require-ready`：因全站既有 blocker 按预期 exit 1；
- 独立只读审查：P0 0、P1 0。

生成文件 SHA-256：

- `nest-business-routes.json`：
  `159b19c1737a577a2def4147ca101cd20901195e12d0560d64d7e19eb59c27d2`
- `web-api-wrappers.json`：
  `23a0f2e35cd7d87bff41f116d5a140615f295f71e01e1d3ba8201a51860cc84f`
- `web-page-actions.registry.json`：
  `69293d07a963d277cadfa7719366eeb29773509163070bcd718768c9c7286d8d`
- `web-page-actions.json`：
  `9255d7a587184687f4b105377bab017a728b3663659a36a5d9c6af087b40c186`
- `route-usage.json`：
  `7d516954f3f0b5701f31924d1f4379d46fc28fced77f5f0af24c336849661e0c`
- `whole-site-capability-matrix.json`：
  `c60b8ad88fbedd0ab2a0b40b2b9cb629ed6b139e5b81db405539025d90fc7af6`
- `whole-site-capability-matrix.md`：
  `ac02f728132c4524c048b45519962f3aa37f5f6b56d39be937dbca7e78ea6bc4`

## 剩余风险、未授权与下一步

非阻断 P2：

1. 按钮显示仍只检查服务端 `review_approval` action；完整审批坐标在打开对话框、
   capture 和 fresh preflight 三层失败关闭。异常混合版本部署时可能短暂出现按钮，
   但不能越权写入。
2. 新增后端成功回归没有逐字段枚举明细和附件复制；生产代码复用既有
   `createRevisionFromVersion()`，其冻结事实路径保持不变。
3. 新浏览器场景尚未加入默认 CI P0 文件。

下一切片只闭合正式零采审批撤回，必须独立登记动作、补失败测试、fresh preflight、
CAS/权限/审计和浏览器证据；不得先做旧接口物理删除。

本地未 push、合并、部署、执行生产迁移或修改生产业务数据。生产 temporary-only
清理不重复；业务草稿 purge、正式业务记录、AuditLog、checkpoint、旧表旧字段和
其他物理删除继续关闭。

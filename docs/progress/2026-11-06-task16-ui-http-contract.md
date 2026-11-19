# 任务16统一付款登记：Web委派边界

当前本地HTTP合同，非全票完成。后端业务、Schema、SQL、公开HTTP/公服测试及可复用合成持久层工厂由16主implementer唯一维护；Web接手者不修改这些文件，不覆盖他人WIP。

## 页面及所有权

明确已有入口所有权：`apps/web-admin/src/pages/payments/PaymentListPage.vue` 顶端挂统一共享待办组件（必要接线）、`PaymentDetailPage.vue` 复用该组件以及Me现有目标链接的必要接线均属本Webworker；不新增路由或全页重写。其余Web WIP及FundAccounts相关文件保持原作者所有权。

Web接手者负责新 `apps/web-admin/src/api/registered-payment-execution.api.ts`、付款登记组件及其必需的既有付款详情/待办入口接线、自己的真实浏览器spec/config/合成HTTP启动器。不修改已有FundAccountsPage及fund-account.api的主implementer改动。使用Vue/TDesign与jg tokens、既有apiFetch/上传接口，不能新增UI库。统一由既有付款入口办理登记资金/公共现金；不展示银行转账动作或旧/新模式技术切换。旧银行HTTP兼容由后端保留。

## 稳定公开HTTP

- GET `/payment-executions/work-items` 当前公司财务/财务主管/综合部主管共享。items: paymentId、code、projectId、paidAmountCents、remainingAmountCents、expectedPaymentUpdatedAt；金额为整数分字符串。部分保留，付清消失。project-only财务/技术管理员不能办理。
- GET `/payment-executions/:paymentId/registration-options` 同当前岗位授权。返回paymentId/code/projectId/expectedPaymentUpdatedAt/paidAmountCents/remainingAmountCents/accounts；每项scopeKey/name/eligible/reason（中文或null）/currentRegistrationId。资格由后端决定：最新审批通过；原公司停用仅可凭有效冻结版本及有效容器继续，新选停用代付公司禁止。UI不能用active一刀切。GET失败保留输入。
- GET `/fund-accounts` 复用现有fund-account.api，按scopeKey取得余额/来源/核对版本。未知余额/amountYuan:null、pendingAllocation及unallocatedPaymentAmountYuan必须分别显示，不补0。来源有sourceStatus、projectStatus/projectId。不能自动FIFO分摊，项目不足不能虚造垫资/到账。
- POST `/payment-executions/:paymentId/registrations` body为RecordRegisteredPaymentExecutionDto：idempotencyKey(UUID4)、expectedPaymentUpdatedAt、amountCents(整数分)、paidAt(北京YYYY-MM-DD，允许过去，拒未来)、scopeKey、expectedRegistrationId、openingTreatment(included/not_included)、openingReason、openingEvidence、sourceAllocations[{sourceBatchId,amountCents}]、confirmationPassword。included不传分摊；not_included由用户明确分摊且合计等实付。无法确认是否已含期初时保留填写，不提交。当前options与fund-accounts版本不同须重新读取并明确确认，不能自动重发。成功返回原PaymentExecution（id/amountCents/paidAt等），不得自行生成本地账本。
- GET `/payment-executions/results/:idempotencyKey` 结果status=recorded（execution字段executionId/paymentId/amountCents/paidAt/voucherPending，effects与intercompany读取正式后果）或unconfirmed（中文提示）。断连/未知结果先用原key查询；unconfirmed不等于未提交/失败，不自动换key或重发。同key只能重试完全同一内容，改变意图明确拒绝。凭证待补不等于未付款。
- registered写入发生P2002/P2034且未查到原事实时，HTTP409 body为 `{code:"PAYMENT_RESULT_UNCONFIRMED",resultStatus:"unconfirmed",message:中文提示}`。必须按该结构化语义保留原请求并先查询，不能按4xx或中文推断确定未提交。已用合成pre-callback P2034公共反例RED→GREEN，P2002同源码分支尚未独立运行，真实PG未验。原键已成功读取及legacy bank行为不变。
- POST `/payment-executions/:executionId/voucher` body{fileId}。复用私有文件上传后绑定当前人文件，附属于同一实付，不生成第二付款。GET `/payment-executions/:executionId/voucher-ticket` 返回真实FileService既有私有短期票据格式（需按现有文件API解包），当前岗位撤销后拒绝。不能直连COS/存储。
- 可选历史核验 GET `/payment-executions/:paymentId/existing-source/:type/:id`，type为contract_takeover_historical_payment或historical_financial_takeover_row。返回source{type,id,version,fingerprint}（服务器计算）、samePaymentRequest、conclusion、amountCents/paidAt，以及仅确证同申请时的originalResultKey/originalExecutionId。conclusion=original_result时引导查看原结果；not_linked_to_request不能重复登记。POST可携带existingSource{type,id,expectedVersion,expectedFingerprint}，当前后端复验同申请/原key/金额/date/版本/激活/补偿，未建立同申请关联409零新写。前端不计算指纹，不新建历史承接命令。

已补齐只读及上传入口：

- GET `/payment-executions/recorded-items?paymentId=可选` 返回{items,total}，每项executionId/paymentId/code/projectId/amountCents/paidAt/registeredByName/actualPayerName/voucherPending/resultKey。actualPayerName仅取资金事实冻结公司快照或中文公共现金，不能用当前公司档案或原责任主体替代。本16正式实付付清后仍保留，可由另一有权岗位补凭证。resultKey只内部查询，不要求用户输入或显示UUID。当前完整返回，不静默截断，不计分页/性能验收。
- registration-options另返回 `originalResults:[{executionId,resultKey,amountCents,paidAt,source:{type,id,version,fingerprint}}]`。只读发现本申请已存在正式实付且经过当前激活/未补偿/非工资来源复验的HFT回执；中文显示原日期/金额并查看原结果，不要求输入原key/source字段，不建立历史关联或触发新付款。已补偿候选为空；GET results遇真实工资binding/summary关系安全403，仍经原业务权限入口查看。
- POST `/payment-executions/:executionId/voucher-file-uploads` 为multipart file和可选UUID4 idempotencyKey，精确本16当前岗位/正式fact授权，允许付清后补。复用真实FileService与私有存储，不扩通用/files上传岗位；随后独立绑定。

## 用户交互及证据

Web接手者另拥有 `apps/web-admin/e2e/helpers/registered-payment-synthetic-server.*` 的Web自用Nest bootstrap/launcher，调用真实controllers/services/guards与主implementer的 `services/api/src/payment/testing/registered-payment-execution.synthetic-db.ts` 工厂。可以准备自有合成业务facts，不能手写假业务HTTP，不能修改后端fixture/工厂或产品route。启动器、端口、seed控制、日志和浏览器输出自有；每个写命令先核解析cwd为16隔离树。私有票据返回 `downloadUrl` 和 `expiresAt`，通过后端授权下载URL访问。

系统外已付款后登记，不办理银行交易。金额到分，业务余额保留四位显示；沿用既有精度/北京日期适配。当前核对版本、原因、依据明确冻结；资金已含期初不代表合同历史累计已含。付款金额、来源分配、日期、密码、错误均在同一办理区可理解呈现，失败保留输入与原key。允许先付款登记后补电子凭证，明确待补。

用户已确认按当前user命名的sessionStorage仅保留待确认传输指针（paymentId、原key、冻结的业务填写草稿），不存密码、文件bytes、票据、auth或本地成功/资金余额。刷新先查原key；查询unconfirmed或403不能清指针冒作未登记，也不自动换key/重发，403指向有权办理人核验。存储失败仍在内存保留原key并给中文提示。该恢复流程尚须真实浏览器故障片验证，不能以合同文字当作已交付。

真实桌面/手机浏览器连接独立loopback Nest HTTP+合成持久适配器，禁止page.route假服务器或localStorage资金authority。浏览器输出使用testInfo.outputPath和自有fixture/port/output目录，不覆盖别票证据。至少覆盖两岗位共享部分剩余、跨公司/公共现金、后补凭证、断连后原key查询、错误保留及窄屏适配；先一个公开RED→最小GREEN，不横铺假想内部seam。启动/浏览器/build窗口先向父控协调，勿并跑369/native转换。真实PG/SQL/迁移/资源/银行/COS/短信/交易/部署仍未授权。

### 既有付款详情的统一登记能力投影

既有Detail返回`registeredExecutionCapability`（具体共享类型以`core-flow-read-model.ts`为准），分别表达`supportedDomain`、`allowedActor`、`workflowReady`、`canSupplementVoucher`和中文`blockedReason`。我方且属本票来源的非工资请求即使最新批准轮缺失/退回，也应保持支持领域但流程不可办理；当前无全公司权限或账户未知/不足不能回退旧银行入口。当前资金条件由真实options/fund-accounts重读与提交CAS决定，客户端不根据金额、active档案或名字推断领域/权限。真实工资关联、非我方或不支持来源不泛称可后补。该投影不放宽旧Detail ACL，不修改旧银行HTTP守卫。

源事实工资隔离以正式绑定关系而非客户端标签判断；规格CUT-04已移除工资专用新入口，旧首次工资写退役归43，本票没有新增首次工资分类动作。缺失版本或`draft_unconfirmed`不能确认为我方公司，需后端拒绝作为本票办理领域，前端不得补默认值。

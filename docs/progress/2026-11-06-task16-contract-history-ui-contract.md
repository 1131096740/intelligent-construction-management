# 任务16：合同历史独立确认的统一办理契约

用户 call_bb402844382349b190ed959fb8c9ad11 已确认；这不是新授权问题。父实现负责后端/Schema/SQL/公共HTTP测试/合成DB工厂；Web worker 只修改其原七个owned文件及自己的测试产物，不改 FundAccountsPage/fund-account.api/backend/factory。当前原524/14与HFTA阶段证据仍绑定旧source，新增规则尚未全组/真实PG验证。

## 只读 options

现 GET /payment-executions/:paymentId/registration-options 新增：

```ts
contractHistoryBasis: {
  required: boolean;
  fingerprint: string; // 服务器生成，内部回传，不在用户页面显示技术串
  records: Array<{
    id: string; contractId: string; contractVersionId: string; paymentTermsVersionId: string;
    updatedAt: string; confirmedAt: string; activatedAt: string|null;
    historicalPaidCents: string; historicalProxyPaidCents: string; historicalAdvancePaidCents: string;
  }>;
}
```

服务器已复用本申请当前权限、我方非工资 domain、当前真实批准轮后读取；无权不泄露历史资料。各历史付款分量分别显示中文名和日期，不把代付/预付加成一个虚构现金金额。不要显示内部id、fingerprint或sourceType。没有冻结历史付款时 required:false，不出现新的确认负担。

## 新登记请求

现 registrations POST 可选附加：

```ts
contractHistoryConfirmation?: {
  treatment: "not_included"|"included"|"uncertain";
  expectedFingerprint: string; // 原 options 值，不由前端计算
  reason: string;
  evidence: string;
}
```

当 required:true，新增三态中文选择“未计入合同历史已付”“已计入合同历史已付”“不确定”，默认不选择；单独的原因/核对依据与原资金期初归属分开。只有明确未计入、填写原因和依据后可进入正式确认；已含/不确定/未选保留金额日期等填写、提示先核原来源、0登记POST。不能因资金 openingTreatment 已含或未含代填这项确认，也不能用同合同/同日同额猜。

服务器仍在同一执行事务内锁并复核最新历史basis：变化时409中文拒绝、正式后果零写。延用原显式刷新资料交互，保留输入/原请求key，不自动换指纹、重发、清空已选文件或伪造本地资金值。原同key已成功结果及已证明同申请HFTA只读原结果优先，不要求为查看既有事实重新填写新确认。

新确认应进入真实提交二次确认内容。若冻结输入进入原用户隔离的pending transport pointer，只允许本业务确认字段及原白名单，不保存密码、auth、文件字节、ticket等；恢复仍先查询原key，不依本地数据宣布付款成功或发起新登记。

## 验证边界

新缺确认实际201→409 RED/GREEN已通过，uncertain409/零新后果通过。四后继目标：明确未含新30、历史40不变/资金70；后续历史basis变更同key原回执不重写；已含与旧basis分别409零写；普通无历史不填新字段201。均真实本地HTTP+合成持久化，非真实PG。

Web后继先 public DOM RED，再最小UI GREEN：required历史资料出现且未选/已含/不确定无确认无POST并保留输入；明确未含+独立原因依据真实201/独立重读；basis变化409保留，刷新后重新明确确认；普通无历史/HFTA原结果不增加负担。bootstrap只调用真实Nest controllers/services/guards和父owned factory，严禁手写假业务HTTP、page.route/privateVue/localStorage资金权威。每次 fresh source/asrun，浏览器/类型重门先报root协调，原budget/0retry保持。

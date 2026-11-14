# 任务15 / #397 本地候选收据

本票为公司登记余额、唯一无所属公司公共现金和期初/余额核对登记。用户已确认按余额基础阶段收口，26/27及44前缺口保留；仍待最新候选主控独立双轴复核与集成验证，不预填关闭；本地源码与合成HTTP/UI证据不代表真实PG、付款或上线验收。最终clean SHA、源码封包和每项日志/构建指纹见私有交接 `/private/tmp/jg-task15-candidate-evidence.json`。

## 当前真实行为

- 每公司一个系统登记余额容器，包含停用公司历史；全局一个无所属公司公共现金，按当前综合部主管职责保管。旧公司/项目外键和旧资金模型不放空、不虚挂、不复制旧账。
- 余额未知、来源未知、项目未定分别表达。金额四位精度，来源/项目仅为同笔核对余额的快照，保留前版来源lineage；不造新收入、垫资本金、项目余额或FIFO。
- 期初有依据、核对说明、真实北京时间业务日、审计和幂等，直接确认；旧历史支出不再扣减。系统5万与实际8万须追加核对更正，确认前仍按5万，确认后有效登记8万。
- 更正复用03/05的财务主管职责协议、ApprovalInstance/ActionLog、当前岗位/精确临时委托、真实发起人自审原因+当前密码、实际办理人手写签名版本快照；保留represented身份。批准/退回/撤回与round、登记CAS、审计同事务。退回必须原因，发起人可密码撤回，原记录保留，新申请使用新版本/新凭据。
- 普通受托人只读当前单案及所需有效前版/来源/项目，不得全账户列表、他案/旧轮或转委托。无当前职责人员、纯技术管理员、双方停用、过期/撤销/失岗均失败关闭。
- 办理后同本人/案/轮/action/key/规范化业务payload只回本人冻结动作结果；密码/摘要不入指纹或日志。后续余额版本不改写旧回执。仅P2002/P2034事务结束后允许fresh事务读已提交原回执，不重跑写闭包。其它错误不吞。Guard仅提供严格本人旧回执的只读重放准入，JWT/session/active始终前置。

主要源码：`services/api/src/fund-account/`；窄接点为 `approval/approval-delegation.service.ts`、`auth/guards/permission.guard.ts`、AuditService新资金中文标签和shared新action。实际页面/API为 `apps/web-admin/src/pages/funds/FundAccountsPage.vue`、`src/api/fund-account.api.ts`；委托台账仅本域精确option metadata、freshcap和服务端固定单案reviewPath扩展。

## FND-01细项与后票边界

| 细项 | 当前源码/事实 | 状态 |
| --- | --- | --- |
| 财务/综合固定资金账户入口 | `src/app/business-navigation.ts`、`src/routes/route-records.ts` 的 `/资金账户`，`pages/funds/FundsWorkbenchPage.vue`快捷入口 | 已本地实现 |
| 公共现金/各公司资金/登记流水与核对历史 | 同一FundAccountsPage+`GET /fund-accounts`，来源与项目归属金额均来自同一有效登记 | 已本地实现 |
| 既有付款事项/实付流水 | 财务页面链接 `/统一资金办理工作台`，复用 `funds-workbench.api.ts` / `GET /funds-workbench` 当前既有事实 | 已有真实路由/API，未因此新增资金执行算法 |
| 真实待归还视图 | 本票未实现27/FND-17真实待归还账；没有用公司互转替代，没有0余额/假办理/“尚未接入”产品占位 | 未交付，待27衔接 |
| 项目总览登记项目垫资入口 | 本票未实现26/FND-05实际项目垫资，不以来源快照当垫资本金 | 未交付，待26衔接 |

2026-11-06用户明确同意按基础阶段收口，缺口由26/27闭合、44最终验收前必须补齐。因此FND-01整条仍不能宣称完整通过。FND-03的实际付款/报销/转款、FND-06用款选项目、FND-08后续付6万的执行由16/24/26/28等既定后票接入；本票只提供有效登记版本、核对时点和源lineage权威，不实施付款/退款/归还算法，不标18或38审批中心完成。未改193映射/依赖边。

## 已执行验证

- 公开HTTP首例即真实DTO pipe、JwtAuthGuard、PermissionGuard、RetiredWriteEntryGuard、业务controller/service、AuditService和正式职责/签名helper；只合成身份持久化/签名数据库事实边界。
- 50个资金公开HTTP用例通过，含未知/零、公司与公共现金边界、四位精度、北京时间UTC日前早晨、来源守恒/lineage、幂等/异payload/跨案、权限审计回滚、角色撤权、签名缺失、委托生命周期、实际发起人自审、退回重申/撤回与旧轮拒绝、窄读、旧冻结回执及后续新版本。
- 相关9套后端219项通过（资金50+既有委托职责、Permission、review identity、self review、active delegation、signature snapshot、RetiredGuard、Audit）；Web委托组件7+路由49=56通过，保留原spot行为及未知/缺失option/等待cap时换目标无POST。
- API/shared/Web类型检查、API/Web lint、Web check:ui、API标准build+强制非incremental emit、Web build通过。Web全包lint0错误/760既有警告，本票窄文件lint无输出；构建保留现有chunk大小提示。
- 原CI编排369/369通过，无skip；fresh Nest metadata与原派生/check/require-ready链通过：711路由、665wrapper、704绑定、402动作（393业务/9技术），0阻塞/0未分类；80合同mutation路由/22既有advertised动作、86退役写入口/11旧只读入口保持原门。route-usage只精确更新9条新增fund route所致4个计数，不改override指纹/负控。
- 真实Chromium访问独立Web build preview+实际loopback合成HTTP，5流通过：桌面公共现金开账失败保留输入后重试/刷新、390手机公司期初、5万→8万自审签批、受托人从实际委托台账按钮进入窄页并用本人签名、退回重申后本人密码撤回。1366/390/768宽度无横溢。
- 受托人首次真实审批已返回controller201后，测试HTTP传输边界实际销毁response；UI保留原意见/commandKey，第二次实际POST的完整body与首次一致，收到本人原冻结回执，实际财务读取确认只有一份ActionLog、金额不重写。最终签批凭据dialog显示代办同事、代表财务主管及本人签名冻结状态。无page.route业务mock。

关键日志：`/private/tmp/jg-task15-final-api219.log`、`final-web56.log`、`final-api-type02.log`、`final-shared-type.log`、`final-web-type04.log`、`final-api-lint02.log`、`final-web-lint02.log`、`final-scoped-web-lint.log`、`final-ui02.log`、`final-api-build.log`、`final-api-emit.log`、`final-web-build04.log`、`final-ready-chain03.log`、`final-static369.log`、`browser-final.log`、`browser-result.json`、`final-synthetic-server.log`（共同前缀`/private/tmp/jg-task15-`）。截图同前缀`ui-*`。

## 未执行与失败留存

新增三表/199号迁移全部仅准备源码与Prisma codegen，未执行SQL。SQL含scope-kind-company绑定、单开账根/单pending/confirmed后继、同account前版FK、不可变来源与守恒、正式round/本人签批证据、fund namespace内command/round唯一及回执不可变；其它ActionLog类型不放宽、不新增泛回执表。

PG约束/并发9个逻辑case仅准备在既有opt-in库存，不运行、不连接、不import资源driver。当前总79文件/532逻辑，CI78/531、人工1；不能算真实PG通过。合成DB的事务冲突注入只证明fresh回执回读分支与不重跑写，不证明真实PG并发可见性。

旧失败保留：初始codegen保护拒绝；旧Vite watcher供旧页导致的阶段browser不作为最终证据；独立preview formal01真实抓到旧待归还占位，移除后再验；formal metadata/动作provenance/route旧计数失败逐门保留；原spot DTO期待少新scope descriptor的2项失败已按实际协议更新后219通过。收据不以旧阶段无签名绿跑代替正式协议验证。原receipt窄只读审计只针对旧5文件hash；最终service新增P2002/P2034后fresh读分支另以最终hash/公开边界测试绑定，不扩用旧审计结论。

未创建真实PG/Docker资源、执行迁移、连接银行、真实短信/对象存储/交易、推送、关闭Issue、部署或生产写。原dirty根业务没有读取/吸收/写入/reset/stash/clean。仅私有树和明确授权的只读技能文件被使用。

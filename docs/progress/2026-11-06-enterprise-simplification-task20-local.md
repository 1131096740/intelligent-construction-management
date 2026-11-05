# 任务20 / #402 综合采购申请本地候选

本记录对应独立分支 `codex/enterprise-task20-general-request-20261106`，实施范围为 PUR02–06 与已确认的申请保存/提交/并联审批/采购待办、真实响应式表格及受控委托公开边界。尚待主控独立 Spec/Standards 审查及正式整合；不是任务21实际采购付款或生产验收。

## 最终行为

- 所有有效岗位可发起公司日常或有权项目的需求；公司日常不虚选项目，只有当前公司全局综合主管审批，项目由综合主管与项目经理两职责并联。技术管理员没有业务审批权；跨项目、失效岗位、越界委托和旧轮次均拒绝。
- 清单名称必填，其余规格、单位、数量、单价、预计总价、日期、说明均可未知 NULL。数量和预计元金额按02规范化为最多四位十进制字符串；整单预计采用 `Decimal(24,4)?`，不经浮点或补零，预计字段不转成真实分金额/付款容量。独立整单预计与部分已知行小计分别展示。
- 当前岗位/同一事项有界委托决定实际办理权。本人兼任综合主管和项目经理仍为两个职责、两次动作，各需自审原因/当前密码/当前签名；通知可按职责发出但不充当审批签章证明。修订CAS、冻结本轮快照、退回/撤回及迟到动作拒绝沿既有协议。
- 通过后为“待综合部采购”；新协议不收货、不沿旧归档结案或估价转实付。旧合法历史/附件仍只读可见。仅原报销准备函数增加旧协议及已知项目/公司/金额守卫，原付款算法未改。
- 通知沿既有 ApprovalSmsService，使用提交后 durable outbox/幂等事实；失败不阻断审批，结果未知不自动重发。本地所有发送为显式合成适配器，未发送真实短信。

## 新旧协议及字段定义

公开 POST 新建一律由服务端写 `requestProtocolVersion=2`，客户端不能降级；无需用户选择模式。旧完整请求体也不会自动创建 v1。存量默认 v1 继续原已知金额/串联历史流程，原7类别 key/label/order 和 v1 definition 指纹保持。历史编辑组件只编辑已有 v1，已移除不可达的新建路径。

options 保留原 `entryDefinition` v1，另提供 `requestEntryDefinition`（`general_procurement.request` v2）。新表格按真实服务端定义渲染，提交冻结 typed lines 与 v2 definition；这是本领域快照接通，不冒称已注册通用 scene/通用冻结器。详情优先使用冻结定义，原通用场景与付款字段保持。

## 实际证据与失败保留

证据目录：`/private/tmp/jg-task20-evidence/`。公开 HTTP 使用实际 Nest controllers/services、生产 JWT/PermissionGuard/RetiredWriteEntryGuard/DTO，自有内存持久层与 private-file/SMS 边界合成适配器；浏览器真实调用本地 HTTP，无 page.route/localStorage 假业务。

- 02 保存仅名称/NULL 的公开 RED400；05 GREEN；其后详情、并联提交、编辑、全角色选项、通知、委托、当前待办、撤回、删除逐步公开 RED→GREEN。42 四位金额 RED400→52 新源37项通过。
- 54：相关API12套525项通过，含完整37项公开HTTP、审批/委托/文件/权限/Me与旧兼容；56–57 API类型/lint exit0。90 为最后 browser fixture 改后 fresh API build，未继承旧 build 的 freshness。
- 83：最终15项真实浏览器通过55.7秒，桌面1366×768、touch390×844 Chromium/WebKit，原45秒预算/0 retry/0 skip。覆盖两种范围保存提交审批、行复制/撤销、实际离线前置GET0POST、五位拒绝→四位重试、已有v1编辑保留12345分。截图按设备和scope保存。
- 72 保留14pass/1fail：Tab提交名称后自动进入下一格空编辑器，屏上提示确认、保存disabled，未发生POST或丢值。76诊断打印实际focused editor/value/cell；83明确下一格输入规格→保存disabled→Enter确认→真实POST包含规格。70为历史编辑POST201后漏写“用途：”前缀的locator失败，已按真实DOM修正。
- 84–88：Web类型/lint/UI/E2E类型、相关3文件168项通过；lint0 errors/762 warnings，不宣称零警告。共享及API类型/lint按各日志检查。
- 原环境/夹具/交互失败全部保留：01 Prisma缓存utime前置，24缺ts-node改为本树TS transpile适配器，25 Mach权限0场景，49旧Vite预构建新增export未解析（最终移除UI未用runtime export，改由API定义驱动，无清缓存/force），64夹具历史表未初始化，89治理BUILD_STALE；均不计业务通过。

## 仅准备的数据库验证

新增 `20261106090000_general_procurement_requests` 为第199份迁移源码，SQL与checksum已登记，**未应用**。约束包含协议不可降级、新2估价/NULL/范围/行形状、提交后主体冻结；需要未来真实PG证明，不将合成适配器当约束/竞争证据。

在既有opt-in `general-procurement-http-postgres.spec.ts` 注册3个真实 literal it，body调用公开HTTP/Prisma断言：NULL约束、同职责竞争、末同意与合法退回竞争。调用体位于 `general-procurement-request.http.pg.prepared.ts`，导入不连接资源；只有既有 `RUN_GENERAL_PROCUREMENT_PG16` 受控runner未来执行才计动态通过。静态库存81–82：527逻辑项（CI526+manual1）、199迁移，executed=false。

原12个该领域PG用例没有改断言/skip，因其公开旧完整body缺新2的scope/lines且公开创建统一server2，真实前提已过时，明确 KNOWN_STALE / NOT_EXECUTED；不能给出旧12通过。未来需经批准准备历史v1 fixture或更新为新2公开约定。

## 收束与限制

原7write/7check与contractMutation、静态369编排结果以最终日志及下方完成段为准，不弱化checker/断言/预算。只封本地候选，未推送、合中央、关闭工单、运行远端CI、连接PG/资源driver、执行迁移/真实短信银行COS/实际付款收货/PDF输出/部署/生产。中央任务11实际PDF字形失败由主控记录，本候选不将其宣布通过。

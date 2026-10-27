# 统一审批进度与短信催办：本地审查与验收

日期：2026-10-27。当前适配基线 `9a32df2948ff8128e24281f26839de500ccf13fc`；原基线 `a6a9b08a94c0ac9747b9741bb5563e8522ce435c` 的验证另列历史记录。
用户要求本地实现、检查遗漏与权限，独立审核一并纳入；随后授权修复日期测试失败、完成验证并提交、推送、创建 PR 和检查 CI；保留其他未提交修改，暂不合并和部署。

## 候选与保留边界

原本地提交为 55 个文件（`6a43117d`）；当前在同一隔离候选适配最新主线，分支 `codex/approval-progress-review`。位于独立候选 `/Users/leoyang/.codex/worktrees/approval-progress-review/建工智管`。从基线提取本次审批改动，再在候选中审查、修复和验证；未覆盖原目录 `/Users/leoyang/Projects/建工智管`，未打包其经营主体/台账等其他修改。原目录中的上轮审批实现并未反向覆盖；本次提交使用此隔离候选。

已创建草稿 [PR #380](https://github.com/1131096740/intelligent-construction-management/pull/380)。原头因主线已前进 479 个提交产生冲突，正在同步后重新验证；CI 结论以 PR 最新准确提交为准，不沿用原头证据。未部署、迁移生产、修改真实审批、读取真实短信凭证或发送真实短信。没有 Schema、迁移或锁文件变更。候选使用其自身按锁文件安装的依赖。

## 审查结论

Standards（权限、状态、并发）与 Spec（业务覆盖、前端入口、反馈）复核后，本次确认的问题均已修复；这不是零漏洞保证或生产发布结论。

| 发现 | 修复及回归 |
| --- | --- |
| 后续/历史审批人被遗漏，独立审核未接入 | 十二类审批实例加 31 类独立审核，共 43 个来源统一出现在审批中心；七类原单据详情共用进度组件 |
| 借款流程参与资格意外开放整个员工账户及其他还款 | 新增参与资格只返回当前单据自身放款，不查账户及其他还款；原有领域权限保持 |
| 合法冻结节点委托遗漏，以及指定审批人被他人的常驻委托绕过 | 复用作用域/冻结身份校验，常驻委托必须代表已指定人员；非法转审元数据不授予查阅资格 |
| 页面确认人员与实际发送人员可能变化 | 前后端传递进度令牌；状态/节点/接收人变化拒绝旧确认，要求刷新确认 |
| 不确定响应后重试可能换新键，或成功回读后旧键一直残留 | 未知保留原请求；权威回读找到该请求才释放；冷却时刷新回读，不重复发送 |
| 空授权分页导致后续来源不可达 | 持续扫描带游标的空页，组件卸载取消，刷新同步展开详情 |
| 全局/项目岗位混用、口头事实权限、自审限制、过期记录仍可催办 | 各独立来源按原业务角色和范围核对；失效节点不产生收件人；零采未启用保留查看但禁催办 |
| 旧用章、接管退回、归档退回处理人只存审计，离任后不可见 | 仅按业务类型、对象 ID、审核动作白名单读取历史；下载者/其他业务审核人不获权限 |
| 条件失效的待审记录被误标驳回、停止记录被旧发布时间误标通过 | 区分真实终态与待补正/待核对；撤销、停止优先，不虚构审核结论 |
| 新催办动作缺少发布清单可验证的权限链 | 发送前读取同一流程能力，并保留原确认令牌；更新派生清单，并按主线机制将三条已无页面消费者的旧 HTTP 催办入口以 410 退休；无检查器或豁免变更 |

查看资格与执行审批资格分离。历史人员只获得回看权；短信只发当前有效待审批人。技术管理员没有通用业务审批特权，仅结算模板保留原有技术发布权限。旧数据未保存的人员或动作不凭空补造；没有冻结名单的节点明确标注当前岗位名单。

## 最新主线适配与验证

主线新增综合采购、公司间划转、资金执行事项三类审批，以及六类独立审核，本次按已有审批写端的角色、范围、自审、委托和业务状态规则接入；没有扩展审批执行权限。`formal_approval_evidence` 是完成业务动作后生成的凭据，列表不重复展示，详情映射回实际来源。

- 主线岗位过滤、限定事项委托、项目费用/零采身份范围、入职重提、停用项目和最新审批实例绑定已补回归；Standards 最终定向 3 套 114 项通过，已知发现清零。
- API 全量 488 套、8537 项通过，64 套/540 项既有跳过（`api-main-full.log`）；API 类型、lint、构建通过。旧入口退役增量 3 套 30 项通过：真实 HTTP 证明三条旧路由返回 410 且不执行催办，新统一入口继续返回 201 并转发确认令牌；增量后 API 类型与完整 lint 再次通过。远程 CI 将重新跑完整最新提交。
- Web 全量 238 文件、2222 项通过，桌面 Chromium/手机 WebKit 共 20 场景通过；类型、E2E 类型、构建、UI 检查及 lint 通过（既有 warning 保留）。日志 `jgzg-approval-rebase-web-*` 与 `jgzg-approval-rebase-browser.log` 位于 `/private/tmp/`。
- 真实 PostgreSQL 16/Nest HTTP 15 组通过（`pg-main-final-r3.log`），应用当前 197 条迁移，覆盖新增综合采购、入职重提及全部 31 来源真实列表查询。前两次失败分别是旧夹具缺施工企业绑定、新夹具采购分类值不合法，已修正夹具而非放宽约束，失败记录保留；本次容器和匿名卷已清理。
- 全部 10 项发布清单冻结检查通过，695 路由、392 页面动作、0 阻塞（`/private/tmp/jgzg-approval-rebase-manifests-final.log`）；保留主线原有分类和检查器，仅登记本次统一入口与三条真实退休入口。Standards/Spec 复核均无已确认的未闭合问题。
- 本记录封存推送前的本地证据，GitHub CI 最终结果绑定 PR #380 的最新准确提交；旧基线 124 迁移/455 路由结果不作为当前证据。
- 日期测试沿用最新主线已固定的时钟，保留本次近期/超期两条回归断言；未覆盖主线实现。

## 原基线本地验证（历史）

原始输出：`/private/tmp/jgzg-approval-review-20261027/`。下表仅绑定旧基线及原提交 `6a43117d`，不作为主线适配后的验证结论。

| 验证 | 结果与证据 |
| --- | --- |
| 发布清单六项冻结检查 | 合同能力 matched；Nest/Web API/页面动作/用途/总能力矩阵全部通过，455 路由、236 动作、0 阻塞；`release-manifests-final.log`。这是本地检查，不是远程 CI |
| 最终审批相关 API | 17 套、642 通过、9 跳过；`api-final-targeted-tests.log` |
| 完整 API（日期修复后重跑） | 313 套通过、6078 项通过、74 项既有跳过、零失败；`api-commit-full-tests.log`。最终来源历史补读和日期修复均包含在全量中 |
| 基线失败核对 | 精确 HEAD 的 MeService 同一断言失败：固定 2026-07-20 夹具未冻结时钟，超过 90 天后全归 stale，截取 30 条而断言 31；`api-baseline-me-evidence.md`、`api-baseline-me-tests.log`。本次已按新增授权修复：仅在该用例调用期间固定 Date.now 为 2026-07-21，并在 finally 恢复；补断言 30 条近期、1 条超期，保留原截取与总数语义。定向先失败再通过，整个 MeService 36 项通过（date-test-red.log / date-test-green.log） |
| 独立审核来源 | 30 项测试通过，包括全部 25 来源 load/list 查询的 Prisma DMMF 校验；被上述最终 API 定向覆盖 |
| 真实本地 PostgreSQL 16 + Nest HTTP + Prisma | 13 组全部通过；`pg-final.log`。应用基线 124 个迁移，结束清理一次性容器和匿名卷 |
| Web 全量 | 182 文件、1950 项通过；`/private/tmp/jgzg-approval-capability-web-full.log` |
| 桌面 Chromium / 手机 WebKit | 共 20 场景通过；`/private/tmp/jgzg-approval-capability-browser.log` |
| 类型、lint、构建、UI | API/Web typecheck、Web E2E typecheck、两端 lint、构建及 check:ui 通过；本轮 API typecheck/lint 重新通过：`api-commit-typecheck.log`、`api-commit-lint.log` |

真实数据库覆盖原审批实例授权/旧确认拒绝/并发同键与不同键/共享冷却/未知结果不重发/终态关闭，以及独立用章、还款、标准条款、结算模板、税务复核、旧审计回看、费用隐私和跨来源分页。25 来源均执行真实列表查询；并非逐类完成全部真实业务 HTTP 生命周期。HTTP 测试只在回环测试服务器注入测试身份，服务/Prisma 权限校验为真实实现，不构成生产 JWT 验收。

浏览器使用真实本地 SPA 和虚构 HTTP 数据，验证确认对象、三类短信结果、未知请求重试、分页/刷新/卸载、桌面及手机显示；不等同真实供应商端到端验收。短信由假适配器替代，默认生产配置仍关闭。真实签名、模板和手机送达需要另行授权验收，参见 [运行说明](../runbooks/approval-progress-sms.md)。

旧提交阶段新增修改仅为 MeService 测试及记录，审批运行时代码、Web、数据库验收脚本、清单文件与上轮验证版本逐文件哈希一致，沿用表中对应验证结果。首次全量重跑因沙箱禁止监听 127.0.0.1 使 HTTP 用例失败（`api-commit-sandbox-tests.log`）；允许本机回环监听后同一完整命令通过，未绕过测试或修改业务逻辑。

## 独立来源目录

`G` = 全局岗位；`G/P` = 业务允许的全局岗位或本项目岗位（UserPosition + ProjectMember；全局岗位按主线 shared 规则过滤）；不把其他项目岗位、花名册归属或技术管理员身份视为业务审批授权。各来源保留已有业务状态机，仅增加进度读取和催办投影。

| 来源 | 中文名称 | 真实待审状态/条件 | 当前审核角色 | 范围 |
|---|---|---|---|---|
| employee_registration | 员工入职审核 | pending；转交后 chairman_review；重新提交恢复初审 | 初审综合部主管或董事长；转交后董事长 | G |
| contract_economic_review | 履约范围复核 | pending_review → 可选 pending_finance；有效项目 | 合同部主管 → 财务主管；排除编制人，财务阶段排除前一审核人 | G/P |
| contract_bank_verification | 银行流水核验 | pending_confirm；项目级须有效项目；排除记录人 | 财务主管 | G |
| contract_proxy_execution | 代付及往来确认 | pending_confirm；有效项目；排除记录人 | 财务主管 | G/P |
| upward_contract_amount_revision | 对上合同金额修订 | pending_confirm；有效项目；排除记录人 | 合同部主管 | G/P |
| upward_receipt_match | 对上到账核销 | pending_confirm；有效项目；排除记录人 | 财务主管 | G/P |
| contract_seal | 用章审批 | ContractVersion.approved_pending_seal；治理版须 ContractSealTask.pending_approval | 综合部主管 | 治理版 G，旧版 G/P |
| contract_archive | 合同归档确认 | pending_archive_confirm；存在待确认归档件；治理版任务 completed 且存在有效双方最终版 | 合同部主管；上传人仅兼任指定经办人时可自确认 | 治理版 G，旧版 G/P |
| settlement_archive | 结算归档确认 | Settlement.pending_archive_confirm；存在待确认归档件/治理版最终签名合成件 | 合同部主管 | G/P |
| receipt_review | 收货复核 | Receipt.submitted；采购 approved_in_progress、版本 approved、当前版本/修订/经办人一致 | 物资主管 | G/P |
| tax_fact_review | 合同税务事实复核 | pending_finance_review → pending_contract_confirmation | 财务主管 → 合同部主管 | G/P |
| takeover_review | 历史合同接管复核 | ContractTakeover.pending_review | 合同部主管 | G/P |
| takeover_batch_review | 历史接管批次验收 | drafts_generated → under_review；终态 accepted/limited_accepted/disputed | 合同部主管 | G/P |
| takeover_contract_confirmation | 历史接管合同侧确认 | 已保存 ContractFacts，confirmedRevision 为 null，尚未 activated | 合同部主管 | G/P |
| takeover_finance_confirmation | 历史接管财务侧确认 | 已保存 FinanceFacts，confirmedRevision 为 null，依据的财务基线修订仍有效，尚未 activated | 财务主管 | G/P |
| takeover_correction | 历史接管更正复核 | Correction.submitted 且接管已 confirmed | 公司主体/历史结算：合同部主管；历史付款/历史预付/超付：财务主管；沿用主线允许的同人兼岗更正规则 | G/P |
| abnormal_termination | 零采异常终止确认 | AbnormalTermination.requested 且采购 approved_in_progress | 财务主管 | G/P |
| loan_repayment | 员工还款确认 | EmployeeLoanRepayment.recorded，关联项目借款账户 | 财务主管 | G/P |
| no_invoice | 无票据确认 | pending_review；当前有效采购及 reviewed 收货修订、最新物资复核 approved；真实表单 paymentType 非 null 时禁止 | 财务主管 | G/P |
| invoice_exception | 票据例外确认 | 同上 | 财务主管 | G/P |
| upstream_fund | 上游资金事实确认 | pending_confirm；排除 unreconciled_receipt_difference | 书面：财务人员/主管；口头：财务主管 | G/P |
| affiliate_contract | 挂靠合同事实确认 | pending_confirm | 合同部主管 | G/P |
| affiliate_settlement | 挂靠结算事实确认 | pending_confirm | 预算人员 | G/P |
| affiliate_payment | 挂靠付款事实确认 | pending_confirm | 书面：财务人员/主管；口头：财务主管 | G/P |
| affiliate_company_contract | 挂靠公司合同确认 | pending_confirm | 合同部主管 | G/P |
| upstream_settlement | 上游结算确认 | pending_confirm | 预算人员 | G/P |
| owner_contract | 业主主合同确认 | pending_confirm | 合同部主管 | G/P |
| contract_template | 合同模板发布审核 | ContractBusinessTemplateVersion.submitted | 合同部主管 | G |
| layout_template | 版式模板发布审核 | ContractLayoutTemplateVersion.submitted | 合同部主管 | G |
| standard_clause | 标准条款发布审核 | StandardClauseVersion.submitted | 合同部主管 | G |
| settlement_template | 结算模板发布审核 | SettlementTemplateVersion.submitted | 合同部主管或技术管理员（仅保留原技术模板权限） | G |


没有提交后等待另一人审核状态的即时确认、文件解析、口令确认、实付登记等，保留原业务动作，不人为增加审批流程。独立审核均由审批中心进入；未给每个原独立业务页面增加新的独立面板。

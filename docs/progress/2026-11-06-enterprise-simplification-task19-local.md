# 任务19 / #401 本地候选与准备边界

本票仅生产零星材料申请及项目物资采购待办，基线 `4bdc84ff09aeec9c4d3c9da5417a855b22cbff9f`，私有分支 `codex/enterprise-task19-spot-request-20261106`。候选尚待主控两轴复审、整合和明确阶段收口；不关闭 Issue，不作为部署或生产完成证明。

## 可复核行为

- 新建只需项目与材料名称；申请人/部门空白沿用本人资料。单位、数量、到位日和预计值可以未知留空，服务端保留 NULL；已知数量/预计价格金额最多4位。独立算例 `1.2345 × 1.2345 → 1.5240`，未知数量不计算成0。预计额与旧实际价格/整数分列分开，不作为付款容量。
- 项目物资员限定项目；公司物资主管可跨项目发起。真实 JWT、PermissionGuard、RetiredWriteEntryGuard 覆盖公司主管201、错误项目岗位主管403、跨项目物资员403、停用401、五位数字400及客户端降级协议400，负控不写草稿。
- 新建由服务器固定 `requestProtocolVersion=2`。两项并联职责继续复用03/05的当前人员、签字、自审、委托协议；全通过后仅形成批准的申请及采购待办，不创建旧付款或收货草稿。待办由当前批准版本、业务状态和当前项目物资员/真实公司主管权限派生，通知不是事实来源。采购通知复用持久日志发送意图，逐当前项目物资员幂等排队并在发送前再鉴权。
- 新2保存、提交均在既有版本锁内核对 `expectedVersionId` 与单调 `expectedDraftRevision`；保存成功加1。预检GET不会替换当前填写捕获的坐标。其他页面先保存则旧请求409；先提交则保存被草稿状态门拒绝。退回/撤回产生新版本标识，旧版本请求即使修订号相同也无效。
- 复用06同一 `JgBusinessGrid`、选择/行操作组件；电脑与触摸手机沿用表格。连续编辑、批量复制删除撤销、四位数字错误就近定位、新建/编辑自动保存及手动保存贯通本地真实Nest HTTP。冲突或结果不明保留当前填写、停止自动写，不把读取到新修订号当本人保存回执。
- 原 `spot_procurement.application` / `application_line` 定义、精度和冻结快照保持原形；新2单独注册 `request_v2` / `request_line_v2`，没有第二个新建菜单或客户端降级开关。旧1保留完整资料约束和原后继；未知资料不进入旧1自动付款/收货链。

全批新2不得通过普通修订撤回采购待办：生产HTTP在修改前返回409，版本和待办原样保留，读模型不启用修订动作。原HTTP尝试曾被既有entry目标校验以400挡住，因此未声称旧HTTP已成功撤批；公开服务合成持久层RED曾返回draft，修复后在版本准备、下游查找和写入前409。legacy1原路径未改。

## Schema与兼容

SQL仅准备：`20261106001000_spot_material_request_v2`。199份迁移源码并不等于已应用199次迁移。

- Version：原到位日 nullable；新增服务器协议号、草稿修订号（均默认1，原事实不回填金额）和可空预计总额 `Decimal(24,4)`。
- Line：原单位、数量 nullable；数量列仍 `Decimal(24,6)` 承载历史，只限制新输入4位；新增可空预计单价、预计金额 `Decimal(24,4)`。不复用旧实际价格/整数分列，不将NULL改0。
- nullable兼容仅涉及本域读模型、审批单空值中文展示，以及旧付款/收货消费点的类型和空值安全；不实现21实际批次、采购付款、资金或成本分录。

## 测试与失败记录

阶段检查使用 Node20.20.2 / pnpm9.15.9；精确最终命令、退出码和日志哈希由私有总收据及源码packet绑定，不以文档数字替代最终指纹。

- API8套288项、Web11文件234项、共享权限54项通过；API/Web类型与lint、UI规则和e2e类型通过。最后8浏览器全部通过（27.5秒）；原7清单write/check均0，填写入口require-ready亦0。
- 8个真实浏览器场景覆盖桌面1366×768及触摸390×844，连接真实Nest控制器、服务、业务定义、事务快照和全部生产鉴权守卫；仅持久适配器、私有文件元数据和网关为合成边界。没有 `page.route` 业务替身，localStorage仅用于测试认证及产品原有本机恢复。
- 并联同意/退回及采购待办通过真实HTTP请求验证；保存冲突场景实际经过 fresh capability GET，再携带捕获旧修订号PATCH，独立GET确认他人文本没有被覆盖。
- 旧主管禁发起预期、旧2位/无预计值界面文字随PUR01/PUR03更新，旧冻结快照及生命周期负控保留。原失败日志没有删除：主管403、NULL日期、预计值未保存、末岗创建旧付款/收货、通知取消、保存/提交旧修订无效等RED；浏览器沙箱拒绝、测试标签/唯一定位和编码URL修正、fixture行对象alias造成回执多加1，以及类型检查失败亦保留。
- fixture修正为独立读取对象，只修合成适配器；没有改变真实CAS算式、断言或超时预算。冲突截图的旧材料名称为已保存值，未保存文字位于Tab进入的规格列；沿原场景重新进入该格、核对编辑器并Esc后仍保留，桌面/手机2项补核通过，没有修改公共表格。

原页面动作检查曾报7/11/8个阻塞，失败保留。实际根因是19新增工作台请求体rest拆解被能力来源闭包视为不安全、提交参数中原failclosed helper被局部别名遮断。现改为公共请求体直接构造、创建时追加项目，提交保留原inline guard并捕获旧坐标；新增工作台PATCH仅登记spot动作。仓库checker原样，最新原脚本398动作/0阻塞；外部临时诊断副本仅输出来源/匹配trace，不能作为通过证据，原文件与观测副本哈希在私有总收据记录。

原369首轮368通过、1失败、0跳过，失败为新增PG准备案例后CI库存实际524而旧静态断言仍523，未改预算或超时。失败日志保留，主控批准将该CI常量523同步为524后，原369复跑369通过、0失败、0跳过（9469ms）；其它断言、skip和预算未改。

## 尚未证明及未执行（0730检查点，后续见下）

1. 旧公开 `PATCH /spot-procurement-payments/:paymentId/draft` 与 `POST /spot-procurement-payments/:paymentId/submission` 的新NULL负控，以及审批PDF空值实际文件输出，仍等待主控取得补充测试边界确认；没有编写或运行这些新动作测试，没有把兼容编译当实际业务通过。父级 `POST /spot-procurements/:procurementId/payment-drafts` 只读核实仍要求当前版本已有安全invalidated付款来源，新2正常无来源时在创建前409；本票未扩此写边界。
2. 真实PG仅准备一项新2公开HTTP案例，登记在原 `pol113_pol115_business_entries` 组；库存525逻辑项（CI可选524、人工1）全部未执行。原spot组既有11项中的旧“当前create→无新2坐标submission→autoPayment/receipt”假设已被新规格替代，标记 `KNOWN_STALE_NOT_RUN`：未改其原断言、预算或skip，不能把库存称为有效全链证明。16真实PG/资金授权前须统一用可信legacy1历史seed或显式新2夹具修齐；不以等待21代替该硬门。
3. 没有启动PG、Docker或迁移，没有调用/导入资源driver，没有连接真实短信、银行、COS、办理采购或付款、部署或生产写入。没有读取、复用或修改原dirty根业务文件，没有推送、合入中央/main、远端CI或关闭Issue。16/42/44真实门不解除。


## 2026-11-06 用户补充确认后的续作

用户明确确认实际 `/draft`、`/submission` 两处合成公开HTTP及实际审批PDF输出边界，原错误路径未用于测试。原 `0730e952` 及失败均保留；已正式合入中央业务 `1acb8412`、最新授权文档 `5fefe9a2`。合并后业务checkpoint `f5f924f3`，本次新增验证未修改付款服务、审批文书服务/模板或产品字体；既有NULL兼容围栏首次新测即成立，不制造RED。最终干净候选由外部准确源码packet绑定。

- 真实Nest HTTP两条路径经过JWT、PermissionGuard、RetiredWriteEntryGuard与DTO验证，合成持久适配器在申请数量NULL时返回中文数量拒绝；遍历所有合成delegate的create/update/delete/upsert均零调用。同一入口恢复已知数量后分别200/201，付款更新及审计各1次，提交创建审批1次。完整付款real-form38项全过/0skip。
- 实际公开 `renderForDownload` 两组首次通过；未知数量/单位/日期精确3处“待确定”，已知12.3456/米/2026-07-18保留，同样1页A4。完整ApprovalForm66过/9个原it.skip保留，本次未新增skip。PDFJS仅作语义，不单独当可见文字证明。
- 新test-only CFF物理检查读取同两份实际PDF嵌入字库与get_texttrace；未知96/已知103种非空字形，0个gid0/空轮廓/隐形文字，目标位置栅格存在墨迹，独立查看两张整页栅格文字可读。PDFKit及水印可能产生同名字族的不同raw-CFF子集，检查保留所有字库候选并结合目标栅格和人工逐位置核查，不冒称系统字体/LibreOffice发布runtime验收。原TTFont-only工具不支持raw-CFF错误保留，未修改正式Task11 checker。
- 原8真实浏览器首次均在macOS沙箱mach_port启动前置失败（约1ms/例），日志与trace保留，不计业务RED；正式require_escalated补启动权限后，同source/30秒场景/0retry/原断言，一次8/8通过29.3秒。独立新输出目录，没有覆盖旧浏览器图。
- 最新相关API10套392过/9原条件skip；Web10文件182与wrapper52共234过；Shared3文件56过（permissions54）。API/Web类型与lint、UI、E2E类型通过；Web827 warning/0error保留，不冒称零warning。完整369留中央独立merger，不拼旧369作新候选资格。
- 19与20合并后真实PG库存528/CI527、SQL源码200份，仅准备，绝未执行或连接数据库；原旧零采PG前提仍KNOWN_STALE_NOT_RUN，16真实运行前必须用可信legacy1历史seed/新2夹具修齐。第一次合并漏per-file组来源导致静态61/16，补完整19组后76/1（遗漏原181/12断言），按两边源码恢复后原两文件77/77全过；前两次失败保留，不改runner守卫或skip。
- 合并治理registry先前简单按id并集漏保留19既有capability来源字段，原checker报4个动作阻塞；按base-aware三方字段意图恢复后409动作/0阻塞。709路由、663wrapper/702绑定、contractMutation80/22、原7写/核及填写入口原守卫保留。新增测试晚于build的metadata BUILD_STALE拒绝保留，按原规则fresh build后核，不放宽新鲜度。

准确日志、命令与产物统一在 `/private/tmp/jg-task19-resume-20261106/`。实际PDF及物理收据：

- 未知PDF `fef334e173a24115aa8abdde31da7552094482917b7bbdf661d8faed02ac0563`，`pdf-unknown-final-physical/receipt.json` / `page-1.png`。
- 已知PDF `03544110532d6e0b55974c601201ccbc7e2b9164ba37625b5d7bcee1c4e3c9fe`，`pdf-known-final-physical/receipt.json` / `page-1.png`。

上述关闭原0730记录第1项待确认/待验边界；不关闭21实际采购付款、真实PG、16/42/44、Task11坏字体runtime空白success未修问题。无真实短信、COS、银行、采购/付款、资源创建、SQL/迁移、main合并、部署或生产写入；候选未push、未关Issue，待主控独立两轴审查和merger。

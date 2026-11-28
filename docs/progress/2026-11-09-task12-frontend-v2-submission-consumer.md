# Task12 Web CON10→V2正式提交 consumer 局部收据

2026-11-09。独立树 `/private/tmp/jg-382-task12-frontend-submit-20261109`，branch `codex/enterprise-task12-frontend-submit-20261109`，基点/HEAD `e08eac4045b6539323694e3ad1595e375bf6150a`。仅未提交Web源码及状态文档，HOLD待独立审查；未写backend作者树、中央或原HOLD候选。

## 已实现范围

- 沿原工作台、正文编辑器和敏感确认弹窗消费CON10。当前临时receipt保V/draftRevision/documentContentRevision/F/layout/sourceSha/plan/remaining；普通空位保留时确认可继续，不强制补齐。输入、真实修订/F/模板变化失效；fresh读取期间短暂无authority不会把同一未变receipt误清掉。
- 原保存flush、fresh capability及lease验证继续执行。读取真实生成列表，按同V、聚合修订、正文R_F、layout与模板sourceSha及不同Word/PDF文件过滤；本次固定一个真实generatedDocumentId。同版重复生成允许合同员明确选择，不要求库存只能一条，不猜文件名/first/latest。
- POST仍是 `/contract-drafts/:V/submission`，发送submissionProtocolVersion=2及e08实际DTO完整字段。正常消费真实V/R/formalCode/status响应；旧扩展draftRevision/firstSubmittedAt不作为V2必有字段，不显示审批实例技术ID。未改后端cap=false/409/410或角色权限。
- 完整intent/key/原命令SHA及原已知业务编号按当前actor+Version保存。明确拒绝后同意图复用原key/全payload；UNKNOWN锁住编辑、重复提交和其它草稿写入口，停止本机租约计时，不借恢复继续续租或释放租约。
- 按原key GET真实批准的 `/contract-drafts/:V/submission-requests/:key` 合同；逐字段及原命令SHA/Version/原已知编号核对后才清intent并导航详情。已知编号比对仅在提交前已有非空正式code时适用；初始无code允许真实原submitted回执给新非空编号，不拿临时编号/NULL要求相等，不提前分配。notfound/unknown、错intent/sha/code、403/查询失败继续保留，不重POST/换key。刷新可核旧轮，不用当前修改后的R_F重算原请求结果；详情另读当前状态。

GET读合同来自外部 `/private/tmp/jg-task12-archive-A-source-evidence-20261108/submission-GET-contract/CONTRACT.md`（SHA d21bf0c3cc1585d1a0c9cdad80244d4622e1c02866aa68c8a1664c054cde5eb9），后继v2方法完整性加强不改变response/submit DTO；本片只用HTTP边界模拟该已批准合同，不冒后端完整候选已验收。

## A2 独立审查修复

A1原两轴各1P2指向同一遗漏：UNKNOWN下旧本机副本恢复仍可替换编辑model，不涉及原提交key丢失或后端snapshot变化。已沿原public browser/client-persistence边界先实际RED（`recovery-red.log`，当前正文被真实替换为旧副本），再补最小owner锁与页面恢复/放弃禁用得到同条GREEN（`recovery-green.log`）。`restoreLocalRecovery`、`discardLocalRecovery`及`inspectLocalRecovery`自动apply入口统一遵守pendingSubmissionResult及既有提交/草稿动作/保存并发门；未知期间不删副本或改原request。

新增桌面/手机两种公开控制：旧R2/no-saveIntent副本在serverR3显示提醒→CON10丢响应UNKNOWN→恢复动作不改当前正文；reload时匹配R3的合法副本也不自动apply。可观测副本字节/原request intent-key-SHA不变、POST仍1、lease写数不增，随后同原key GET submitted可正常导航。手机实际tap禁用恢复按钮；不止用UI禁用代替owner保护。确认成功后沿原finishSubmission规则处理backup，未用UNKNOWN推断回滚。没有新增DI/helper测试。

## 实际验证

证据根 `/private/tmp/jg-task12-frontend-submit-evidence-20261109`。

- 新独立Playwright public场景使用真实工作台组件、正文编辑器及API模块，仅模拟HTTP持久/文件metadata/时间边界，未新增生产DI或helper测试。逐条真实RED→最小GREEN：旧两字段payload缺V2、同版明确选择、UNKNOWN恢复、F漂移、修改后的提示可见、同intent重试、错回执编号、UNKNOWN其它写动作、UNKNOWN租约自动写。取消、模板/正文revision漂移、刷新旧轮、fresh cap收回、旧修订/异F/无双配对来源为已实现行为的控制检查，不制造假RED。
- A1历史完整配置浏览器20/20通过（42.6s，`final-browser-responsive.log`）：desktop=Chromium 1366×900共16条；mobile=Chromium触控/isMobile上下文390×844共4条（保空位提交、明确选记录、UNKNOWN原key查询/保intent、取消），不冒Safari或实体机。mobile独立4/4原件在`mobile-key-controls.log`；此前desktop16/16（34.6s，`final-browser-v2.log`）及15/15全组（`final-browser.log`）保留。增加mobile仅改测试project配置，三生产源码和场景文件逐SHA保持；新增配置后重新跑整20及affected e2e类型/lint。既有API+composable窄Vitest两suite 156/156（`final-vitest.log`）。原Task10空位browser文件及其0submission历史证据不改；本片新场景是独立consumer测试。
- A2最终browser全24/24（59.1s，desktop18＋Chromium手机触控6），原16＋4完整回归加2个新恢复控制各两端；准确最终原件`a2-final-browser.log`。`recovery-responsive.log`是两新控制4/4；`a2-browser.log`首整24/24为加强手机tap前的测试版本，保留不替代最终源。最窄既有两suite156/156（`a2-vitest.log`）、web类型`a2-web-types.log`、最终e2e类型/lint、全web lint与check:ui均重跑，0errors/981warnings，owned页面仍26warnings。
- `vue-tsc --noEmit`、e2e `tsc --project tsconfig.e2e.json --noEmit`、全Web ESLint和check:ui均exit0。lint为0errors/981warnings，owned页面e08与最终各26warnings；未借机格式化其他模块。通过`pnpm exec`运行底层脚本以避免prehook重建shared，未用旧SDK冒新Schema类型证明。
- 首Chromium沙箱MachPort拒、初期HTTP mock误匹配源码路径/缺cap前提、类型边界诊断及全部业务RED原件均保，未计为业务成功。浏览器获自动审批后只运行自有localhost Vite/fakeHTTP；runner负责关闭自有server/browser，无真实后端/数据库资源。

## 依赖与未完成门

工具固定Node20.20.2、pnpm9.15.9。按具体授权从指定backend树的现成依赖复制至自有树；复制前manifest保存，56,360普通文件逐SHA/模式与源守恒、零共享inode，四个workspace binding均指自有树。shared源匹配后仅复制既有dist，不在源build；未install/下载/SDK生成、import或构造PrismaClient。首次Web绑定缺公共alias时停止，在自有store精确唯一路径补链接，未安装或修改来源。

来源守恒记录归COPY及`dependency-final-guard.json`各自当时边界。此后root另授权backend自有树shared DTO/纯TS build，属于另作者后继，不是本COPY破坏；本片未再次COPY/追其WIP，也未写回。自有e08 shared源/dist与四binding继续独立。

仅本地前端consumer片，不含新归档UI、并联/旧审批详情改造、综合主管盖章consumer、待办重接或outside/upward/inline/FaceB。未改backend/shared/Schema/迁移/Task16及后端capability。无真实PG/SQL/parser、SDK运行、网关、生产、Git写/remote/CI；不宣#394、CON10全生命周期或正式上线完成。

A2外部完整source freeze及相对A1的delta/旧前像包含本次7路径、基点前像、manifest/sourceSet、tracked.patch、全部日志定位及HANDOFF；原计划/审查报告/失败不覆盖。本片作者不自审自己frontend，交作者之外两轴复核。

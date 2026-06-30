# 建工智管 - 进度记录 (PROGRESS)

> 本文件是项目的**唯一进度真相**。AGENTS.md / CLAUDE.md 描述"规则与边界"，本文件描述"做到哪了"。
>
> **协同纪律**：CodeX 和 Claude 每完成一个子任务，必须在此勾选/更新，并随代码一起 commit。接手方开工第一件事就是读本文件。

图例：`[x]` 完成 · `[~]` 部分完成/有雏形 · `[ ]` 未开始

---

## 最近变更 / 下一步（滚动更新，最新在最上）

- 2026-07-01 (CodeX)：完成 Phase 1 合同工作台 Web 管理端 + 后端核心闭环收口。四类合同 `material_purchase`、`equipment_rental`、`labor_subcontract`、`generic_contract` 均已由 live verifier 创建草稿并生成 DOCX/PDF；材料采购路径额外覆盖线下修订稿上传回读、内部送审稿生成、审批提交与审计日志。修复劳务真实模板生成缺 `field.projectName` 的 seed/schema/inspection 覆盖缺口。人工抽查最新生成 PDF 首尾页：材料采购、机械租赁、劳务分包和通用合同均保持 A4、页眉页脚、表格边框和附件图片居中适配。验证：目标 API 测试 114 个通过、`migrate deploy`、`seed`、`verify:contract-workbench`、API/Web typecheck 与 lint 均通过。生产部署、小程序移动端和更完整浏览器响应式矩阵不纳入本次 Phase 1 闭环。
- 2026-07-01 (CodeX)：补齐合同/付款审批打回控制。合同与付款审批 review 支持 `reject_previous`、`return_to_applicant`，并新增运行时 decision 白名单；退回上一节点会清空上一节点和当前节点已批角色、实例保持 `in_progress`、业务保持审批中；打回申请人会把合同版本/付款申请退回 `draft`，审批实例置 `returned_to_applicant`，并写入对应 `ApprovalActionLog` 与审计动作。验证：`pnpm --filter @jiangkong/api test -- src/contract/contract.service.spec.ts src/payment/payment-request.service.spec.ts`、`pnpm --filter @jiangkong/api typecheck` 通过。
- 2026-07-01 (CodeX)：补齐合同生成附件图片排版规则。合同文档生成会把 PNG/JPEG 图片附件追加进 DOCX 初稿：普通图片独立 A4 页居中适配，身份证人像面/国徽面合并到同一 A4 页上下居中并标注面别；PDF 由已追加图片页的 DOCX 转换后再追加 PDF 类附件，避免图片重复。合同文档区新增身份证人像面/国徽面专用上传入口和附件说明；合作单位快照、合作单位档案页统一改为人像面/国徽面提示。未设置阻断式校验，只做清晰提示和规范命名。验证：`pnpm --filter @jiangkong/api test -- docx-attachment-appender.spec.ts contract-document.processor.spec.ts pdf-normalizer.spec.ts`、`pnpm --filter @jiangkong/api test -- pdf-normalizer.spec.ts contract-template-docx-assets.spec.ts contract-workbench-verification.spec.ts`、`pnpm --filter @jiangkong/web-admin typecheck` 通过；完整 live verifier 尚未在本条后重跑。
- 2026-07-01 (CodeX)：补齐合同工作台 live 验收最终修复。`verify:contract-workbench` 在材料采购 draft DOCX 生成成功且合同版本仍可编辑时，复用生成的 `docxFileId` 实跑 `POST/GET /contract-workbench/:contractVersionId/offline-revisions`，校验线下修订稿持久化与列表回读；材料采购草稿数据补 `projectName`，避免模板就绪/生成缺字段。live 验证前需先执行 `pnpm --filter @jiangkong/api exec prisma migrate deploy`，确保 `ContractOfflineRevision` 迁移已应用。
- 2026-07-01 (CodeX)：修复真实合同模板渲染别名与合同类型/模板一致性问题。合同 DOCX 渲染值新增 `party.owner.*`、`party.counterparty.*` 别名，材料采购 seed schema/sample/inspection 补齐真实模板使用的 `field.projectName`，真实 DOCX 资产测试覆盖材料/机械模板的甲乙方占位；合同草稿创建会校验所选业务模板版本的父模板 `contractTypeKey` 与输入合同类型一致，不一致返回 BadRequest。验证：`pnpm --filter @jiangkong/api test -- contract-document.service.spec.ts core-flow-seed-data.spec.ts contract-template-docx-assets.spec.ts contract.service.spec.ts`、`pnpm --filter @jiangkong/api typecheck`、`git diff --check` 通过。
- 2026-07-01 (CodeX)：完成 Task 6「真实与通用合同 Word 生成验证」。`verify:contract-workbench` 静态覆盖扩展到 `material_purchase`、`equipment_rental`、`labor_subcontract`、`generic_contract`、`offline-revisions` 与四份 DOCX 资产名；live 验收保留材料采购完整 happy path，新增四类已发布模板过滤检查、四类 seed 版式真实 DOCX 文件校验、通用合同草稿保存 + 通用清单行 + draft DOCX/PDF 生成轮询。未做人工打开 Word spot-check，本轮依据 Task 1 已完成的 DOCX/LibreOffice 自动校验、`contract-template-docx-assets.spec.ts` 资产回归和 live LibreOffice 转换结果。验证：`pnpm --filter @jiangkong/api test -- contract-workbench-verification.spec.ts contract-template-docx-assets.spec.ts contract-document.service.spec.ts`、`pnpm --filter @jiangkong/api seed`、`DOC_CONVERTER_COMMAND=/Applications/LibreOffice.app/Contents/MacOS/soffice pnpm --filter @jiangkong/api verify:contract-workbench`、`pnpm --filter @jiangkong/api typecheck`、`pnpm --filter @jiangkong/api lint`、`pnpm --filter @jiangkong/web-admin test`、`pnpm --filter @jiangkong/web-admin typecheck`、`pnpm --filter @jiangkong/web-admin lint` 通过。
- 2026-06-30 (CodeX)：修复 Task 5 前端质量审查问题。合同文档区提交线下修订稿时固定本次请求的合同版本 id，POST 完成后仅在仍停留于同一版本时清空表单、刷新线下修订列表、触发 reload 与成功提示，避免跨合同切换后的过期提交写入当前视图。验证：`pnpm --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts contract-bill-editor.test.ts`、`pnpm --filter @jiangkong/web-admin typecheck`、`git diff --check` 通过。
- 2026-06-30 (CodeX)：修复 Task 5 前端质量审查问题。合同文档区线下修订稿列表加载与 DOCX 上传完成后会校验当前合同版本 id，忽略跨合同切换后的过期异步结果，避免旧合同的修订列表、上传文件或提示消息写入新合同视图。验证：`pnpm --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts contract-bill-editor.test.ts`、`pnpm --filter @jiangkong/web-admin typecheck`、`git diff --check` 通过。
- 2026-06-30 (CodeX)：修复 Task 5 前端质量审查问题。合同文档区线下修订稿表单仅在合同版本 id 变化时清空，避免跨合同残留已选 DOCX/标签/备注/确认状态；文件上传控件改为 visually hidden 输入框并保留键盘焦点样式，附件上传、线下修订稿上传及同类清单导入入口可键盘访问。验证：`pnpm --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts contract-bill-editor.test.ts`、`pnpm --filter @jiangkong/web-admin typecheck`、`git diff --check` 通过。
- 2026-06-30 (CodeX)：完成 Task 5「合同文档区线下修订稿简易 UI」。Web 合同文档分区新增 DOCX 线下修订稿上传确认、标签/备注、确认声明与已上传修订列表；前端 API 补 `GET/POST /contract-workbench/:versionId/offline-revisions` wrappers 与回归测试。验证：`pnpm --filter @jiangkong/web-admin test -- contract-workbench.api.test.ts`、`pnpm --filter @jiangkong/web-admin typecheck` 通过。
- 2026-06-30 (CodeX)：修复 Task 4 线下 Word 修订稿上传质量审查问题。上传线下修订稿在创建记录前复用合同版本 revision/status 与合同 owner/voided 条件 gate，文件权限校验返回值必须是 DOCX（标准 MIME 或 `.docx` 文件名兜底），修订列表排序补稳定 `id desc` 次序，并补回归覆盖文件权限撤销、不允许非 DOCX、MIME 异常但文件名为 DOCX、并发状态冲突。验证：`pnpm --filter @jiangkong/api test -- contract-document.service.spec.ts`、`pnpm --filter @jiangkong/api typecheck` 通过。
- 2026-06-30 (CodeX)：完成 Task 4「线下 Word 修订稿上传持久化」。新增 `ContractOfflineRevision` Prisma 模型与迁移，合同文档服务支持合同控制人对可编辑草稿版本确认上传线下修订稿，复用版本归属/作废/状态 gate 与 `FileService.assertCanDownloadFile` 文件权限校验，可按最新优先列出修订记录，并记录 `contract.document.offline_revision.confirm` 审计。验证：`pnpm --filter @jiangkong/api exec prisma generate`、`pnpm --filter @jiangkong/api test -- contract-document.service.spec.ts`、`pnpm --filter @jiangkong/api typecheck` 通过。
- 2026-06-30 (CodeX)：修复 Task 3 质量审查问题。`generic_contract` 通用合同 seed 字段 schema 补齐 DOCX 已引用的 `projectName` 与 `counterpartyName`，同步预览样例数据、版式 inspection placeholders 和 seed data 回归测试，避免生成通用合同时项目/相对方字段空渲染且 readiness 无法发现。验证：`pnpm --filter @jiangkong/api test -- core-flow-seed-data.spec.ts contract-workbench-verification.spec.ts contract-template-docx-assets.spec.ts` 通过。
- 2026-06-30 (CodeX)：完成合同工作台真实模板 seed 指向与通用 fallback 模板 Task 3。三类既有 seed 版式 DOCX 已切到 `*-real-v1.docx` 真实渲染资产，新增已发布 `generic_contract` 通用合同业务模板/版式/预览/编号规则，劳务模板补齐主合同数据、安全协议、农民工工资承诺书与劳务清单占位；seed 循环和 live 验收脚本覆盖四类模板。验证：`pnpm --filter @jiangkong/api test -- core-flow-seed-data.spec.ts contract-workbench-verification.spec.ts contract-template-docx-assets.spec.ts`、`pnpm --filter @jiangkong/api seed` 通过。
- 2026-06-30 (CodeX)：完成真实合同 Word 模板资产验证 Task 2。新增 DOCX 资产回归测试，覆盖四份渲染模板的必需占位符、页眉页脚、分节、水印标记，以及 customXml/custom props 缺失、core/app 中性元数据和 WPS/LibreOffice/设备/用户来源字符串清理。验证：`pnpm --filter @jiangkong/api test -- contract-template-docx-assets.spec.ts` 通过。
- 2026-06-30 (CodeX)：修复真实合同 Word 模板资产入库规格审查问题。三份 `*-real-v1.docx` 已从源模板重新生成，不再前置“合同工作台填写区”；合同编号、合同名称、金额、付款/结算、关键业务字段和清单循环改为落在原合同正文/原清单位置，移除材料/机械/劳务源模板中的旧样例合同编号和机械合同旧相对方/项目名；劳务模板删除营业执照、开户许可证等本轮不保留附件标签；三份真实模板均补充可渲染水印页眉并保留页脚。验证：XML stale text 检查、占位符/循环检查、header/footer 检查、Docxtemplater 样例渲染、DOCX zip 校验通过。
- 2026-06-30 (CodeX)：完成真实合同 Word 模板资产入库 Task 1。已复制材料采购、工程机械设备租赁真实 DOCX 源模板，使用 LibreOffice 将劳务 `.doc` 转为 `.docx`，新增 source README；基于三份真实源模板生成 `*-real-v1.docx` 渲染资产，在源版式前插入合同工作台填写区、核心字段、条款和清单循环占位符，并新增通用合同 fallback DOCX。验证：source/renderable DOCX 均为有效 Word/OOXML ZIP，四份渲染模板均可被当前 Docxtemplater 以样例数据渲染。
- 2026-06-30 (CodeX)：对齐下一轮企业级合同工作台目标并固化实施计划：以三份真实合同模板生成高保真 Word 初稿为优先，精修页边距、分页、页眉页脚和表格样式；关键条款可编辑、长条款固定；劳务合同下一轮限定主合同、安全协议、农民工工资承诺书、劳务清单；无专用模板的合同类型先走通用 Word 模板，后续上传专用模板后新合同切换使用，历史文件不受影响；线下修改回传先做上传确认的简单版。计划已保存至 `docs/superpowers/plans/2026-06-30-real-contract-word-template-generation.md`。
- 2026-06-30 (CodeX)：继续 Superpowers loop 推进企业级合同工作台。增强 `verify:contract-workbench` live 验收脚本：除材料采购专用模板查询外，新增全量 `/contract-templates` 检查，要求 `material_purchase`、`equipment_rental`、`labor_subcontract` 三类已发布业务模板均可被 API 列出。验证：`contract-workbench-verification.spec.ts`、`node -c prisma/verify-contract-workbench.cjs` 通过。
- 2026-06-30 (CodeX)：继续 Superpowers loop 推进企业级合同工作台。修复新机械/劳务模板 seed 的 DOCX 资产占位符不匹配隐患：新增 `equipment-rental-v1.docx` 与 `labor-subcontract-v1.docx` 极简可渲染模板，seed 脚本改为按各模板 `originalName` 复制资产，并补单测校验 DOCX 内含对应字段、条款和清单循环占位符。验证：API seed data 单测、API typecheck、`pnpm --filter @jiangkong/api seed` 通过。
- 2026-06-30 (CodeX)：继续 Superpowers loop 推进企业级合同工作台。结算审批路线改为优先按 `contractTypeKey` 显式判断：`labor_subcontract`/`professional_subcontract` 走劳务/专业分包路线，`material_purchase`/`equipment_rental` 走材料/机械路线；历史无类型合同仍回退到合同名称/相对方文本推断，避免老数据断流。验证：`settlement.service.spec.ts` 30 个通过，API typecheck 通过。
- 2026-06-30 (CodeX)：继续 Superpowers loop 推进企业级合同工作台。新增 `equipment_rental` 工程机械设备租赁、`labor_subcontract` 劳务分包两个已发布业务模板 seed，覆盖合同类型、专业字段、清单列、付款条款、附件要求、朴素 A4 版式元数据、预览任务和编号规则；seed 脚本由单一材料模板改为循环写入三类模板。当前先复用朴素 DOCX 版式，真实 Word 模板封面/长条款/签署页占位符化留后续精修。验证：API seed data 单测、API typecheck/lint、`node -c services/api/prisma/seed.cjs`、`pnpm --filter @jiangkong/api seed` 通过，数据库已查到三类 published 模板。
- 2026-06-30 (CodeX)：对齐企业级合同工作台需求：所有合同类型均由合同员或合同部主管统一创建草稿并可发起合同审批流；合同员/合同部主管是合同控制人，可录入主要字段、清单、可变条款并下载 Word 初稿线下修订后回传确认，当前阶段不做 Word 反解析覆盖系统结构化数据。实现收紧 `POST /contracts` 为 `contract.create` 权限，`contract.create`/`contract.submit` 均允许 `contract_staff` 与 `contract_director`；新建合同页合同类型改为从已发布业务模板动态加载，不再写死材料采购。同步更新设计文档。
- 2026-06-30 (CodeX)：继续收口 Task22 浏览器评论修复。合同工作台「合作单位」快照表单补充实际收款开户行字段，并明确开户行/开户账号与实际收款开户行/实际收款账号按合同约定选填一组；表单提示说明当前“保存合作单位”仅写入本合同合作单位快照，不会自动进入合作单位档案。资质附件调整为开户许可证无需有效期，法人身份证正反面共用一个有效期，保存时反面附件沿用正面有效期。Browser 验证：开户许可证 0 个有效期输入、身份证卡片 1 个有效期输入，收款信息与快照保存提示可见，控制台无 error/warn。验证：Web test **121/121**、typecheck、lint、`git diff --check` 通过。
- 2026-06-30 (CodeX)：继续收口 Task22 浏览器评论修复。合同工作台「合作单位」分区的资质附件由泛化“添加附件”改为固定三类上传框：营业执照上传、开户许可证上传、法人身份证正反面上传；身份证卡片内拆为正面/反面两个文件入口，并保留各附件有效期字段。Browser 验证：合作单位分区可见 3 个附件卡片、4 个文件输入、4 个有效期输入，控制台无 error/warn；截图复核身份证正反面入口可见。验证：Web test **121/121**、typecheck、lint、`git diff --check` 通过。
- 2026-06-30 (CodeX)：继续推进 Task22 浏览器评论修复。合同工作台「合作单位」分区新增临时合作单位快照录入，支持合同角色、公司名称、纳税人识别号、地址、电话、法人姓名/身份证号、委托代理人姓名/身份证号、开户行、开户账号、收款账号，以及营业执照、开户许可证、法人身份证、授权委托书、资质文件、其他附件上传后引用；保存后调用既有 `POST /contract-workbench/:versionId/parties` 并刷新工作台，已保存快照会回显主要字段和附件名称/有效期。Browser 验证：字段可见，录入并保存临时乙方后公司名、税号、开户行、收款账号可回显，控制台无错误。验证：Web test **121/121**、typecheck、lint 通过。
- 2026-06-30 (CodeX)：推进企业级合同工作台 Phase 1 Task 22「浏览器交互验收」。确认 Codex in-app Browser 可用于本地交互验收，不再依赖系统 Chrome/Crashpad 路径；实测登录、合同列表按钮、进入新建页、选择项目/合同类型/业务模板、创建草稿、进入工作台与工作台分区切换。修复验收发现的“新建合同像没反应”：新建页项目选项为空、合同类型仍用旧 `purchase` 导致无模板、`GET /contract-templates` 未返回发布版本 id、创建草稿后前端误读 `created.id` 跳到 `/contracts/undefined/workbench`、工作台仍读旧字段 `contract.status/version.revision/version.template` 导致新草稿误判只读。验证：Browser 交互无控制台错误，Web test/typecheck/lint 通过，API test/typecheck/lint 通过。Task22 剩余：双标签冲突、Excel UI、文档预览、1440x900/1100x800 响应式仍需完整浏览器验收。
- 2026-06-30 (CodeX)：完成企业级合同工作台 Phase 1 Task 21「端到端核心路径验收」。用户安装 LibreOffice 后，使用 `DOC_CONVERTER_COMMAND=/Applications/LibreOffice.app/Contents/MacOS/soffice` 启动 API 并实跑 `pnpm --filter @jiangkong/api verify:contract-workbench` 通过；live 脚本已覆盖合同员工登录、已发布物资合同模板读取、草稿创建、自动保存、手动检查点、清单行新增、Excel 模板导出/导入/应用、草稿与内部送审文档 DOCX/PDF 生成轮询、审批提交与审计日志。补齐运行中暴露的 JSON-safe BigInt 返回、清单导入必填自定义列、文档模板清单循环占位符校验和 seed DOCX 占位符格式问题。Task22 仍只剩浏览器交互验收受 Chrome/Playwright 控制问题阻塞。
- 2026-06-29 (CodeX)：推进企业级合同工作台 Phase 1 Task 22「浏览器验收与项目进度」。API 与 Web dev server 均可启动：API `Nest application successfully started`，Vite `http://localhost:5173/` ready；活体探针确认 `GET /health` 200、Web `/contracts` 200、合同员工登录 201、`GET /contract-templates?contractTypeKey=material_purchase` 200 且返回 1 个已发布物资合同模板。自动化验证：API 全量测试 **381/381**（43 suites）通过，Web 全量测试 **120/120**（17 files）通过；API lint/typecheck/build、Web typecheck/lint/build 通过（Web build 仅保留 Vite >500k chunk 既有警告）。未完成的 Task22 浏览器交互验收：Playwright 包可用但浏览器未安装，系统 Chrome 在当前沙箱下因 Crashpad/权限 `Operation not permitted` / `SIGABRT` 无法被 Playwright 控制，Computer Use 只能读取现有 Chrome 窗口不能输入导航；因此尚未实际点击验证工作台多主体、Excel UI、文档预览、双标签冲突和 1440x900/1100x800 响应式。6/29 时完整 live 合同工作台验收仍被 LibreOffice runtime 阻塞，见上一条 `liblcms2.2.dylib`；该阻塞已由 2026-06-30 的 Task21 live 验收解除。剩余二阶段/后续：线下磋商差异、OCR 归档、补充协议加强审批、终止清算、电子签章/招投标/银企直联、小程序移动端、生产部署与备份演练。
- 2026-06-29 (CodeX)：推进企业级合同工作台 Phase 1 Task 21「端到端核心路径验收」。新增 `verify:contract-workbench` live 验证脚本与静态覆盖测试，脚本覆盖合同员工登录、读取已发布物资合同模板、创建草稿、保存字段/条款/清单、手动检查点、Excel 模板导出与内存回填上传、导入预览/应用、草稿与内部送审文档生成轮询、readiness 校验、提交审批、版本状态与审计日志核对；同时补 `seed.cjs` 旧合同版本必填 JSON 字段，修复 `AuditService` type-only import 导致 Nest 运行时 DI 失败的问题。验证：API lint/typecheck/build 通过，Task21 spec 2 个通过，`node -c` 通过，`git diff --check` 通过，`pnpm --filter @jiangkong/api seed` 可重放，API 可启动成功。完整 live 验收当前被本机 LibreOffice 运行时依赖阻塞：`soffice --version` 缺少 `/opt/homebrew/opt/little-cms2/lib/liblcms2.2.dylib`；脚本已按计划用精确错误 `DOC_CONVERTER_COMMAND is unavailable; install LibreOffice or set the executable path.` 失败。下一步：修复/安装 LibreOffice 运行时依赖后重跑 `DOC_CONVERTER_COMMAND=<soffice> pnpm --filter @jiangkong/api verify:contract-workbench`，通过后再将 Task 21 勾选完成。
- 2026-06-28 (CodeX)：完成企业级合同工作台 Phase 1 Task 20「合同工作台种子数据与模板样张」。新增稳定、幂等的 `material_purchase` 材料采购业务模板 v1 seed，覆盖 delivery/quality/tax/settlement 字段、材料价格清单与运费清单、付款依据必填规则、已发布标准付款条款、已发布 DOCX 版式版本、preview PDF 元数据与 succeeded preview job、合同编号规则 `HT-{project}-{year}-{type}-{sequence}`。新增朴素 A4 DOCX fixture，包含合同、字段、条款和 `bill.materials` 循环占位符；`seed.cjs` 会把 DOCX asset 与最小 preview PDF 写入 `storage/private/seed/templates/...` 后再 upsert `FileObject`，保证本地 `FileService.getFileBuffer` 可读。验证：API seed data 单测 2 个通过，API typecheck/build 通过。
- 2026-06-28 (CodeX)：修复企业级合同工作台 Phase 1 Task 19 质量复审 UI 闭环缺口。业务模板创建后 Web 会携带后端返回的 `version.id` 跳转编辑页并自动填充当前版本 ID，避免新建后只能外部抓响应；标准条款提交/发布空版本 ID 时禁用按钮并在函数入口 guard，避免请求 `/standard-clause-versions//...`；合同编号规则前端校验补齐必须包含 `{sequence}`，与后端保存规则一致。补模板中心 config 回归测试。
- 2026-06-28 (CodeX)：修复企业级合同工作台 Phase 1 Task 19「标准条款库」发布闭环缺口。后端新增标准条款版本 `draft -> submitted` 提交 service 与 `POST /standard-clause-versions/:versionId/submission`，要求 global `contract_staff` 并记录 `standard_clause.submit_version` 审计；Web API 与标准条款库页面新增“提交版本”动作，文案改为创建草稿 -> 提交 -> 发布，避免草稿直接发布必然失败。补后端 service 与前端 API wrapper 回归测试。
- 2026-06-28 (CodeX)：完成企业级合同工作台 Phase 1 Task 19「模板中心 Web UI」。新增模板中心静态配置与单测，锁定模板列表列/动作、字段类型白名单、数量/单价精度、published 版本不可直接编辑、版式发布 inspection+preview PDF gate、合作单位变更新建版本、编号规则占位符白名单；补业务模板/版式/标准条款/合作单位/编号规则 API wrappers 与测试。Web 新增业务模板列表与编辑器、版式编辑器、标准条款库、编号规则维护、合作单位档案列表与详情新版本页，并挂载计划内路由和侧边栏“合作单位档案”。验证：`web-admin` 指定测试 **120** 个通过，typecheck/lint/build 通过（build 仅保留 Vite 大 chunk 既有提示）。
- 2026-06-28 (CodeX)：修复 Task 18 质量复审指出的两个 Important 问题。清单 Excel 导入预览现在在 `ContractBillImport.preview` 中记录生成时的 bill revision，应用导入时若当前 bill revision 已变化则拒绝并要求重新预览，避免应用与对话框不一致的导入结果；补 API 回归单测覆盖 stale preview apply。文档区 `hasActiveDocument` watcher 改为 immediate，初始已有 queued/processing 文档时会立即启动轮询。验证：`@jiangkong/api` 的 `contract-bill-excel.service.spec.ts` 9 个通过，API typecheck 通过；`@jiangkong/web-admin` typecheck/lint 通过。
- 2026-06-27 (CodeX)：修复企业级合同工作台 Phase 1 Task 18 规格审查缺口。`GET /standard-clauses` 现在返回每个标准条款最新已发布版本的正文、版本号与主表元数据；工作台条款区用真实 `standardClauseVersionId` 插入返回正文，并在内容快照中保留标准正文、来源名和版本号，badge 显示来源 + vN，编辑后可可靠触发“已偏离标准条款”；清单 Excel 导入预览改为 `t-dialog`，展示 counts、errors 与 changed rows，存在错误时禁用应用且不覆盖当前 rows。补后端 service spec、前端 API/helper 测试。验证：API 目标单测 **13** 个通过；web-admin 指定测试 **106** 个通过，API typecheck 通过，web-admin typecheck/lint/build 通过（本机需先执行 `pnpm --filter @jiangkong/api exec prisma generate` 以刷新 Prisma Client）。
- 2026-06-27 (CodeX)：收口企业级合同工作台 Phase 1 Task 18 剩余前端缺口。条款区改为受约束 JSON 内容模型（段落/加粗/斜体/列表/小表格，保留 `content.text` 兼容 DOCX 渲染），显示必填、标准条款来源、偏离标准条款与条款级 readiness；接入现有 `GET /standard-clauses` 做标准条款来源插入，若接口未返回正文则只记录来源并提示人工维护。文档区修正版式版本 id 选择，展示版式预览 PDF/可用缩略图字段，支持附件上传与已选附件传入生成队列，文档用途改为分段按钮，展示生成 warning。清单区补合计 footer 与导入错误保留当前 rows 的明确提示。补 API client 与纯函数测试。验证：`web-admin` 指定测试 **105** 个通过，typecheck/lint/build 通过。已知关注：标准条款库接口当前只返回主表，不带已发布版本正文/版本号详情，完整“一键插入正文”需要后端读模型增强。
- 2026-06-27 (CodeX)：推进企业级合同工作台 Phase 1 Task 18 的前端基础分区。工作台新增「合同清单 / 合同条款 / 合同文档」导航与页面分区；清单区接入已有后端 API，支持按清单切换、行内编辑、新增、复制、删除、上下移动、Excel 模板下载、xlsx 上传预览与无错误应用；条款区编辑当前 clause snapshot 并沿用自动保存；文档区接入已发布版式选择、草稿/磋商/内部送审用途、生成队列、2 秒轮询、stale 标记、失败重试、DOCX/PDF 私有下载票据。补 `deleteBillRow` / `reorderBillRows` / `retryContractDocument` API client 与 6 条清单行为测试。验证：`web-admin` 测试 **101** 个通过，typecheck/lint/build 通过。未做：标准条款库插入、富文本小表格编辑、版式缩略图/附件选择的完整体验，留在 Task 18 后续收口。
- 2026-06-27 (CodeX)：接手并核对 Claude Code 上下文。用户提供的 Claude data 导出中 `conversations.json` 为空；从 `.claude/worktrees/claude+contract-workbench-phase1` 找到未合入当前 `main` 的合同工作台分支并 fast-forward 合入至 `fd46ecf`。确认 Task 17「工作台外壳与自动保存状态」已由 Web 工作台页面、分区组件、`useContractDraft` 自动保存/冲突状态、readiness panel、类型变更迁移预览等提交完成；补齐进度记录。验证：`web-admin` 工作台/API/路由相关测试 **92** 个通过，`web-admin` typecheck/lint 通过。下一项为 Task 18–22「清单/条款/文档分区、模板中心、种子与端到端验收」。
- 2026-06-25 (CodeX)：完成企业级合同工作台 Phase 1 Task 14「持久化文档任务与轮询处理器」。新增文档排队/列表/重试 API、数据库幂等键、版式预览优先的单进程轮询 worker、DOCX→PDF→附件归一化→私有文件上传全链路、失败截断与超时 processing 回收、终态 CAS 与审计。所有影响渲染输入的草稿、清单、Excel 导入、合同方快照变更统一提升 `draftRevision` 并将旧成功文档标为 stale；成功落库前锁定合同版本，retry 重新校验 owner、状态、版式、合同类型、readiness 与附件权限。相关文档链路/工作台/清单/文件 **121** 个回归测试 + API typecheck/lint 全绿；下一项为 Task 15「提交就绪校验与审批冻结」。
- 2026-06-25 (CodeX)：完成企业级合同工作台 Phase 1 Task 13「PDF 转换与附件 A4 归一化」。LibreOffice 转换使用参数化 `execFile`、每任务独立 profile、120 秒超时、Linux 字体可用性检查和全路径临时文件清理；PDF-Lib 归一化支持 A4 横竖版保留、非 A4/CropBox/90°与270°旋转页面等比居中、PNG/JPEG 附件合并，并限制总输入 100MiB、500 页、图片 100MP。相关 **20** 个测试 + API typecheck/lint 全绿；下一项为 Task 14「持久化文档任务与轮询处理器」。
- 2026-06-25 (CodeX)：完成企业级合同工作台 Phase 1 Task 12「DOCX 渲染」。新增纯函数式 PizZip + Docxtemplater renderer，支持合同/动态字段/条款/多方主体平铺占位符、结构化清单循环、草稿/磋商稿水印、确定性金额格式与中文大写金额；保留上传模板的页边距、页眉页脚、表格样式和签章页。必填占位符缺失或空白会明确拒绝，可选空值保持空串；修复跨亿/兆连续空组中文金额漏“零”。相关 **24** 个测试 + API typecheck/lint 全绿；下一项为 Task 13「DOCX→PDF 转换与附件 A4 归一化」。
- 2026-06-25 (CodeX)：完成企业级合同工作台 Phase 1 Task 9「草稿生命周期」。新增工作台列表/详情、owner 自动保存、`draftRevision` 乐观并发、完整 checkpoint 快照与最多 5 份保留、checkpoint 恢复、软作废/恢复、合同主管转交、合同类型变更预览/应用及移除数据审计。所有草稿写入 CAS 同时绑定可编辑状态，作废/恢复/转交使用 Serializable 事务和版本状态门禁；合同提交审批补 draft CAS、owner/作废校验，关闭送审与草稿修改竞态。API 返回统一转为 JSON-safe 金额 read model，类型变更会重算 `bill_sum`。相关 **51** 个测试 + API typecheck/lint 全绿；下一项为 Task 10「结构化合同清单行 CRUD 与汇总」。
- 2026-06-24 (CodeX + Claude)：企业级合同工作台第一阶段实施推进至 Task 6。已完成文档/表格依赖与环境配置、Phase 1 Prisma 模型与迁移、共享工作台 schema/read model、BigInt + Prisma.Decimal 金额边界、版本化业务模板/标准条款 API，以及 DOCX 版式模板治理（私有 DOCX 归属校验、声明扩展名/100MiB 上传限制、跨 Word 文本节点的占位符/字体/清单循环检查、解压大小防护、预览任务、提交/发布/停用/撤销状态 CAS、岗位权限与审计）。Task 6 相关 **36** 个测试 + API typecheck/lint 全绿；下一项为 Task 7「合作单位版本与合同多方快照」。
- 2026-06-24 (CodeX)：完成企业级合同工作台第一阶段实施计划 `docs/superpowers/plans/2026-06-24-enterprise-contract-workbench-phase1.md`，按数据与领域基础、模板中心、合作单位与多主体快照、草稿工作台与多清单、DOCX/PDF生成、Web工作台与模板中心、端到端验收拆为22个可独立测试和提交的任务。计划明确复用现有审批/文件/审计能力，新增 `exceljs + docxtemplater + pizzip + pdf-lib`，采用数据库持久化任务和单进程文档处理器，不提前实现第二阶段磋商差异/OCR归档及第三、四阶段业务。
- 2026-06-24 (CodeX)：完成企业级合同工作台第一版需求设计并经用户逐章确认，规格落在 `docs/superpowers/specs/2026-06-24-enterprise-contract-workbench-design.md`。确定采用“固定业务核心 + 版本化动态模板”混合架构，范围覆盖专业合同台账、单负责人合同工作台、5个草稿版本、多主体、多清单Excel导入及网页编辑、标准条款库、DOCX/PDF自动排版、可选线下磋商及DOCX差异、审批退回差异、线下签章/OCR归档、补充协议10%加强审批、终止清算、结算/质保金/付款/发票、人工网银批量付款、历史补录、电子档案包、待办、权限与审计；明确四阶段交付顺序及实物档案、电子签章、招投标、银企直联等待做边界。本次仅完成设计，无实现代码。
- 2026-06-24 (Claude)：补齐审批单三项增强——手写签名、公司主体抬头、下载水印。①**我方公司主体**：新增 `CompanyEntity` 字典表（`name`/`unifiedSocialCreditCode`/`isActive`）+ `GET/POST /company-entities`；`Contract` 加 `companyEntityId`/`companyEntityName`，建单时选主体并**快照名称**（字典改名不影响历史）；审批单抬头按业务回溯合同取该快照名。②**手写签名**：`User.signatureFileId`，`POST /me/signature`（仅收 image/* 且 PNG/JPEG 魔数）+ `GET /me/signature/ticket` 预览；`ApprovalFormService` 渲染时按签批人 `User.signatureFileId` 经 `FileService.getFileBuffer` 取图嵌入新增「签名」列（魔数预筛，损坏图退化空白不阻断；发现并修复了损坏 PNG 触发 pdfkit 解码自旋 6.7s+ 的隐患）。③**下载水印**：审批单下载改为 `GET /approval-forms/:bt/:bid/download`（鉴权直取、blob 下载），按「公司名·下载人·时间」对角平铺**动态生成水印**，归档母本仍无水印、复用其做权限锚点与幂等；记 `approval.form.download` 审计。渲染管线重构出 `buildRenderInput` 供生成/下载共用，`drawTable` 支持图片列/最小行高/分页，水印用 `bufferPages` 逐页叠加。Web：合同建单加「我方主体」下拉、新增「设置」页（签名上传预览 + 公司主体字典维护）、三详情页下载改 blob。COS 私有桶此前已接入故未重做。验证：API **190** 单测（28 套）+ web-admin **61** + 两包 typecheck/lint/build 全绿；本机 Docker PG 实跑 `verify-core-flow` 通过，活体测试公司主体增列、签名上传（含非图片拒绝）、已审批付款单按下载人下载得带水印中文 PDF（HTTP 200、`approval.form.download` 审计落库、签名上传后 PDF 体积增长）。未做：用户上传原件水印、公司 Logo（按你的选择）。
- 2026-06-24 (Claude)：升级审批单 PDF 为企业级表格式版式（A4）。`ApprovalFormService.renderPdf` 由原先的居中标题+三段纯文本列表改为带框线表格：① 业务信息栏（label|value 两列），除单号/申请人/生成时间外按业务类型新增「业务摘要」——付款（申请金额/批准金额/收款方/对应结算/付款期限）、结算（结算期次/结算金额/应付金额/对应合同/对方单位）、合同（合同名称/对方单位/合同金额/版本号），金额由分→「1,234.56 元」千分位格式化，不依赖运行环境 locale；② 审批路线表（序号/审批节点/签批方式/审批角色）；③ 签批记录表（序号/审批人/职位/动作/签批时间/审批意见，长意见自动换行、跨页自动续表）。新增 `drawTable` 通用表格渲染（自动行高/换行/分页）与 `resolveBusinessSummary`（按业务类型多查一层业务表）。抬头按需求暂不加公司名/Logo。验证：API **185** 单测全绿、typecheck 通过，渲染样张人工核对版式（业务信息栏+两张表+换行/职位列均正确）。
- 2026-06-24 (Claude)：新增「审批单 PDF 自动生成」。合同/结算/付款审批通过（`ApprovalInstance` 置 `approved`）后，各 `reviewApproval` 事务提交外 best-effort 调用新 `ApprovalFormService.generateForInstance`，用 `pdfkit` + 仓库内嵌 `assets/fonts/NotoSansSC-Regular.otf`（中文子集内嵌）渲染企业级审批单：抬头（单号/申请人/生成时间）+ 审批路线（取 `frozenNodes`，节点名/会签或签/审批角色中文）+ 签批记录（取 `ApprovalActionLog`，逐行审批人姓名、职位、动作、签批时间、备注）；走现有 `FileService` 上传私有文件 + 写 `PdfDocument(templateKey="approval_form")` + 审计，幂等。备注「附言」经三条审批 DTO 新增的 `comment` 采集落 `ApprovalActionLog.comment`（此前该字段全库零写入）。新 `GET /approval-forms/:businessType/:businessId/ticket`（仅登录，惰性补生成）返回短链；`FileService.assertCanDownloadFile` 放行申请人/任一签批人/项目归档可读岗位。Web 三详情页加“审批意见/备注”输入与“下载审批单”按钮。验证：API **185** 单测 + web-admin **61** + 两包 typecheck/lint 全绿；本机 Docker PG 实跑 `verify-core-flow` 全流程，三类 `approval_form` PDF 均落库，登录→ticket→下载 HTTP 200 且中文渲染正确（含职位“（董事长）”解析）。未做：手写签名图、COS、用户上传原件水印。
- 2026-06-24 (CodeX)：补齐 Web 台账页可见按钮行为，消除“点了没反应”。结算台账新增最小新建结算表单并调用 `POST /settlements`；付款台账新增最小新建付款申请表单并调用 `POST /payments`；资料库“上传资料”接入私有文件上传；合同/结算/付款/资料/审计列表页的查询、重置、查看、导出等暂未接完整后端列表/导出能力的入口改为明确页面提示。静态扫描确认页面 `<t-button>` / `<t-link>` 无空挂入口；`web-admin` test/typecheck/lint/build 通过；本地通过 `/api/settlements` 冒烟创建 `JS-UI-005255`，通过 `/api/payments` 冒烟创建付款申请 `FK-UI-005920`。
- 2026-06-24 (CodeX)：修复 Web 合同台账“新建合同”按钮无效果。列表页新增最小合同草稿表单，提交 `POST /contracts` 创建合同、v1 合同版本和付款条款版本，成功后跳转新合同详情；API client 新增 `createContractDraft` 并补单测。`web-admin` test/typecheck/lint/build 通过；本地通过 `/api/contracts` 冒烟创建草稿合同 `HT-UI-004407`。
- 2026-06-24 (CodeX)：补 Web 写操作入口最小闭环。合同详情页接入提交审批、审批通过/驳回、撤回、催办、转审、委托、用章通过、归档上传/确认、后端生成 PDF、敏感文件下载签票；结算详情页接入审批通过/驳回/退回上级/打回发起人、撤回、催办、转审、委托、归档上传/确认、后端生成 PDF、敏感文件下载签票；付款详情页补凭证直接上传、后端生成 PDF、撤回、催办、转审、委托、敏感文件下载签票。前端仍只做入口和必填校验，权限/状态以后台为准。`web-admin` test/typecheck/lint/build 通过；本地 Vite 已启动 `http://127.0.0.1:5173/`。
- 2026-06-24 (CodeX)：同步 Obsidian 状态页。按当前 `PROGRESS.md` 更新 `obsidian-current` 中总览、上线就绪度、待改功能、权限系统 4 个笔记，修正“早期骨架”旧表述，标明后端核心闭环、认证授权、审批委托、私有文件/COS、PDF 水印、敏感二次确认等已完成项，以及小程序、生产部署、原始上传件水印、合同/付款退回能力等剩余缺口；已复制到 iCloud Obsidian vault。
- 2026-06-24 (CodeX)：补 COS 私有桶最小接入。`PrivateFileStorage` 支持 `FILE_STORAGE_DRIVER=cos` 时用 Node 内置 `fetch`/`crypto` 直连腾讯云 COS XML API 做私有对象 PUT/GET，文件仍只经后端鉴权 + 短时效业务下载票据访问，前端不直连 COS；`FileObject.bucket` 记录实际 COS bucket。`.env.example` 新增 `FILE_STORAGE_DRIVER=local` 默认值。新增 COS 存储单测，API file service 单测 + typecheck/lint 通过。暂未做 SDK/multipart/断点续传，也未改成返回 COS 直签下载 URL（当前仍由后端流式下载）。
- 2026-06-23 (CodeX)：补后端生成 PDF 水印最小闭环。三类归档 PDF 共用的 `renderSimplePdf` 现在默认写入 `JIANGKONG CONFIDENTIAL` 斜向浅灰水印，覆盖付款/合同/结算后端生成 PDF；新增 helper 单测防止水印回退，三类 PDF 生成相关 service 单测通过。暂未处理用户上传的原始归档件水印，也未接 COS 私有桶。
- 2026-06-23 (CodeX)：补文件下载二次确认最小闭环。`/files/:fileId/download-ticket` 从 GET 改为 POST，并在签发短时效下载票据前要求 `confirmationPassword`，后端复用 `AuthService.confirmPassword`；密码缺失/错误时不生成票据、不写签票审计。Web API client 同步改为 `createPrivateFileDownloadTicket(fileId, { confirmationPassword })`。API 文件相关单测 + web-admin API client 单测 + 两包 typecheck/lint 通过。暂未做页面下载入口弹窗（当前无调用点）、COS 私有桶、文件水印。
- 2026-06-23 (CodeX)：补合同/结算 PDF 生成归档最小闭环。抽出轻量 `renderSimplePdf` 复用付款 PDF buffer 生成逻辑；新增 `POST /contracts/:contractVersionId/pdf-generation`（权限沿用 `contract.archive.upload`，仅 effective 合同版本可生成）与 `POST /settlements/:settlementId/pdf-generation`（权限沿用 `settlement.archive.upload`，effective/partially_paid/paid 结算可生成），均走现有私有文件上传链路创建 `FileObject`，再写 `PdfDocument` + `ArchiveRecord` + 审计。Web API client 补 `generateContractPdfArchive` / `generateSettlementPdfArchive`。API 全量 174 个单测 + web-admin 59 个 + 两包 typecheck/lint 通过。暂未做 COS 私有桶、文件水印、文件下载二次确认。
- 2026-06-23 (Claude)：常驻委托台账闭环（消除“写了没人读”的死数据）。`ApprovalDelegation` 此前 3 处 `delegate` 写入但全库零读取，现在真正被消费：新增 `ApprovalDelegationService`（create/listForUser/revoke + `activeDelegatorIds(tx,toUserId,now)`）与登录态 `POST/GET/DELETE /approval-delegations`（任何登录用户管理自己的委托，无 `@RequireProjectRole`；创建/撤销写审计 `approval.delegation.{create,revoke}`）。合同/结算/付款 review 在本人岗位 + 节点指派都不命中时，回退到“窗口内的委托人是否持有该节点角色”——**全流程通用**（含合同/付款的董事长/总经理 OR-sign 终审）。Web 端补委托台账管理页（/delegations，列表+创建+撤销）、API client 3 个调用 + `deleteJson`。API 168 个单测（含 ApprovalDelegationService 7 + 三处消费/拒绝 4）+ web-admin 59 + 全量 typecheck/lint 通过；本机实跑 verify-core-flow 全绿、委托端点 curl 冒烟通过。
- 2026-06-23 (Claude)：把敏感操作二次确认扩展到归档确认（合同 + 结算）。合同/结算 `archive-confirmation` 现在需要 `confirmationPassword`，后端复用 `AuthService.confirmPassword`（与付款实付一致），密码缺失/错误时不开事务、不让版本/结算生效。两类 service 注入可选 `AuthService`，模块各 import `AuthModule`；Web 归档确认表单补当前密码输入；`verify-core-flow.cjs` 两处归档确认带 seed 密码继续实跑通过。API 153 个单测（含 +4 归档确认二次确认）+ web-admin 58 + 全量 typecheck/lint 通过。
- 2026-06-23 (CodeX)：补资金出账登记二次确认最小闭环。`POST /payments/:paymentId/executions` 的 DTO 新增 `confirmationPassword`，后端在实际付款登记前复验当前登录用户密码，密码缺失/错误时不查询付款单、不写 `PaymentExecution`；Web 付款详情页的“出纳实付”补当前登录密码输入；`verify-core-flow.cjs` 带 seed 密码继续实跑。API 149 个单测 + web-admin 58 + 全量 typecheck/lint 通过。暂未覆盖归档确认、文件下载等其他敏感动作，也未做确认票据/短时效二次确认 token。
- 2026-06-23 (CodeX)：补付款财务归档 PDF 最小生成闭环。新增 `POST /payments/:paymentId/pdf-generation`（权限同 `payment.pdf_archive`）：校验付款已实际支付且财务记录覆盖已付金额、同模板未归档后，后端生成合法 PDF buffer，走现有私有文件上传链路创建 `FileObject`，再复用 `PdfDocument` + `ArchiveRecord` 归档与审计。Web API client 补 `generatePaymentPdfArchive`。暂未做合同/结算 PDF 模板、水印、COS 私有桶。API 145 个单测 + web-admin 58 + 全量 typecheck/lint 通过。
- 2026-06-23 (CodeX)：把转审 / 委托扩展到合同与付款审批实例，并接入委托台账。合同与付款新增 `POST /contracts/:contractVersionId/approval-transfer`、`/approval-delegation`、`POST /payments/:paymentId/approval-transfer`、`/approval-delegation`；当前节点合法审批人可写入冻结节点 assignment，目标用户可按来源岗位完成审批。结算/合同/付款三类 `delegate` 动作都会追加 `ApprovalDelegation` 台账行（当前节点委托先用 30 天临时窗口；尚未做全局委托管理界面和自动生效消费）。Web API client 补合同/付款转审委托调用。API 142 个单测 + web-admin 58 + 全量 typecheck/lint 通过。
- 2026-06-23 (CodeX)：补文件下载权限校验 + 短时效 URL 最小闭环。`GET /files/:fileId/download-ticket` 改为只信登录态 `@CurrentUser`，不再接收 query/body 里的 `actorUserId`；签票前校验文件访问权（上传者本人、合同/结算归档文件的合同部/财务岗、付款凭证的财务岗），短链 token 绑定 `fileId + actorUserId + expiresAt`；公开下载端点继续只认短时效票据，但下载成功新增 `file.download` 审计；本地私有存储路径校验收紧，避免同前缀目录误放行。Web API client 补 `createPrivateFileDownloadTicket`。API 132 个单测 + web-admin 58 + 全量 typecheck/lint 通过。
- 2026-06-23 (Claude)：把催办/撤回扩展到合同与付款审批实例。合同：申请人可在 `in_approval` 撤回 → 版本退回 `draft`（同一版本可改可重提，不新建版本）、可对超时实例催办；端点 `POST /contracts/:contractVersionId/approval-withdrawal`、`/approval-reminder`。付款：付款申请无草稿态，撤回为终态 `withdrawn`（重试须新建申请）、可催办；端点 `POST /payments/:paymentId/approval-withdrawal`、`/approval-reminder`。撤回/催办均只要求登录，申请人校验在 service；催办复用 shared-domain `canRemindApproval`（不改写实例）。三处控制器加申请人专属端点的授权契约断言（无 `@RequireProjectRole`）。Web API client 补 4 个调用。API 127 个单测（含 +12 service、+5 控制器契约）+ web-admin 57 + 全量 typecheck/lint 通过。
- 2026-06-23 (Claude)：登录页移除硬编码种子凭据（手机号/密码默认空串），避免把全员通用种子密码打进前端 bundle。
- 2026-06-23 (Claude)：补超时催办（timeout reminder）最小实例模型。shared-domain 新增 `remind` 动作 + 纯逻辑（SLA 超时判定 `isApprovalOverdue`、重复催办节流 `canRemindApproval`，默认 48h SLA / 24h 间隔）；结算审批新增 `remindApproval`：申请人对进行中且超时的实例催办，仅记 `ApprovalActionLog(remind)` + 审计（不改写实例，故 `updatedAt` 仍代表上次真实动作，超时判据稳定），非申请人/未超时/节流内拒绝；控制器 `POST /settlements/:id/approval-reminder`、Web API client `remindSettlementApproval`。shared-domain 34 + API 110（含 3 条催办单测）+ web-admin 57 单测、全量 typecheck/lint 通过。
- 2026-06-23 (CodeX)：补转审 / 委托代理的结算审批最小实例模型。当前节点合法审批人可对当前冻结节点写入 `transfer` / `delegate` assignment，目标用户可按来源岗位完成该节点审批；动作写 `ApprovalActionLog` 与审计日志。Web API client 补转审/委托调用；API 107 个单测 + 全量 test/typecheck/lint 通过。
- 2026-06-23 (CodeX)：补齐结算审批申请人撤回最小闭环。新增结算 `withdrawn` 状态；申请人可在审批完成前通过独立接口撤回进行中的结算审批实例，系统关闭 ApprovalInstance、写入 `ApprovalActionLog` 与审计日志；非申请人或已离开审批中状态不可撤回。Web API client 补撤回调用；shared-domain / API / web-admin 相关单测 + 全量 test/typecheck/lint 通过。
- 2026-06-23 (CodeX)：结算审批实例支持 `reject_previous` / `return_to_applicant` 最小闭环。当前节点审批人可退回上一冻结节点，系统清空上一节点和当前节点的已批角色并保持 `approval_pending`；首节点禁止退回上一节点；可打回申请人并关闭实例为 `returned_to_applicant`，结算置为 `approval_rejected`。补充 ApprovalActionLog 与审计元数据；API 98 个单测 + typecheck + lint 通过。
- 2026-06-23 (CodeX)：合同/付款终审 OR-sign 接入 ApprovalInstance。合同提交审批时冻结 `contract.approve` 董事长/总经理或签节点；付款申请创建时冻结 `payment.approve` 董事长/总经理或签节点；审批通过/驳回均推进或关闭实例并写 `ApprovalActionLog`，审计元数据带节点和角色。API 95 个单测 + typecheck + lint 通过。
- 2026-06-23 (CodeX)：落地结算审批最小引擎闭环。创建结算时按合同名称/相对方冻结 `settlement.approve` 节点：物资/机械类走物资员 → 物资主管 → 合同部主管+预算部主管会签 → 项目经理 → 财务总监；劳务/专业分包类走工长 → 项目总工 → 工程技术部 → 合同部主管+预算部主管会签 → 项目经理 → 财务总监。审批接口按当前冻结节点校验岗位、记录 ApprovalActionLog、支持会签节点逐人推进；`verify-core-flow.cjs` 已改为完整材料类结算审批序列。API 93 个单测 + typecheck + lint 通过。
- 2026-06-23 (CodeX)：完成 Web 管理端登录页与前端鉴权态。新增 Pinia auth store、统一 `apiFetch` Bearer 注入、401 自动 refresh 后重试/失效跳登录、`/login` 公开路由与业务页守卫；写操作 payload 移除旧 `*UserId` 表单字段，操作人统一来自 access token。`web-admin` 57 个单测 + typecheck 通过。
- 2026-06-23 (Claude)：业务写端点全部挂上鉴权。新增 `@CurrentUser()` 取登录态操作人；合同/结算/付款/文件控制器去掉 `@Public()`，12 个受守写动作各挂 `@RequireProjectRole(<action>)`；DTO 删除 `*ByUserId`，service 改为显式 `actorUserId` 参数；文件下载（票据鉴权）保留 `@Public`。`verify-core-flow.cjs` 改为多身份登录 + Bearer，并新增两条安全回归（未登录写 401、错误岗位用章 403）。本机 Docker PG + API 实跑 `verify:core-flow` 全绿；89 个单测 + typecheck + eslint 通过。
- 2026-06-23 (CodeX)：完成 services/api 认证管道：User 密码字段 + RefreshToken migration、17 岗位 seed、手机号密码登录/refresh/logout/改密/微信登录、全局 JwtAuthGuard 与 PermissionGuard（暂未挂业务端点）。
- 2026-06-22 (Claude)：认证授权设计方案 `docs/design/建工智管_认证授权设计.md`；权限核心 `packages/shared-domain/src/permissions.ts`（动作→岗位策略表、或签语义、有效岗位合并）+ 单元测试，已接入导出。
- 2026-06-22 (CodeX)：本机 Docker PostgreSQL + API 实跑 `verify:core-flow` 通过，Milestone 1 收口。
- 2026-06-22 (Claude)：新增 CLAUDE.md、PROGRESS.md，建立双 AI 协同流程。
- **下一步**：继续收尾：如需更强文件能力，再补 COS multipart/直签下载、用户上传原始归档件水印；或转 Milestone 7 小程序移动端。

---

## 企业级合同工作台第一阶段（22 Tasks）

- 2026-07-01 (CodeX)：完成 Phase 1 最终人工版式 spot-check。材料采购 live 生成版为 A4 23 页，签章页买卖双方字段已绑定；机械租赁 live 生成版为 A4 25 页，证照附件页居中适配；劳务分包 live 生成版为 A4 19 页，首页工程名称/发包人及末页劳务清单均已渲染；通用合同 live 生成版为 A4 1 页，可作为无专用模板类型的兜底 Word 初稿。四类合同均已由 `verify:contract-workbench` live 创建草稿并生成 DOCX/PDF。
- [x] Task 1：文档与表格依赖、转换器和上传限制环境配置
- [x] Task 2：Phase 1 Prisma 模型与迁移
- [x] Task 3：共享工作台 schema 与 read models
- [x] Task 4：Prisma.Decimal 金额计算与 BigInt 兼容
- [x] Task 5：版本化业务模板与标准条款 API
- [x] Task 6：DOCX 版式模板检查、预览与发布治理
- [x] Task 7：合作单位版本与合同多方快照
- [x] Task 8：合同草稿创建端点（工作台草稿创建替换最小建单）
- [x] Task 9：草稿自动保存/检查点/作废恢复/乐观并发
- [x] Task 10：结构化合同清单行 CRUD 与汇总
- [x] Task 11：Excel 模板下载与导入预览/应用
- [x] Task 12：DOCX 渲染
- [x] Task 13：PDF 转换与附件 A4 归一化（图片附件已追加进 DOCX 初稿并随 DOCX 转 PDF；普通图片 A4 居中，身份证人像面/国徽面同页上下居中）
- [x] Task 14：持久化文档任务与轮询处理器
- [x] Task 15：提交就绪校验与审批冻结
- [x] Task 16：工作台 API 客户端与路由
- [x] Task 17：工作台外壳与自动保存状态
- [x] Task 18：清单/条款/文档分区（规格审查缺口已修：标准条款最新已发布版本正文插入、来源版本 badge、偏离判断、清单导入预览对话框；质量复审缺陷已修：导入应用校验预览时 bill revision、初始活跃文档立即轮询）
- [x] Task 19：模板中心 Web UI（业务模板、版式模板、标准条款、合作单位档案、编号规则最小管理页；后端缺少版本 read model 的区域已做诚实空态/版本 ID 输入）
- [x] Task 20：合同工作台种子数据与模板样张
- [x] Task 21：端到端核心路径验收（验证脚本、静态测试、seed 重放、API 启动与 LibreOffice live 验收均已完成；使用 `/Applications/LibreOffice.app/Contents/MacOS/soffice` 实跑 `verify:contract-workbench` 通过）
- [x] Task 22：Phase 1 收口与移交（Web 管理端 + 后端合同工作台核心闭环已完成：API/Web 基础验证、目标测试、迁移、seed、四类合同 live DOCX/PDF 生成、人工版式抽查、审批打回控制与进度文档均已收口；生产部署、小程序移动端和更完整浏览器响应式矩阵留后续阶段）

---

## Milestone 1：本地可运行业务闭环

- [x] Monorepo + GitHub 远端 (origin: 1131096740/intelligent-construction-management)
- [x] Prisma schema（27 个模型）
- [x] 数据库 migrations（6 个）
- [x] seed 核心链路数据 (`prisma/seed.cjs`)
- [x] 核心读 API：合同 / 结算 / 付款 详情
- [x] 闭环验证脚本 `verify-core-flow.cjs`（覆盖合同→结算→付款全链路 + 审计核对）
- [x] **在本机数据库实跑 `verify:core-flow` 通过**

## Milestone 2：合同状态机（API 层已成型，无权限校验）

- [x] 合同草稿创建（同时建版本 v1 + 付款条款 v1）
- [x] 提交审批 → 审批通过 → 用章 → 上传归档件 → 归档确认 → 生效
- [x] 节点操作的"谁能做"权限校验（写端点挂 `@RequireProjectRole` + PermissionGuard，操作人取登录态）

## Milestone 3：结算状态机（API 层已成型）

- [x] 仅允许从 effective 合同版本创建结算
- [x] 结算审批 → 上传归档件 → 归档确认 → 生效
- [x] 结算绑定原合同版本 + 付款条款版本

## Milestone 4：付款审批与实际付款（API 层已成型）

- [x] 从生效结算创建付款申请
- [x] 后端事务校验剩余可付额度（分为单位整数）
- [x] 付款审批通过 → `approved_pending_payment`
- [x] 出纳实际付款登记 + 凭证文件
- [x] 财务流水记录
- [x] 付款 PDF 留档记录 + 最终状态 `paid`
- [x] 支持同一结算多付款申请 / 同一申请多次执行

## Milestone 5：审批引擎完善

- [x] 审批动作 / 节点模式 共享定义 (shared-domain)
- [~] 审批节点冻结服务 (`approval-freeze.service`)
- [x] 会签 / 或签 流转（结算审批支持冻结节点会签；合同/付款终审 OR-sign 已接 ApprovalInstance）
- [~] 条件节点（结算审批已按合同名称/相对方推断物资机械 vs 劳务专业分包路线；缺显式合同类型字段）
- [x] 驳回上一节点 / 打回申请人 / 撤回（撤回已覆盖结算/合同/付款三类审批：合同撤回退回 draft、付款撤回为终态 withdrawn；退回上一节点/打回申请人已覆盖结算/合同/付款，打回申请人退回业务草稿态并关闭审批实例）
- [x] 转审 / 委托代理（结算/合同/付款审批当前节点均支持转审/委托 assignment；常驻委托台账 `ApprovalDelegation` 已闭环：管理 API `/approval-delegations` + Web 管理页 + review 自动套用全流程通用；节点级委托写台账时仍带 30 天临时窗口，可由管理页自定义窗口替代）
- [x] 超时催办（结算/合同/付款三类审批均支持：SLA 超时判定 + 重复节流 + ApprovalActionLog/审计；申请人发起，`POST /{settlements|contracts|payments}/:id/approval-reminder`）

## Milestone 6：文件、PDF、审计、安全

- [x] 审计日志已接入核心动作（合同/结算/付款共 12 类动作）
- [x] 私有文件上传流程（本地存储 + `FILE_STORAGE_DRIVER=cos` 私有 COS PUT）
- [x] 文件下载权限校验 + 短时效 URL（后端鉴权短链 + 下载审计；本地/COS 均经后端流式下载）
- [x] 真正生成 PDF（付款财务归档、合同归档、结算归档 PDF 均已由后端生成并归档）
- [x] 审批单 PDF 自动生成（合同/结算/付款审批通过即生成，pdfkit + 内嵌 Noto Sans SC 中文字体；**A4 企业级表格式版式**：公司主体抬头 + 业务信息栏含按业务类型的金额/对方/事由摘要 + 审批路线表 + 签批记录表，逐行含审批人姓名/职位/动作/签批时间/审批意见/**手写签名图**，长意见自动换行/跨页续表，备注经各审批 DTO 的 `comment` 采集落 `ApprovalActionLog.comment`；下载经 `GET /approval-forms/:businessType/:businessId/download`（鉴权直取，**按下载人动态生成水印**），权限放行申请人/签批人/归档可读岗位；Web 三详情页加审批意见输入 + 下载审批单按钮）
- [x] 我方公司主体字典（`CompanyEntity` 表 + `GET/POST /company-entities`；合同创建时选择并快照 `companyEntityName` 到合同，结算/付款审批单抬头经合同回溯取该快照；Web 合同建单加「我方主体」下拉、设置页加字典维护）
- [x] 个人手写签名预上传（`User.signatureFileId`；`POST /me/signature` 仅收 PNG/JPEG 魔数校验，`GET /me/signature/ticket` 预览；审批单按签批人复用嵌入；Web 设置页上传/预览）
- [x] 审批单 PDF 下载水印（下载时按「公司名 · 下载人 · 时间」对角平铺动态生成，可追溯防泄露；`approval.form.download` 审计；归档存档件保持无水印母本）
- [~] 文件水印 / 敏感操作二次确认（实际付款登记、合同/结算归档确认、文件下载票据签发已要求当前密码二次确认；系统生成 PDF + 审批单下载均带水印，用户上传原始归档件水印按需求暂不覆盖）

## 认证与授权（上线头号短板）

- [x] 设计方案 `docs/design/建工智管_认证授权设计.md`（登录方式：Web 手机号+密码 / 小程序微信一键登录）
- [x] 权限核心纯逻辑 + 单测 `shared-domain/permissions.ts`（动作→岗位策略表、或签、有效岗位合并）
- [x] 登录 / 员工绑定 / 会话（CodeX，手机号密码登录 + 微信登录入口；员工绑定流程待小程序阶段细化）
- [x] JWT access+refresh + 改密（CodeX）
- [x] 角色 + 岗位 + 项目授权的后端权限中间件（Guard 接 permissions.ts，已挂全部业务写端点）
- [x] 改造现有写端点：操作人取登录态（`@CurrentUser()`），不再信任请求体 `*ByUserId`（DTO 已删除该字段）
- [x] 更新 `verify-core-flow`：分步骤用不同身份登录（Bearer token）+ 安全回归（未登录 401 / 错误岗位 403）
- [x] ~~接口"前端传谁就信谁"~~ 已解决：未登录写接口 401，错误岗位 403（含 create/上传仅要求登录）

## Web 管理端

- [x] 企业后台布局
- [x] 合同 / 结算 / 付款 / 资料库 / 审计 台账页 + 详情页骨架
- [x] 核心读 API 客户端 + 页面配置测试
- [~] 写操作接入（归档、付款部分动作已 wire；已携带登录态 token）
- [x] 登录页 / 前端鉴权态（携带 access token、401 自动刷新或跳登录）
- [x] 委托台账管理页（/delegations：列表 + 创建 + 撤销，调用 `/approval-delegations`）

## Milestone 7：小程序移动端

- [ ] 未开始（`apps/miniprogram` 尚未建立）

## Milestone 8：部署上线

- [ ] 生产环境变量 / 密钥管理
- [ ] HTTPS / 域名
- [ ] PostgreSQL 不公开 + 每日备份且演练恢复
- [ ] 附件备份 / 日志监控 / 上线初始化脚本

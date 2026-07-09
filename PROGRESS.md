# 建工智管 - 进度记录 (PROGRESS)

> 本文件是项目的**唯一进度真相**：AGENTS.md / CLAUDE.md 写规则与边界，本文件写当前做到哪、下一步做什么。
>
> 协同纪律：CodeX 和 Claude 每完成一个子任务，必须更新本文件并随代码一起 commit。接手开发第一件事仍然是读本文件。
>
> 维护规则：主文件只保留当前状态、下一步、上线闸门和最近摘要；详细历史日志归档到 `docs/progress/`。

图例：`[x]` 完成 · `[~]` 部分完成/有雏形 · `[ ]` 未开始

---

## 快速结论（2026-07-09）

- [x] P0 本地代码收口已完成：后端核心闭环、企业级合同工作台、历史合同接管、历史余额扣减、真实首页、业务选择器、常用单据、私有文件、PDF、审计、权限和 Web/API 生产部署均已有可验证实现。
- [ ] 仍不能宣称已成为真实项目唯一业务事实：备案管局终审、真实数据初始化、合同母版签认、权限矩阵和业务 Go-Live 签字未完成。
- [x] 当前试运行范围已收敛：先做 1 个真实项目、约 20 个已签在执行历史合同接管、3-5 个活跃合同继续跑结算/付款/实付/凭证/审计闭环。
- [x] 历史合同原则已确认：已签历史合同不重走合同编制、合同审批和用章审批；通过补录、归档、历史余额初始化、业务复核和接管确认建立系统事实起点。
- [x] 前端改造主线已进入可验收口径：TDesign 单组件库、薄设计 token 层、流程摘要条、统一动作面板、证据文件卡、审批时间线和 Playwright P0 冒烟已覆盖核心详情页。
- [ ] 当前不进入本轮 P0：小程序真机生产验收、全项目铺开、历史合同逐份 AI/OCR 自动识别、历史合同重走审批、开票、考勤、人事、安全。

## 当前下一步

- [~] 生产等价环境复验：环境变量、密钥、COS 配置、PostgreSQL 本机监听、HTTPS/IP 访问、安全响应头、时间同步、服务器健康检查已验证；`jgzg.site` DNS 记录正确且用户浏览器已确认 health OK；COS 桶私有读写、无公开 Policy、无 Everyone 授权、无生命周期删除规则、版本控制已人工确认；备案管局终审和权限矩阵现场验收按用户确认暂挂，后续再补。
- [ ] 真实数据初始化：项目、成员、岗位、账号、业主主合同、约 20 个历史合同、3-5 个活跃合同槽位。
- [~] 真实账号收口：seed 通用密码未出现在生产环境，seed 用户和 refresh token 已停用；真实试运行用户清单、临时密码重置和首次改密留痕待执行。
- [ ] 历史合同接管：导入预检、批次生成草稿、同批次幂等防重复、批次摘要查看、中文复核提示、A/B/C 等级风险说明、资料清单/缺口说明、确认前关键资料硬拦、资料库按项目查询和付款阻断提示已可用；仍需完成真实合同资料补录、复核、当前密码二次确认接管。
- [ ] 活跃合同链路：结算同合同版本同期间防重、同期间未作废结算数据库唯一兜底、合同清单项累计超额拦截、合同清单项负数绕过拦截、结算期间空格归一防绕过、不可建结算的中文业务兜底提示和结算创建按钮禁用原因可见已完成；仍需选 3-5 个合同跑通结算、生效、付款申请、审批、实付、凭证、审计。
- [x] 运维验收：数据库备份恢复演练、Nginx 安全片段、运行健康检查、COS 私有桶策略和版本控制在服务器/控制台实测并留证；服务器健康检查已部署支持 `ALERT_WEBHOOK_URL` 和 SMTP 邮箱告警的脚本，QQ 邮箱 SMTP 使用 `AUTH=LOGIN`，低风险失败测试邮件已实际触达用户 QQ 邮箱。
- [ ] 合同母版人工签认：生产库当前无成功合同草稿生成记录，需先用真实合同员账号完成一次四类母版生成，再由合同部/法务逐页验收 DOCX 版式、字体、分页、签章页、附件页。
- [~] 合同工作台/模板库重构：已完成英文错误中文化、核心动作面板和合同/结算/付款详情动作组只显示可办动作、合同 Excel/Word 模板中文化、版式检查/渲染共享中文占位符注册表、模板库若干内部编号/JSON 去业务化、上传提示中文化、合同工作台首屏四问摘要、模板库使用/配置模式首轮拆分、配置模式前后端岗位边界和新建合同项目范围收口；仍需新增模板详情读模型、版式绑定业务模板版本和更完整一线向导式合同工作台。
- [ ] 业务 Go-Live 签字：老板、财务、合同部、项目经理、技术/运维完成最终闸门签认。
- [x] 外围模块闭环：报销申请和零星采购均已按 `ProjectExpenseRequest` 非合同类付款申请链路完成一等入口、四级审批、审批单 PDF 下载、已批待付、出纳实付、凭证、财务入账、最终 PDF 归档和审计；零星采购额外覆盖物资员发起、采购执行和发起人收货确认。

## P0 进展

| 项 | 状态 | 当前事实 | 剩余缺口 |
| --- | --- | --- | --- |
| P0-1 历史合同接管 | [x] | 后端接管模型、A/B/C 分级、复核/确认 API、草稿编辑保存、接管资料上传绑定、项目权限、审计、付款前硬拦截已完成；Web 表单、导入预检、预检通过后生成接管草稿、项目级导入批次、同批次幂等防重复、批次摘要查看、中文复核提示、等级风险说明、资料清单/缺口说明、资料库按项目查询和付款阻断提示已完成。 | AI/OCR 自动识别和小程序接管为后续增强，不阻断 P0。 |
| P0-2 历史余额控制 | [x] | 已确认接管历史余额进入付款容量硬扣减；付款预览和合同详情金额摘要已接入；付款预览说明已展示历史未释放质保金扣减。 | 历史结算明细/分摊来源、Excel/OCR 为后续增强，不阻断 P0。 |
| P0-3 真实使用体验 | [x] | 结算/付款业务选择器、真实首页工作台、逐单 `GET /me/work-items`、P0 浏览器冒烟 mock、审批中心五视图、列表可用筛选器、详情页后端动作元数据、详情页审批历史时间线、合同/结算/付款列表过程字段、资料库行内授权下载、审批单下载当前密码和原因审计、委托人员选择器同项目收窄已完成。 | 小程序为 P2；生产等价真实用户长链路验收待现场执行。 |
| P0-4 真实试运行准备 | [~] | 初始化清单和最小 Runbook 已形成。 | 真实数据落库、生产安全实配、备份恢复演练、合同母版人工签认。 |
| P0-5 生产验收 | [~] | 生产验收 Runbook、只读检查脚本、核心链路 UAT 脚本、最终闸门清单已形成；服务器 readiness、迁移状态、IP HTTPS、安全响应头、UFW、PostgreSQL 本机监听、时间同步、备份恢复演练已通过；`jgzg.site` 和 `www.jgzg.site` DNS 记录正确，用户浏览器已确认 `https://jgzg.site/api/health` 返回 OK；COS 桶 `jiangkong-prod-files-1438687719` 为私有读写，无公开 Policy、无 Everyone 授权、无生命周期删除规则，版本控制已开启；运行健康检查低风险失败邮件已触达 QQ 邮箱。 | 备案仍在管局审核，权限矩阵仍需现场验收；这两项按用户确认先暂挂，不阻塞继续推进改造方案代码项。 |
| P0-6 真实试运行执行 | [~] | 执行与问题闭环 Runbook 已形成。 | 尚不代表真实试运行已开始或通过。 |
| P0-7 真实常用单据 | [x] | 项目付款审批表 PDF、结算附件模板、综合费用最小付款闭环已完成。 | 完整 OA 报销、发票识别、行程明细、多人报销、预算科目树不进入 P0。 |

## 最近变更（保留摘要，最新在最上）

- 2026-07-10 (CodeX)：继续加固结算同期间防重数据库兜底中文错误切片：同一合同版本、同一结算期间如果并发创建绕过应用层预检查，在数据库唯一索引拒绝写入时，不再把 Prisma `P2002` 或内部索引名透出给业务人员，统一提示“同一合同版本和结算期间已存在结算单”；结算编号重复也统一转为中文业务提示。不改变结算预检查、数据库部分唯一索引、结算明细重算、清单项累计占用、审批实例创建和付款容量口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进接管工作台五步办公化口径切片：历史合同接管工作台步骤从“生成草稿、单合同补录、多部门复核、主管确认”等八个操作节点，收敛为“接管准备、导入预检、资料核验、复核确认、接管后核验”五个业务步骤；导入预检说明仍明确预检通过后生成草稿，资料核验说明保留单合同补录，复核确认说明保留多部门复核和主管当前密码确认。不新增 UI 库、不引入在线 Excel，不改变后端接管状态机、批次生成草稿、资料硬拦、主管确认和付款阻断口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续加固私有资料短时效下载当前密码前置测试：资料库、接管资料和归档资料生成短时效下载链接前，如果当前密码校验失败，控制器会直接拒绝并且不会调用文件服务生成下载票据，确保“当前密码、下载原因、短时效链接和审计”链条里当前密码是前置条件。不改变文件下载权限解析、接管资料项目归属、下载原因、短时效链接签名和审计口径。验证：API 文件控制器 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续加固历史期初结算付款容量回归测试：当期初结算已经进入 `Settlement`，即使只有 `sourceTakeoverId`、没有同步写入 `sourceType = historical_takeover`，容量算法仍按接管余额确认日作为付款条款到账期依据，并且不再把同一笔历史已付重复扣减；用“期初结算 100、历史已付 40、已批待付 10、其他占用 5、最多可申请 45”的测试口径守住内部容量输入 `sourceTakeoverId` 的公共承诺。不改变付款容量算法、付款申请创建、合同详情读模型和接管入账口径。验证：API 付款容量 Jest 通过。
- 2026-07-10 (CodeX)：继续推进结算明细表导出中文业务错误治理切片：下载结算明细 Excel 草稿时，如果导出服务暂不可用、结算单不存在或结算单已不处于待审批/已退回草稿阶段，不再抛出 `Prisma service is required to export settlement Excel`、`Settlement not found` 或内部状态值，统一改为中文业务原因并提示稍后重试、刷新台账或在结算发起/退回后再导出。不改变结算明细表内容、审批签字行、归档 PDF、结算状态机和金额账本口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算创建入口中文业务错误治理切片：创建结算时，如果结算服务暂不可用、合同版本不存在、合同尚未归档生效、关联合同缺失或合同缺少已生效结构化付款条款，不再抛出 `Prisma service is required to create settlement`、`Contract version not found`、`Cannot create settlement from a non-effective contract version`、`Contract not found`、`Effective payment terms version not found` 等英文技术提示，统一改为中文业务原因并说明刷新合同、完成归档确认或补齐付款条款后再办理；失败时不会创建结算单。不改变结算明细重算、防重复、清单项累计占用、付款阶段计算、异常额度占用和审批 PDF 口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进私有资料读取失败中文业务错误治理切片：短时效下载链接通过权限与签名校验后，如果底层私有存储读取失败，不再把文件系统或对象存储错误直接透出，统一提示“资料文件暂时无法读取，请稍后重试或联系管理员核对私有存储”；失败时不会写入下载审计，避免把未成功读取的资料误记为已下载。不改变当前密码、下载原因、短时效链接、权限判定、文件存储和成功下载审计口径。验证：API 文件服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进私有资料下载原因中文业务错误治理切片：生成短时效下载链接或读取短时效链接时，如果下载原因超过 200 个字，不再抛出 `Download reason must be at most 200 characters` 英文技术提示，统一提示“下载原因不能超过 200 个字，请精简后重新提交”；失败会在权限查询、短时效链接签名、私有文件读取和审计写入之前拦截。不改变当前密码校验、下载原因必填、短时效链接、权限判定和审计口径。验证：API 文件服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进私有资料上传中文业务错误治理切片：私有文件上传在上传人缺失、文件为空、超过系统大小限制或格式不支持时，不再抛出 `Uploaded user id is required`、`Private file is empty`、`Private file exceeds upload size limit`、`Private file extension is not allowed` 等英文技术提示，统一改为中文业务原因并提示重新登录、重新选择文件、压缩后重传或上传 PDF/Word/Excel/图片资料；失败时不会写入私有存储，也不会创建文件对象或审计记录。不改变私有存储、允许格式、大小限制、短时效下载和审计口径。验证：API 文件服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进接管等级申报体验治理切片：接管工作台不再把 A/B/C 展示成用户可直接拍板的“接管等级”，录入态统一改为“申报接管等级”，列表显示“申报等级”，主管确认摘要显示“确认接管等级”；系统建议区明确“系统建议等级”，当申报等级与建议不一致时，要求填写“等级调整说明/复核意见”，并提示复核确认后才形成最终等级。导入示例同步改为“申报接管等级”，但继续兼容旧表头位置，不改变后端入库字段、系统建议规则、主管确认、资料硬拦、付款阻断和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进结算审批单下载中文业务错误治理切片：下载最新结算审批单时，如果下载服务或当前密码校验服务暂不可用，不再抛出 `Prisma and file services are required to download settlement approval PDF`、`Auth service is required to confirm settlement approval PDF download` 等英文技术提示，统一改为中文业务原因并提示稍后重试或联系管理员；失败时不会继续校验文件下载权限或读取私有文件。不改变当前密码、下载原因、短时效下载审计和审批单 PDF 生成口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算归档 PDF 生成中文业务错误治理切片：合同部生成结算归档 PDF 时，如果结算归档 PDF 服务或私有文件服务暂不可用，不再抛出 `Prisma service is required to generate settlement PDF archive`、`File service is required to generate settlement PDF archive` 等英文技术提示，统一改为中文业务原因并提示稍后重试或联系管理员；失败时不会继续生成文件或写入 PDF 归档记录。不改变结算归档 PDF 内容、私有文件上传、资料库入库和审计口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算归档确认中文业务错误治理切片：合同主管确认已签署结算归档时，如果结算归档确认服务或当前密码校验服务暂不可用，不再抛出 `Prisma service is required to confirm settlement archive file`、`Auth service is required to confirm settlement archive` 等英文技术提示，统一改为中文业务原因并提示稍后重试或联系管理员。不改变结算归档状态机、当前密码校验、结算生效、异常额度占用和审计口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进合同归档 PDF 生成中文业务错误治理切片：合同部生成合同归档 PDF 时，PDF 服务暂不可用、合同版本不存在、合同版本尚未生效、合同主数据不存在或归档 PDF 已生成等场景，不再抛出 `File service is required to generate contract PDF archive`、`Contract version not found`、`Contract PDF archive already exists` 等英文技术提示，统一改为中文业务原因，并确保失败时不会上传文件或创建 PDF 归档记录。不改变合同归档 PDF 内容、私有文件上传、资料库入库和审计口径。验证：API 合同服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进合同归档确认中文业务错误治理切片：合同主管确认已签署合同归档时，缺少当前密码、密码校验服务暂不可用、合同版本不存在、状态尚不能确认、归档文件不存在或归档文件已处理等场景，不再抛出 `Contract archive confirmation password is required`、`Cannot confirm contract archive from status ...`、`Contract archive file not found` 等英文技术提示，统一改为中文业务原因并说明下一步。不改变合同归档状态机、当前密码校验、付款条款冻结、合同版本生效和审计口径。验证：API 合同服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进证据卡下载提示一致性切片：合同详情、历史接管、结算详情和付款详情里显式传给证据文件卡的下载提示，不再停留在“当前密码并记录审计”，统一说明“当前密码、下载原因、短时效链接和审计”；这样资料库、接管资料、合同归档、结算归档和付款凭证在前台看到的私有文件下载口径一致。不改变后端下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 证据文件卡 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管等级人工选择责任留痕切片：接管工作台保留业务人员手动选择 A/B/C 接管等级，但在确认前核验摘要和主管确认弹窗同步展示“系统建议、实际选择、是否调整及复核意见”，让主管看到接管等级不是随手选择；若等级偏离系统建议，仍由既有前后端规则要求填写复核说明。不改变接管等级入库、系统建议规则、主管确认、资料硬拦、付款阻断和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进资料库短时效下载成功提示切片：资料库短时效下载链接生成成功后，不再只提示“下载链接已生成、已记录审计”，而是明确说明链接为短时效链接，过期后需要重新授权下载，避免业务人员误以为链接可长期复用。不改变下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 资料库配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进资料库治理规则下载口径统一切片：资料库顶部治理规则不再只写“敏感文件必须经后台权限校验后生成短期下载链接”，改为明确“后台权限校验、当前密码、下载原因、短时效下载链接”，与证据文件卡、授权下载弹窗和二次确认文案保持一致，避免业务人员在不同位置看到不同下载口径。不改变下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 资料库配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进资料库下载二次确认提示治理切片：资料库授权下载在生成短时效链接前的二次确认文案不再只说“记录审计”，而是明确说明系统会校验当前密码、要求填写下载原因、生成短时效下载链接，并记录下载人、资料文件、业务单据和下载原因审计，帮助业务人员理解私有资料下载后果。不改变后端下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 资料库配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进资料库下载禁用原因可见化切片：资料库列表中不可授权下载的资料不再只是灰掉按钮，而是在“授权下载”操作上显示中文业务原因，例如归档尚未确认或当前资料暂不可下载，方便合同部/财务知道下一步该补确认还是补资料。不改变后端下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 资料库配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进资料库授权下载当前密码前置校验切片：资料库生成短时效下载链接时，如果未填写当前登录密码，“生成下载链接”按钮会直接禁用并在弹窗内提示“请填写当前登录密码后再生成下载链接”，提交函数也保留同一中文守卫，避免业务人员点击后才看到失败消息；不改变后端下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 资料库配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进证据资料下载提示治理切片：共享证据文件卡片在未单独传入下载提示时，不再只提示“下载将记录审计”，统一说明“下载需当前密码、下载原因和短时效链接，并记录审计”；接管资料、归档资料等证据卡即使复用默认文案，也能向业务人员说明私有资料下载的完整约束。不改变下载权限、当前密码校验、下载原因、短时效链接生成和审计口径。验证：Web 证据文件卡 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管当前密码二次确认体验切片：主管确认历史合同接管时，如果未填写当前登录密码，确认按钮会直接禁用并在弹窗内提示“请填写当前登录密码后再确认接管”，提交函数也保留同一中文守卫，避免业务人员点击后才看到失败消息；不改变后端当前密码校验、主管确认、历史期初事实生成、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管确认责任人可见化切片：接管工作台的核验摘要和主管确认弹窗在展示金额、等级风险、付款办理提示、资料缺口、资料依据、复核意见和验收结论之外，同步展示接管责任人；如果只保存了责任人账号但未读取到姓名，仍沿用“已指定责任人”的业务化展示，避免主管确认历史期初事实时看不到后续补资料和复核跟进责任归属。不改变接管责任人入库、主管确认、资料硬拦、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管主管确认前复核结论可见化切片：接管工作台的核验摘要和主管确认弹窗在金额、等级风险、付款办理提示、资料缺口和资料依据之外，同步展示复核意见与验收结论，避免主管确认历史期初事实时看不到预算/合同部复核口径和最终接管结论。不改变接管复核字段入库、主管确认、资料硬拦、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管确认资料缺口可见化切片：接管工作台的核验摘要和主管确认弹窗在展示接管等级风险、付款办理提示之外，同步展示后端读模型给出的资料缺口说明，避免业务人员只看到“资料依据”而忽略缺少历史合同扫描件、结算台账或付款凭证等影响确认和后续付款核验的事项。不改变接管资料清单、资料硬拦、等级建议、偏离说明、主管确认、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管等级付款阻断提示可见化切片：接管工作台的核验摘要和主管确认弹窗不再只展示 A/B/C 等级风险和资料说明，而是同步展示后端读模型给出的付款办理提示，例如尚未主管确认会阻断付款、B/C 级或缺关键资料时付款前必须补齐或形成受限确认说明；这样业务人员手动选择接管等级后，也能在确认前看到“等级不等于付款放行”的后果。不改变接管等级入库、系统建议、偏离说明、主管确认、资料硬拦、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进结算清单项超额提示治理切片：结算明细引用合同清单项时，如果本次结算叠加前序有效结算后超过该清单项含税金额，后端错误不再只泛泛提示超额，而是用中文说明本次结算金额、前序已结算金额、合同清单金额和超出金额，方便合同部/预算直接核对是哪一行、超了多少。不改变同合同版本同期间防重、结算明细重算、合同清单项累计占用、审批归档和付款容量口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管生成草稿提醒闭环切片：批量导入生成接管草稿成功后，成功提示会继续显示本批次“需要复核说明”的行数，并提示先进入草稿核对再提交复核，避免合同部看到生成成功后误以为等级偏离、资料缺口或问题清单提醒已自动消失。不新增页面状态、不改变后端预检、生成草稿、批次幂等、问题清单入账和付款阻断口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint 通过；本切片只改提示文案和纯函数，未跑 Playwright。
- 2026-07-10 (CodeX)：继续推进历史接管导入问题清单入账切片：批量导入预检通过后生成接管草稿时，导入行里的“问题清单”会优先写入该合同草稿的复核意见；如果业务人员已单独填写复核意见则仍以复核意见为准，只有两者都为空时才使用批次默认复核意见。这样接管等级人工调整、发票待补、资料争议等说明不会只停留在预检表格里，而是进入后续多部门复核和主管确认可见的业务事实。不新增字段、不改变批次幂等、接管状态机、资料归档、付款阻断和审计口径。验证：API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管导入预检前端提示切片：接管工作台批量导入预检完成后，顶部消息不再只显示可生成和需修改行数，而是同步显示“需要补充说明”的提醒行数；当后端发现接管等级与系统建议不一致、资料清单缺失或问题说明需要补充时，合同部不用逐行扫表就能先看到本批次仍需业务复核。不新增页面状态、不改变生成草稿、批次幂等、后端预检和付款阻断口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint 通过；本切片只改提示文案和纯函数，未跑 Playwright。
- 2026-07-10 (CodeX)：继续推进历史接管导入预检等级建议切片：批量导入预检时，后端会按履约状态、余额来源、证据说明和历史在途/待付/代付/质保金/其他占用计算建议等级；导入行填写的 A/B/C 与系统建议不一致且问题清单为空时，不阻断导入，但会在行级预检结果中提示“接管等级与系统建议不一致，请在问题清单或批次复核意见说明调整原因”，让合同部在生成草稿前先补说明。不新增字段、不改变批次幂等、生成草稿、主管确认、付款阻断和审计口径。验证：API 接管服务 Jest、API typecheck、API lint、`git diff --check` 通过。
- 2026-07-10 (CodeX)：继续推进历史接管等级后端事实入口切片：后端创建/编辑历史合同接管草稿时，同样按履约状态、余额来源、证据说明和历史在途/待付/代付/质保金/其他占用计算建议等级；如果业务提交的接管等级与系统建议不一致且未填写复核意见，直接拒绝写入，提示“接管等级与系统建议不一致，请在复核意见说明调整原因”。不新增字段、不改变主管确认、资料归档、付款阻断和审计口径。验证：API 接管服务 Jest、API typecheck、API lint、`git diff --check` 通过。
- 2026-07-10 (CodeX)：继续推进历史接管等级复核体验切片：单合同补录/编辑时，接管工作台会根据履约状态、余额来源、证据说明和历史在途/待付/代付/质保金/其他占用给出 A/B/C 系统建议等级；业务人员仍可调整等级，但若与系统建议不一致，必须在复核意见写明调整原因后才能保存草稿，避免接管等级变成随手选择。不新增字段、不改变后端接管等级、付款阻断、主管确认和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui`、`git diff --check` 通过。
- 2026-07-10 (CodeX)：继续推进审批委托台账前端禁用原因切片：新增委托时未选择受托人、未填写正确生效/失效时间或失效时间不晚于生效时间，创建按钮直接禁用并显示中文业务原因，不再让业务人员点击后等待后端报错；生效/失效时间改为页面原生时间输入，提交前仍转换为后端既有时间格式。不改变同项目可选人员范围、委托有效期、审批代理识别和审计口径。验证：Web 审批委托配置 Vitest、Web typecheck、Web lint、Web `check:ui`、`git diff --check` 通过。
- 2026-07-10 (CodeX)：继续推进审批中心委托中文业务体验治理切片：创建和撤销审批委托时，接收人为空/为本人、接收人不在同项目、接收人停用、委托有效期错误、结束时间早于开始时间、非委托人撤销、委托记录不存在或已撤销等场景，不再抛出 `Approval delegation target is invalid`、`Approval delegation must end after it starts`、`Only the delegator can revoke an approval delegation` 等英文技术错误，统一改为中文业务原因；不改变同项目可选人员范围、委托有效期、审批代理识别和审计口径。验证：API 审批委托 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进通用审批单下载中文业务体验治理切片：审批单下载或补生成时，如果业务尚未完成审批、审批单暂未生成或审批实例已不可用，不再抛出 `No completed approval found for this business object`、`Approval form is not available yet` 等英文技术错误，统一提示“当前业务尚未完成审批，暂不能生成/下载审批单”或“审批单暂未生成，请先确认审批已完成后再下载”；不改变审批单生成、归档文件权限、当前密码、下载原因、水印和审计口径。验证：API 审批单 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进通用审批单与委托人员展示业务化切片：审批单下载水印、审批单 PDF 里的申请人/处理人，以及审批委托列表里的委托人/受托人姓名读取不到时，不再回退展示内部账号/ID，统一显示“下载人未读取”“申请人未读取”“处理人未读取”“委托人未读取”“受托人未读取”；不改变审批单生成、下载当前密码、下载原因、委托有效期、权限和审计口径。验证：API 审批单/审批委托 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算审批时间线人员展示业务化切片：结算审批日志和审批单 PDF 行里的审批人姓名读取不到时，不再回退写入或展示内部账号/ID，统一显示“审批人未读取”，避免审批时间线和归档 PDF 向业务人员暴露内部标识；不改变结算审批状态机、签名图片读取、审批单 PDF 刷新、当前密码下载和审计口径。验证：API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进核心资料卡片人员展示业务化切片：合同详情、结算详情、付款详情和资料库最近文件中，上传人、确认人或经办人姓名读取不到时，不再回退展示内部账号/ID，统一显示“上传人未读取”“确认人未读取”或“经办人未读取”；不改变合同/结算归档、付款凭证、资料库权限、当前密码、下载原因、短时效链接和审计口径。验证：API 合同/结算/付款读模型与资料库 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管资料证据链展示业务化切片：接管资料卡片的上传人姓名读取不到时，不再回退展示上传人内部账号/ID，统一显示“上传人未读取”，避免资料库和接管详情向合同部、预算、财务等业务人员暴露内部标识；不改变私有文件权限、当前密码、下载原因、短时效链接和审计口径。验证：API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管责任人展示业务化切片：接管读模型新增责任人姓名，历史接管详情页优先展示责任人姓名；若系统只保存了责任人账号但暂未读到姓名，页面只提示“已指定责任人”，不再把 `responsibleUserId` 直接展示给合同部、预算、财务等业务人员。不改变接管责任人入库、批次生成草稿、权限和审计口径。验证：API 接管服务 Jest、Web 接管配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进历史接管日期提示业务化切片：接管导入预检、单合同补录/编辑和批次生成草稿里的签订日期、接管截止日错误提示，不再展示 `YYYY-MM-DD` 技术格式，统一改为“请按年-月-日填写，例如 2026-01-10”；不改变日期存储、导入预检、批次生成草稿和接管状态机口径。验证：API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管金额提示业务化切片：接管导入预检、单合同创建/编辑和前端金额展示兜底不再向业务人员提示“分值”“整数字符串”等技术口径，统一改为“金额必须填写大于 0”“必须填写 0 或更大的金额”“金额数据格式不正确，请刷新后重试”等中文业务提示；不改变前端按元录入、后端按分入账、导入预检阻断和接管账本口径。验证：API 接管服务 Jest、Web 接管配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进历史接管导入预检等级选择体验切片：批量导入中接管等级填错时，不再提示偏内部口径的“A、B 或 C”，改为“请选择 A级、B级或C级”，与单合同下拉选择和批量粘贴“B级”的业务输入口径保持一致；不改变接管等级入库标准值、预检阻断、批次生成草稿和付款阻断口径。验证：API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管等级选择体验切片：单合同补录保持接管等级下拉选择，批量导入预检支持业务人员粘贴“B级”等中文等级，前后端统一归一为 A/B/C 后再进入接管预检和草稿生成；Web 导入示例不再展示偏系统值。不改变接管等级风险规则、批次生成草稿、同批次幂等防重复、付款阻断和后端账本口径。验证：API 接管服务 Jest、Web 接管配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进历史接管导入预检行级体验治理切片：导入预检的历史金额行级错误不再展示 `historicalSettledCents` 等内部字段名，改为“历史累计结算”等中文业务项；Web 导入示例不再要求业务人员填写 `in_progress`，支持粘贴“履约中”等中文履约状态后再转成系统值提交。不改变预检规则、批次生成草稿、幂等指纹和后端状态口径。验证：API 接管服务 Jest、Web 接管配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进历史接管导入预检中文业务体验治理切片：导入预检在缺少导入行、导入数据为空、单次超过 200 行或某一行格式不正确时，不再抛出 `Import precheck rows must be an array`、`Import precheck row 1 must be an object` 等英文技术提示，统一改为中文业务原因，并在写入任何业务记录前失败；不改变预检规则、批次生成草稿、幂等指纹和审计口径。验证：API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史接管创建/编辑中文业务体验治理切片：接管创建和草稿编辑在项目不存在或停用、复核中不能编辑、缺少合同编号/名称/相对方、合同金额非法、接管等级或履约状态错误、签订日期或接管截止日错误、历史金额字段为负数、历史金额超过系统范围、接管资料/密码服务暂不可用时，不再抛出 `Project not found or inactive`、`Cannot update takeover draft from status`、`signedAt must be a valid date string`、`historicalSettledCents must be a non-negative integer` 等英文技术提示，统一改为中文业务原因；不改变接管状态机、金额口径、资料归档和审计口径。验证：API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进接管后核验详情提示切片：历史合同主管确认后，接管详情新增“接管后核验”只读清单，明确下一步要用新结算、付款申请、实付凭证、财务入账和审计记录验证期初账本，不把主管确认误当作真实业务闭环已完成；不改变接管状态机、历史期初结算生成、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管后核验口径治理切片：历史合同完成主管确认后，接管步骤条不再把“接管后核验”误标为已完成，而是展示为“待核验”，提醒业务人员还需要用接管后的新结算、付款申请、实付和审计来验证期初账本；不改变接管确认状态机、历史期初结算生成、付款容量和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管资料核验中文业务体验切片：接管详情里的“上传接管资料”按钮在未选择文件、已提交复核、已主管确认或接管记录已作废时，不再只是灰掉不可点，而是通过中文提示说明“请先选择资料文件”“需退回补充后才能继续上传”“已完成主管确认不能静默补充，请走更正记录”等业务原因；不改变资料上传 API、接管资料归档、私有文件权限和审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进接管工作台中文业务体验切片：历史合同接管台账的“编辑、提交复核、确认接管”动作不再只在可办时出现，不能办理时保留禁用动作并用中文说明原因，例如已提交复核需退回后才能编辑、已在复核中无需重复提交、草稿需先提交复核后才能主管确认；不改变接管状态机、复核确认权限、接管步骤条和后端审计口径。验证：Web 接管配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-10 (CodeX)：继续推进私有资料下载中文业务体验治理切片：文件上传、下载票据生成、短时效链接读取、链接过期/校验失败、资料不存在、未归档确认、无权下载等文件服务直出错误不再使用 `Private file not found`、`Invalid private file download token`、`Archive file is not confirmed`、`Actor cannot download private file` 等英文技术提示，统一改为中文业务原因；不改变当前密码、下载原因、短时效签名、私有文件读取权限和审计口径。验证：TDD 覆盖 API 文件服务/控制器 Jest 通过。
- 2026-07-10 (CodeX)：继续推进历史接管资料下载权限验收切片：复核私有文件下载链路已统一通过 `archiveRecord -> contract_takeover -> projectId` 判断项目归属，同项目合同/财务等归档可读岗位可在填写当前登录密码和下载原因后获取短时效链接并写入审计；新增非本项目人员无法为接管资料生成下载票据的后端测试，同时将下载票据入口“当前密码缺失、下载原因缺失”提示中文化。本轮不改变短时效票据签名、私有文件读取和审计动作口径。验证：TDD 覆盖 API 文件服务/控制器 Jest 通过。
- 2026-07-10 (CodeX)：继续推进历史合同接管资料绑定中文业务体验治理切片：接管资料挂接在未选择文件、资料类型不正确、接管记录状态不允许或当前账号无权读取文件时，不再抛出 `Evidence file is required`、`Invalid evidence purpose`、`Cannot attach takeover evidence from status`、`Actor cannot download private file` 等英文技术错误，统一改为中文业务原因；不改变接管资料 `archiveRecord` 入库、私有文件读取权限校验、资料类型映射和审计口径。验证：TDD 覆盖 API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进历史合同接管复核/确认中文业务体验治理切片：接管提交复核和主管确认在接管记录不存在、状态不允许或缺少当前登录密码时，不再抛出 `Cannot submit takeover review from status`、`Contract takeover confirmation password is required`、`Cannot confirm takeover from status`、`Contract takeover not found` 等英文技术错误，统一改为中文业务原因；不改变接管资料缺口硬拦、合同版本生效、付款条款生效、历史期初结算生成和审计口径。验证：TDD 覆盖 API 接管服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算审批单下载证据链中文业务体验治理切片：结算审批 PDF 下载在当前账号无权读取或审批单刷新后仍缺失时，不再抛出 `Actor cannot download settlement approval PDF`、`Settlement approval PDF is not available yet` 英文技术错误，统一改为中文业务原因；不改变当前密码、下载原因、审批单自动刷新、私有文件读取校验、下载审计和文件名口径。验证：TDD 覆盖 API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算归档证据链中文业务体验治理切片：结算归档文件上传、归档确认和归档 PDF 生成在结算单不存在、状态不允许、缺少当前登录密码、归档文件不存在、归档文件已处理或 PDF 已生成时，不再抛出 `Cannot upload settlement archive from status`、`Settlement archive confirmation password is required`、`Settlement PDF archive already exists` 等英文技术错误，统一改为中文业务原因；不改变归档状态流转、私有文件权限校验、PDF 入库、资料归档和审计口径。验证：TDD 覆盖 API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算审批转交/委托中文业务体验治理切片：结算审批转交和委托在接收人无效、结算单不存在、结算单已不在审批中、进行中的审批流程缺失、当前审批节点异常或当前账号无权转交/委托节点时，不再抛出 `Settlement approval assignment target is invalid`、`Cannot assign settlement approval from status`、`Actor cannot assign settlement node` 等英文技术错误，统一改为中文业务原因；不改变转交指派、委托台账有效期、审批动作日志和审计口径。验证：TDD 覆盖 API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算审批撤回/催办中文业务体验治理切片：结算审批撤回和催办在结算单不存在、结算单已不在审批中、进行中的审批流程缺失、非申请人操作或未到催办时间时，不再抛出 `Cannot withdraw settlement approval from status`、`Only settlement approval applicant can remind`、`Settlement approval is not due for a reminder yet` 等英文技术错误，统一改为中文业务原因；不改变撤回终态、催办节流、审批动作日志和审计口径。验证：TDD 覆盖 API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算审批处理中文业务体验治理切片：结算审批处理在审批方式不支持、结算单已不在审批中、进行中的审批流程缺失、当前审批节点异常、当前账号无权处理节点或首节点退回上一节点时，不再抛出 `Unsupported settlement approval decision`、`Cannot review settlement approval from status`、`Actor cannot approve settlement node` 等英文技术错误，统一改为中文业务原因；不改变结算审批会签、退回上一节点、退回申请人、审批通过、审批动作日志和审计口径。验证：TDD 覆盖 API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算审批意见中文业务体验治理切片：结算审批在驳回、退回上一节点或退回申请人时若未填写审批意见，不再抛出 `Settlement approval comment is required for reject or return decisions` 英文技术错误，统一提示“请填写审批意见，说明驳回或退回原因”；不改变结算审批节点流转、会签、转交委托、审批动作日志和审计口径。验证：TDD 覆盖 API 结算服务 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：修复并复验 `codebase-memory-mcp` 调用链：通过工具发现重新暴露完整工具集，实测 `list_projects`、`index_status`、`search_graph`、`search_code`、`get_architecture`、`query_graph`、`trace_path`、`get_code_snippet` 均可正常调用，项目 `Users-leoyang-Projects` 索引状态为 `ready`；本轮未改变业务代码和 MCP 高风险工具授权边界。
- 2026-07-10 (CodeX)：继续推进合同应付款实付分摊中文业务体验治理切片：合同应付款登记实付时若没有可分摊的有效结算来源，不再抛出 `Contract due payment execution has no effective settlements to allocate` 英文技术错误，统一提示先核对合同结算和历史期初结算；不改变实付登记、合同应付款分摊、预付款扣回、历史期初结算和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进合同级付款容量不足提示治理切片：合同预付款和合同应付款在当前可申请金额不足时，不再显示 `合同预付款到期可付额度不足: 0`、`合同到期可付额度不足: 50000` 这类原始分值提示，统一改为“当前最多可申请 X.XX 元”的中文业务说明；不改变预付款到期容量、合同应付款容量、历史期初结算、预付款扣回、已批待付和实付扣减口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款审批意见中文业务体验治理切片：付款审批在驳回、退回上一节点或退回申请人时若未填写审批意见，不再抛出 `Payment approval comment is required for reject or return decisions` 英文技术错误，统一提示“请填写审批意见，说明驳回或退回原因”；不改变审批意见必填规则、审批流转、审批动作日志和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进合同级付款申请创建入口中文业务体验治理切片：按合同应付款/预付款发起付款申请在误带结算、未选择合同、合同版本不存在、合同未归档生效、预付款合同生效日期缺失、关联合同缺失、已生效付款条款缺失或历史接管/历史余额未确认时，不再抛出 `Contract version is required`、`Cannot create contract advance payment from a non-effective contract version`、`Historical contract takeover must be confirmed before creating payment request` 等英文技术错误，统一改为中文业务原因；不改变合同付款条款、历史接管付款阻断、预付款到期容量、合同应付款容量、项目资金池和垫资占用口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进结算付款申请创建入口中文业务体验治理切片：按结算发起付款申请在付款来源不支持、未选择结算、结算不存在或结算尚未归档生效时，不再抛出 `Unsupported payment request source type`、`Settlement is required for settlement payment request`、`Cannot create payment request from a non-effective settlement` 等英文技术错误，统一改为中文业务原因；不改变结算生效硬校验、付款容量、合同应付款容量、项目资金池和垫资占用口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款审批转交/委托中文业务体验治理切片：付款审批转交和委托在接收人无效、付款申请不存在、付款已离开审批中、进行中的付款审批缺失、当前审批节点异常或当前账号无权转交/委托节点时，不再抛出 `Payment approval assignment target is invalid`、`Cannot assign payment approval from status`、`Actor cannot assign payment node` 等英文技术错误，统一改为中文业务原因；不改变转交指派、委托台账有效期、审批动作日志和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款审批处理中文业务体验治理切片：付款审批处理在当前审批节点异常、当前账号无权处理节点、批准金额非法、批准金额超过申请金额或非最终审批节点调整批准金额时，不再抛出 `Payment approval current node not found`、`Actor cannot approve payment node`、`Approved amount must be a positive integer` 等英文技术错误，统一改为中文业务原因并按元展示当前最多可批准金额；不改变审批节点完成、OR 签、批准金额落账、垫资额度缩减和审批单生成口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款审批处理中文业务体验治理切片：付款审批处理在不支持的审批方式、付款申请不存在、付款已离开审批中、进行中的付款审批缺失或首节点退回上一节点时，不再抛出 `Unsupported payment approval decision`、`Cannot review payment approval from status`、`Cannot reject payment approval to previous node from first node` 等英文技术错误，统一改为中文业务原因；不改变审批流转、退回上一节点、退回申请人、驳回、审批通过、垫资额度释放和审批单生成口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款审批催办中文业务体验治理切片：付款审批催办在付款申请不存在、付款已离开审批中、进行中的付款审批缺失、非申请人催办或未到催办时间时，不再抛出 `Cannot remind payment approval from status`、`Only payment approval applicant can remind`、`Payment approval is not due for a reminder yet` 等英文技术错误，统一改为中文业务原因；不改变催办节流、审批动作日志和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款审批撤回中文业务体验治理切片：付款审批撤回在付款申请不存在、付款已离开审批中、进行中的付款审批缺失或非申请人撤回时，不再抛出 `Payment request not found`、`Cannot withdraw payment approval from status`、`Only payment approval applicant can withdraw` 等英文技术错误，统一改为中文业务原因；不改变撤回终态、审批实例关闭、垫资额度释放和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-10 (CodeX)：继续推进付款 PDF 归档证据链中文业务体验治理切片：付款 PDF 生成/归档在付款申请不存在、财务入账未覆盖全部实付、付款归档文件缺失或 PDF 已归档时，不再抛出 `Cannot archive payment PDF before finance entry is complete`、`Payment archive file not found`、`Payment PDF archive already exists` 等英文技术错误，统一改为中文业务原因；不改变 PDF 生成、私有文件入库、归档记录和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进付款财务入账中文业务体验治理切片：付款财务入账在入账金额为 0/空值或付款申请不存在时，不再抛出 `Finance record amount must be greater than zero`、`Payment request not found` 英文技术错误，统一改为中文业务原因；不改变实付覆盖、未入账余额、财务入账记录和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进合同级付款申请预览中文业务体验治理切片：按合同发起付款申请预览在未选择合同版本、基准日期格式错误、合同版本不存在、合同版本未归档生效或关联合同缺失时，不再抛出 `Contract version is required`、`Invalid asOf date`、`Cannot create payment from a non-effective contract version` 等英文技术错误，统一改为中文业务原因；不改变历史期初结算、付款条款到账期、预付款扣回和付款容量计算口径。验证：TDD 红绿覆盖 API 付款读模型 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进付款详情读模型中文业务体验治理切片：付款详情在付款申请不存在、关联结算缺失、关联合同版本缺失或付款条款版本缺失时，不再抛出 `Payment request not found`、`Payment settlement not found` 等英文技术错误，统一改为提示刷新付款台账、核对结算归档或合同归档的中文业务原因；不改变付款详情查询、项目可见范围、付款容量和动作权限口径。验证：TDD 红绿覆盖 API 付款读模型 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进付款实付登记中文业务体验治理切片：付款登记实付进入账本事务后，付款申请不存在、付款审批未完成、实付金额超过付款申请剩余额、关联结算缺失、结算剩余可付额不足等场景不再抛出 `Cannot record payment execution from status`、`Payment execution exceeds approved remaining amount`、`Payment settlement not found` 等英文技术错误，统一改为中文业务原因并按元展示当前最多可实付金额；不改变实付分摊、合同级付款分配、结算付款容量和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进付款实付登记中文业务体验治理切片：付款登记实付的金额、付款凭证、当前登录密码和实付日期前置校验不再抛出 `Payment execution amount must be greater than zero`、`Payment voucher file is required` 等英文技术错误，统一改为中文业务原因，并补充实付日期格式错误测试；不改变实付分摊、付款状态、凭证权限和审计口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进财务入账中文业务体验治理切片：付款财务入账在尚未登记实付、或入账金额超过未入账实付额时，不再抛出 `Cannot record finance entry before actual payment execution`、`Finance record exceeds unrecorded paid amount` 英文错误，统一改为中文业务原因并按元展示当前最多可入账金额；不改变实付、入账、凭证、审计和付款容量账本口径。验证：TDD 红绿覆盖 API 付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进付款账本中文业务体验治理切片：付款金额共享闸口、按合同预付款申请和按合同应付款申请的金额校验不再抛出 `Payment request amount must be positive cents`、`Payment request exceeds remaining settlement capacity` 等英文技术错误，统一改为中文业务提示并按元展示当前最多可申请金额；不改变付款容量、历史接管、项目资金池和审批流转口径。验证：TDD 红绿覆盖 API 付款金额/付款请求 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进全局中文业务体验治理切片：修复简易 PDF 渲染器只能输出 ASCII 的根因，改为中文 CID 字体和 UTF-16 文本，水印统一为“建工智管内部文件”；合同归档 PDF、付款财务归档 PDF、项目支出审批/财务归档 PDF 的标题、金额和字段说明改为中文业务表达，不再显示 `Contract Archive`、`Payment Finance Archive`、`Applicant User ID`、`CNY` 等英文/内部表达。本轮不改变归档流程、审批状态和账本口径。验证：API PDF/合同/付款/项目支出 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进审计页中文业务体验治理切片：文件下载审计表头和筛选提示不再显示“追溯ID”，统一改为“追溯编号”，字段名和筛选逻辑保持不变，避免审计页向业务管理员暴露内部字段表达。验证：codebase-memory 搜索确认 Web/API 无“追溯ID”残留，Web 审计配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进全局中文业务体验治理切片：合同详情页动作前置校验不再向业务人员显示“合同版本ID”，统一改为“合同”业务对象提示，避免归档、审批、用章、催办、转交等操作缺少详情数据时暴露内部字段。本轮不改接口参数、不改合同状态流转。验证：codebase-memory 搜索确认 Web/API 无“合同版本ID”残留，Web 合同详情 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进敏感文件下载审计切片：合同、结算、付款详情页的审批单 PDF 下载不再直连下载，必须填写当前登录密码和下载原因；后端通用审批单下载和结算最新审批 PDF 下载同步硬校验当前密码、拒绝空原因，并把下载原因写入审计。本轮不改归档文件短时效票据链路、不新增审批单票据模型。验证：API 审批单 Jest、API 结算 Jest、API typecheck、API lint、Web API Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进付款容量说明口径切片：合同累计付款预览在历史接管存在未释放质保金时，容量说明新增“扣历史未释放质保金”，金额按历史质保金扣留减已释放计算，避免财务只看到最多可申请金额减少却看不到原因。本轮不新增发票硬控、不改变付款容量硬计算。验证：API 付款读服务 Jest、API typecheck、API lint、Web 付款配置 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进接管确认唯一真相切片：历史合同接管主管确认前复用接管资料清单，缺少历史合同扫描件、历史结算台账或历史付款凭证等必需资料时，用中文业务原因拒绝确认，不再让缺资料记录形成有效合同版本、有效付款条款和历史期初结算来源。本轮不新增受限确认/争议确认模型。验证：API 接管 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进归档证据链安全切片：合同归档文件和结算归档文件绑定前复用私有文件读取权限校验，当前操作人必须有权读取该文件后才能挂到合同或结算归档，避免只凭 `fileId` 把无权文件串到其他项目业务单据。本轮不改变当前密码、下载原因和短时效链接下载链路。验证：API 合同 Jest、API 结算 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进结算防重数据库兜底切片：新增 PostgreSQL 部分唯一索引，限制同一合同版本、同一结算期间只能存在一张未作废/未撤回/未退回的结算单，补住服务层查重在并发创建下的窗口；同时新增数据库 CHECK 约束，要求合同清单项结算明细金额必须大于 0。本轮不改变正常作废/退回后重做结算的业务口径。验证：Prisma validate、API 结算 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进结算明细行账本硬约束切片：后端拒绝合同清单项结算明细填负数，扣款、冲减和补差必须作为手工调整项并填写原因，避免用负数清单项抵消累计占用后绕过合同清单项上限。本轮不改变手工调整项正负口径、不改变审批和归档流程。验证：API 结算 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进结算创建入口禁用原因切片：Web 新建结算按钮在未选合同、合同不可结算、结算编号/期间/金额缺失或金额格式不正确时直接显示中文业务原因，避免业务人员点击后才看到报错；提交前也保留同一套业务守卫。本轮不改变后端账本规则、不新增 UI 库。验证：Web 业务选项 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进结算入口中文业务提示切片：Web 新建结算入口在合同不可发起结算且后端未返回具体原因时，不再只提示“请选择可发起结算的合同”，改为说明“当前合同暂不能发起结算”，并提示先确认合同已归档生效、付款条款已补齐后再办理。本轮只改兜底业务文案，不改变创建结算接口和账本规则。验证：Web 业务选项 Vitest、Web typecheck、Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进结算防重账本口径切片：后端创建结算时统一修剪“结算期间”业务文本，再用于同合同版本同期间防重和入账，避免 `2026-06` 与 ` 2026-06 ` 被当成不同期间造成重复结算；现有合同清单项累计超额校验保持不变。本轮不改前端表单、不新增状态或数据库字段。验证：API 结算 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进接管资料库查询精度切片：资料库查询在按项目权限查看历史接管资料时，先识别当前可见项目的接管记录，再查询对应 `contract_takeover` 资料，避免最近资料中不可见项目记录占满条数后把当前项目较早的接管资料挤掉；不改变当前密码、下载原因、短时效链接和审计链路。本轮只修接管资料查询精度，不扩展资料库分页体系。验证：API 资料库 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进接管资料缺口清单切片：历史合同接管读模型新增应有资料清单和缺口摘要，按已上传的历史合同扫描件、历史结算台账、历史付款凭证自动标识“已上传/待补齐”，缺口摘要明确补齐前会影响主管确认和后续付款核验；Web 接管详情在接管资料区展示资料缺口和行级风险提示。只读复核确认现有资料库、当前密码、下载原因、短时效链接和审计链路已支持 `contract_takeover` 资料。本轮不新增资料类型表、不改变私有文件下载链路、不做详情页直接下载按钮。验证：API 接管 Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进接管等级风险与付款阻断提示切片：历史合同接管读模型新增 A/B/C 等级风险说明和付款提示，未主管确认的接管记录明确提示后续付款申请会被系统阻断，C 级已确认接管提示付款前必须补齐影响金额的资料和争议说明；Web 接管详情展示“等级风险”和“付款提示”，确认弹窗复用后端风险文案。本轮不改变付款硬校验、不做发票硬控或在线 Excel。验证：API 接管 Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进接管批次中文业务体验切片：接管导入批次读模型新增中文批次状态和复核提示，按“已生成草稿/复核中/已验收/受限验收/存在争议”等业务口径展示，风险提示按错误行、资料提醒、重复跳过优先级给出下一步；Web 接管批次摘要面板展示批次状态和复核提示，不再让业务人员只看内部状态或数量。本轮不新增批次详情页、不改变接管确认规则。验证：API 接管 Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进接管批次可验收切片：新增项目级接管导入批次列表接口，按项目倒序返回批次号、接管截止日、生成草稿数、提醒数、重复跳过数和验收结论；Web 历史合同接管页新增“接管批次”摘要面板，业务人员可直接核对最近导入批次是否已形成台账。本轮不新增独立批次详情页、不引入在线 Excel 或流程引擎。验证：API 接管 Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进接管工作台批次账本切片：新增 `ContractTakeoverBatch` 项目级接管导入批次模型和迁移，导入预检通过后先生成/复用批次，再将历史合同接管草稿挂接批次号和原始导入行号；同一项目同一批导入行用稳定指纹幂等防重复，重复点击返回已存在批次并跳过新增合同。Web 接管台账和详情展示接管批次/导入行号，生成后提示批次号、生成数量和重复跳过数量。本轮不引入在线 Excel、低代码流程或 AI/OCR 自动识别。验证：API 接管 Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进接管工作台导入闭环切片：历史合同导入预检通过后可一键生成接管草稿，后端先复用预检规则阻断错误行，再逐条复用现有接管创建链路生成合同、合同版本、付款条款、期初结算款阶段和审计记录；Web 预检面板新增“生成接管草稿”动作和中文禁用原因。本轮不新增批次表、不做幂等批号、不引入在线 Excel 或流程引擎。验证：API 接管 Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进普通合同工作台付款条款维护切片：合同工作台新增“付款条款”分区，合同员可维护付款条款原文摘要、当期结算款比例、结算生效后付款期限、发票要求和是否允许分次付款；工作台读模型返回结构化付款阶段，草稿保存同步覆盖付款条款版本和阶段，后续归档生效硬拦可直接使用该结构化来源。本轮只做当期结算款最小闭环，不新增多阶段条款编辑器、在线 Office 或低代码流程。验证：API 合同工作台/合同 Jest、Web 工作台 Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进合同付款条款结构化切片：合同草稿创建入口可接收并落库结构化付款阶段，合同归档确认前必须存在“结算款”付款阶段，否则用中文业务原因拒绝生效；历史接管创建/编辑同步生成“接管期初结算款”结构化阶段，避免期初有效结算缺少付款条款来源。本轮不新增条款解析器、不新增在线 Word/Excel 或低代码流程。验证：API 合同 Jest、API 接管 Jest、API 结算 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进历史接管付款容量切片：历史接管记录中的质保金扣留/已释放金额进入付款容量模型，未释放质保金按“扣留 - 已释放”计入历史占用，历史期初结算仍不重复扣历史已付；付款申请预览同步返回质保金拆解，方便财务核对。验证：API 付款容量 Jest、API 付款读服务 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进接管资料与付款凭证证据链安全切片：历史接管资料绑定、付款实付凭证绑定复用现有私有文件读取权限校验，当前操作人必须能读取该文件后才能把文件绑定到接管记录或实付记录，避免把无权访问的私有文件串到自己的业务单据。本轮不新增资料表、不改变短时效下载和审计规则。验证：API 接管 Jest、API 付款 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进付款与财务账本安全切片：合同付款财务入账接口、前端付款详情页和请求类型统一要求当前登录密码确认，入账二次确认说明会写入财务台账、经办人和审计日志；项目支出入账既有口径保持一致。本轮不改变已批待付、实付、归档和付款容量规则。验证：API 付款 Jest、Web API Vitest、API/Web typecheck、API/Web lint、Web `check:ui` 通过。
- 2026-07-09 (CodeX)：继续推进结算账本唯一真相切片：结算创建时必须找到合同版本冻结的结构化“结算款”付款阶段，缺少该阶段时用中文业务原因拒绝创建，不再把未结构化付款条款默认当作 100% 可付，避免后续付款容量被错误放大。本轮不改变审批、归档和付款流程。验证：API 结算 Jest、API typecheck、API lint 通过。
- 2026-07-09 (CodeX)：继续推进历史接管证据链切片：资料库和私有文件下载权限统一识别 `contract_takeover` 接管资料归属项目，历史接管资料可按项目在资料库查询，同项目归档可读岗位仍需通过当前密码、下载原因、短时效链接和审计下载。本轮不新增资料表或绕过现有私有文件权限。验证：API 资料库 Jest、API 文件 Jest 通过。
- 2026-07-09 (CodeX)：继续推进结算明细行账本硬约束：结算创建入口新增同一合同版本、同一结算期间的在办/已生效结算防重复校验；合同清单项明细会累计历史在办/已生效结算行，超过该清单项含税金额时用中文业务原因拒绝创建，避免重复结算和清单项超额结算。本轮不改变审批、归档和付款流程。验证：API 结算 Jest 通过。
- 2026-07-09 (CodeX)：继续推进历史期初可付款来源闭环：付款强校验和实付分摊查询显式带出历史接管期初结算来源，合同累计付款可按接管余额确认时间识别期初结算到期，不再把无普通归档文件的历史期初结算当作不可付款来源；实付后会把付款金额分摊回历史期初结算行，保留付款来源账本。本轮不新增付款类型或改变审批规则。验证：API 付款请求 Jest 通过。
- 2026-07-09 (CodeX)：继续推进接管工作台办公化闭环：历史合同接管页新增 8 步接管步骤条，详情区新增确认前核验摘要，确认接管弹窗会复述接管截止日、等级、历史结算/已付/在途待付、预付款、质保金和确认后的业务后果，帮助合同部、预算、财务和项目经理在确认前看清期初事实与付款约束。本轮不新增批次表、不引入流程引擎。验证：Web 接管配置 Vitest、Web typecheck/lint、`check:ui`、Playwright 接管入口冒烟通过。
- 2026-07-09 (CodeX)：继续推进办公化合同结算工作台与历史接管落地计划第一刀：修复历史期初结算进入有效结算后付款容量重复扣减历史已付的问题；`historical_takeover` 期初结算没有普通归档确认文件时，按接管余额确认时间作为付款条款到账期依据；付款容量说明不再把期初结算已付和历史已付重复相加。验证：API 付款容量 Jest、API 付款读服务 Jest 通过。
- 2026-07-09 (CodeX)：按 superpowers loop-engineering 继续推进历史期初结算可见性：结算详情读模型按 `sourceType` 展示结算性质，历史接管自动生成的期初结算显示为“历史接管期初结算”，避免业务人员在详情页误认为它是普通月度结算。验证：API 结算读服务 Jest、API typecheck、API lint、`git diff --check` 通过。
- 2026-07-09 (CodeX)：按 superpowers loop-engineering 继续推进办公化合同结算工作台方案第 13 项：历史接管确认时，若存在历史累计结算金额，系统自动生成一张来源为 `historical_takeover` 的“历史期初”有效结算，金额取历史累计结算、已付取历史累计已付，并通过 `sourceTakeoverId` 与接管记录唯一关联，让接管日前已结算未付款金额继续作为有效结算来源进入后续付款容量，而不是只停留在备注或附件。验证：Prisma generate/validate、API 接管 Jest、API typecheck、API lint、`git diff --check` 通过。
- 2026-07-09 (CodeX)：按 superpowers loop-engineering 继续推进办公化合同结算工作台方案第 11 项：历史合同接管新增项目级接管批次元数据，`ContractTakeover` 增加接管截止日、接管责任人、复核意见和验收结论；创建/编辑草稿、读模型和 Web 接管表单同步支持，台账新增“接管截止日”列，详情展示来源、复核和验收信息。本轮不新增独立批次表，先用单合同接管记录承载真实试运行所需最小闭环。验证：Prisma generate/validate、API 接管 Jest、Web 接管配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui`、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续执行办公化合同结算工作台方案历史接管主线：历史合同导入预检模板新增“资料清单”和“问题清单”两列，前端粘贴解析和预检结果表同步展示；后端预检对未填写资料清单、A级合同仍有问题清单、C级合同缺少问题清单给出中文业务提醒，帮助真实接管时把合同扫描件、结算依据、付款凭证、缺口责任人和是否影响付款提前暴露。本轮仍保持预检只读不写正式业务事实。验证：API 接管 Jest、Web 接管配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui`、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续执行办公化合同结算工作台方案付款主线：合同累计结算付款预览新增后端 `capacityExplanation` 中文额度分解，按“当前累计可付款金额 - 已实际付款 - 审批中占用 - 已批待付款占用 - 总包代付 - 历史其他确认占用 - 本次应扣回预付款 = 本次最多可申请”返回业务说明；Web 付款新建面板展示该分解清单，帮助合同部/财务确认为什么当前最多只能申请该金额。付款规则、申请提交和金额硬校验不变。验证：API 付款读服务 Jest、Web 付款配置 Vitest、API/Web typecheck、API/Web lint、Web `check:ui`、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续执行办公化合同结算工作台方案账本主线：新增 `SettlementLine` 结算明细行模型和迁移，结算创建支持合同清单项与手工调整项两类明细，后端校验明细合计必须等于本次结算金额，合同清单项必须属于当前有效合同版本，手工调整项必须填写原因；结算详情读模型和 Web 详情页新增“结算明细账本”只读表。本轮不做在线 Excel、导入记录和变更签证正式模块。验证：Prisma generate/validate、API 结算 Jest 2 套 50 例、API typecheck/lint、Web typecheck、`check:ui`、`git diff --check` 通过。
- 2026-07-09 (CodeX)：执行办公化合同结算工作台方案首个安全切片：新增 Web Admin 中文业务语言规范与检查清单，并把高风险英文技术词检查并入 `check:ui`，防止新增/触达页面直接暴露 `Forbidden`、`Failed to fetch`、`snapshot`、`workflow`、`billItem` 等用户不可理解文案；本轮不引入在线 Office、表格库、低代码或新运行时。验证：`node apps/web-admin/scripts/check-ui-rules.mjs --self-test`、`CI=true pnpm --filter @jiangkong/web-admin check:ui` 通过。
- 2026-07-09 (CodeX)：新增办公化合同/结算工作台与效率提升方案文档，按“前台像办公工具，后台像业务账本”梳理合同 Word 化、结算 Excel 化、审批稿冻结、付款额度约束、历史接管唯一真相边界和新会话执行提示；ONLYOFFICE、Tabulator、Univer、PDF.js 等外部工具仅作为研究候选或窄边界 POC 方向，任何工程落地必须另行提交技术、安全、授权、部署、回滚和验收方案，不构成生产接入授权。验证：文档空白检查和 `git diff --check` 通过。
- 2026-07-09 (CodeX)：确认并落地 Web Admin UI 治理基线：TDesign 作为唯一基础组件库，新增项目级 `--jg-*` token 命名、`check:ui` 自动检查、合同台账/合同详情/合同模板库三类样板和“同类 UI 第三次出现前必须抽象”的 agent 宪法；本轮保持 `.superpowers/` 工作流 scratch 未入库。验证：Web 组件与样板 Vitest、Web typecheck、Web lint、Web build、`check:ui`、`git diff --check` 通过。
- 2026-07-09 (CodeX)：推送上一轮前端改造与项目花名册提交后，继续推进「建工智管 Web Admin V2 UI 设计方案」落地切片：按 superpowers 既有规格和旁路智能体复核意见，不换 UI 库、不引入低代码运行时；合同工作台新增首屏四问摘要（这是什么合同、卡在哪、缺什么、能做什么）、步骤导航副标题和 query 预填模板入口，概览去除业务首屏版本号；新建合同项目下拉改为读取当前账号具备 `contract.create` 的项目范围；合同模板库拆出“使用模式/配置模式”，一线用户可用已发布模板卡片直接进入新建合同，配置模式仅合同主管和超级管理员可见，模板治理写接口同步加岗位守卫，配置表补模板名称/发布状态列；编号规则页占位符按钮改用 TDesign，并将新增样式收口到 `--jg-*` token。验证：API 项目/模板控制器 Jest 3 套 / 89 例、Web Vitest 36 套 / 264 例、Web/API typecheck、Web/API lint、Web build、`git diff --check` 通过。
- 2026-07-09 (CodeX)：修复 Web 顶栏用户身份显示写死为“合同部主管”的问题，改为显示当前登录账号姓名和真实岗位；新增项目花名册只读模块，后端 `GET /projects/roster` 按当前账号范围返回项目成员姓名、电话和岗位，领导岗位可看全部项目，普通项目成员只看自己参与项目；Web 新增“项目花名册”页面和导航入口。验证：API 项目 Jest 2 套 / 66 例、Web 路由 Vitest 36 套 / 264 例、Web/API typecheck、Web/API lint 通过。
- 2026-07-09 (CodeX)：按用户要求不做最小修复，推进合同工作台与合同模板库重构首轮：新增前端共享错误文案映射，覆盖 `Missing required project role`、`Requires global role`、浏览器 fetch 失败等英文错误；`BusinessActionPanel` 与合同/结算/付款详情动作组只展示当前账号可办理动作；合同清单 Excel 导出隐藏内部字段行并展示中文表头；Word 合同模板脚本转为中文占位符；后端新增合同占位符共享注册表，版式检查和文档渲染共用中文别名；版式模板页、标准条款库、编号规则页、合同文档区去除一批 JSON/内部编号/英文格式文案；文件上传支持类型提示改为中文业务口径；版式模板合同类型改为下拉选择；前端改造方案和 UI 方案补充 RuoYi、RuoYi-Flowable、Yudao、JeecgBoot、Formily、NocoBase、docxtemplater 的借鉴边界。验证：Web 定向 Vitest 36 套 / 264 例、API 模板相关 Jest 5 套 / 67 例、Web/API typecheck、Web/API lint 通过。剩余：模板详情读模型、版式绑定业务模板版本和一线向导式合同工作台仍为 P1/P2。
- 2026-07-09 (CodeX)：恢复生产自动部署：GitHub Actions `Deploy to server` 失败根因是生产服务器 `/opt/jiangkong/scripts/ops/check-runtime-health.sh` 存在已入仓的本地热修补丁，阻塞 `git merge --ff-only origin/main`。已登录 `ubuntu@162.14.116.192` 备份服务器文件到 `/opt/jiangkong/.deploy-backups/20260709010447`，还原阻塞文件并快进到 `7c06949`；补齐服务器本地 `/opt/jiangkong/deploy.sh` 的 API 重启与 Nginx reload 步骤，手动部署成功后重跑失败的 GitHub Actions job，流水线已转绿。验证：生产 Prisma 两条新迁移应用成功，API `active`，`/api/health` 返回 OK，前端 HTTPS 首页返回 200。
- 2026-07-09 (CodeX)：继续推进到前端改造可验收口径「Web 生产构建闸门修复与总复验」：修复系统治理只读配置页从 CommonJS shared-domain 包入口导入运行时字典常量导致 Vite 生产构建失败的问题，改为从本页类型覆盖的 label map 派生岗位和状态字典，并显式导出 shared-domain 角色常量；不改业务字典语义、不改页面展示。验证：Web 全量 Vitest 35 套 / 257 例、Web typecheck、Web lint、Web build、Web E2E lint、Web Playwright P0 冒烟 2 例通过 / 2 例按真实账号环境变量跳过、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续推进改造方案 P0「结算详情错误文案去内部字段化」：结算详情所有动作前置校验从“结算ID不能为空”改为“结算编号不能为空”，避免操作失败时向业务用户暴露内部字段语言；不改接口参数、不改业务状态。验证：合同/结算/付款详情定向搜索无 `结算ID`、`Internal server error`、`Forbidden` 残留，Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续推进到前端改造可验收口径「核心详情页浏览器验收冒烟」：扩展 Web P0 Playwright 冒烟，mock 合同、结算、付款三类详情读模型并逐页验证流程摘要条、后端动作禁用原因、证据文件和关键流程/规则文案可见；使用英文兼容路由进入中文详情页，避免浏览器首屏加载中文路径编码导致路由不匹配。验证：Web Playwright P0 冒烟 2 例通过 / 2 例按真实账号环境变量跳过、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续推进改造方案 P1「付款详情顶部流程摘要条」：付款详情页在原有 meta 面板下新增流程摘要条，复用既有审批状态、实付状态、申请金额、责任部门和下一步动作字段，帮助项目、财务和出纳快速判断付款是否仍在审批、已批待付、待实付或待入账；不改后端读模型、不改业务动作。验证：Web 付款详情定向 Vitest 35 套 / 257 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续推进改造方案 P1「结算详情顶部流程摘要条」：结算详情页在原有 meta 面板下新增流程摘要条，复用既有当前状态、关联合同版本、结算金额、责任部门和下一步动作字段，帮助合同部和项目人员快速判断结算是否可归档、生效和后续付款；不改后端读模型、不改业务动作。验证：Web 结算详情定向 Vitest 35 套 / 255 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-09 (CodeX)：继续推进改造方案 P1「合同详情顶部流程摘要条」：合同详情页在原有 meta 面板下新增流程摘要条，复用既有当前状态、当前版本、合同金额、当前处理人和下一步动作字段，帮助业务人员进页后先看到状态、金额、责任人与下一步；不改后端读模型、不改业务动作。验证：Web 合同详情定向 Vitest 35 套 / 252 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「证据文件卡状态收口」：`EvidenceFileCards` 新增统一证据文件状态视图，已确认/已上传/已入库以成功 tag 展示，待确认或暂不可下载以提示 tag 和不可下载原因展示，并保留“下载需当前密码并记录审计”的审计提示；只改公共 UI 组件，不改后端读模型和下载权限。验证：Web 定向 Vitest 35 套 / 251 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「核心上传限制口径统一」：新增 `file-upload-policy` 上传策略配置，将合同/结算归档、付款凭证和付款 PDF 归档的 accept 属性、支持类型文案、100 MB 大小限制文案收口到统一常量；页面只引用策略，不改后端上传接口、不新增前端替代校验。验证：Web Vitest 34 套 / 249 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「上传成功后清空文件选择」：新增 `file-input-reset` 纯函数，合同/结算归档上传、付款实付凭证和付款 PDF 归档在业务接口成功后同时清空已选文件状态与原生 file input，避免用户误以为旧文件仍待上传；不改后端、不改业务状态流转。验证：Web 定向 Vitest 33 套 / 247 例、Web typecheck、Web lint、`git diff --check` 通过；代码审查无阻断问题。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「付款详情上传状态提示复用」：付款详情的实付凭证和财务归档 PDF 上传区复用 `file-upload-summary`，显示选中文件名、格式化大小、支持类型、大小限制和上传中状态；不改后端、不改实付/归档业务流转。验证：Web 定向 Vitest 32 套 / 245 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「核心详情页上传文件状态提示」：新增 `file-upload-summary` 纯函数，合同/结算详情页在归档上传区显示选中文件名、格式化大小、支持类型、大小限制以及上传中状态；不改后端、不暴露 fileId/COS 地址/对象 key。验证：Web 定向 Vitest、Web typecheck 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「个人列设置扩展到核心台账」：合同、结算、付款三大台账复用个人表格偏好，支持按登录用户保存可见列，自动过滤非法列 key，并强制保留操作列，避免隐藏业务入口；不改变后端数据源、权限或筛选语义。验证：Web Vitest 31 套 / 242 例、Web typecheck、`git diff --check` 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「薄 token 层」首个切片：新增 Web 管理端项目级设计 token，并接入 `BusinessActionPanel`、`EvidenceFileCards`、`ApprovalTimeline` 三个公共业务组件，收口动作区、证据文件卡和审批时间线的高频颜色、字号、间距、圆角；不引入第二 UI 库、不改业务状态流转。验证：Web Vitest 31 套 / 242 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：按用户要求派出多个智能体深度研究 Gitee 参考仓库（RuoYi-Vue、RuoYi-Vue-Plus、RuoYi-Flowable-Plus、JeecgBoot、Soybean Admin）并复核当前 Web UI：确认 Web 管理端依赖层面已统一为 TDesign，未引入第二套 UI 组件库；设计语言已有企业后台倾向但尚无项目级设计 token，颜色/字号/间距仍散落在页面 scoped CSS 中。已将“只借鉴权限/日志治理、任务办理 UX、密集表单和工程纪律；不换底座、不引入 Flowable/低代码运行时、不引入第二 UI 库”的结论融合到前端改造方案、Web Admin V2 UI 设计方案、HTML 可视化方案、README、MVP 源文档、开发规格、页面清单和 Obsidian 当前技术文档。验证：`git diff --check` 通过；文档更新，无业务代码变更。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「个人筛选和列设置」首个可复用切片：新增个人表格偏好工具，支持按用户保存查询词和可见列，自动过滤损坏缓存和非法列 key；全局搜索页已接入个人查询词与列设置保存。验证：Web Vitest 31 套 / 242 例、Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「全局搜索」：新增全局搜索页和工作入口菜单，聚合合同、结算、付款和资料库现有只读台账，支持多关键词检索项目、编号、相对方、状态、文件名和业务关联，结果点击回到原业务页面；不新增写操作或跨权限数据源。验证：Web Vitest 30 套 / 237 例、Web typecheck 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「模块菜单升级为业务过程菜单」：后台侧边栏从平铺模块列表升级为“工作入口、项目资金链、合同过程、结算付款、资料与治理”五组业务过程导航，保留原中文路由与权限过滤；详情页路径会高亮父级菜单，减少台账/详情间迷路。验证：Web Vitest 29 套 / 234 例、Web typecheck 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P2「文件下载审计只读台账」：新增 `/audit-logs/file-downloads` 只读接口，按 `file.download.ticket`/`file.download` 聚合下载票据和实际下载记录，返回操作人、文件名、下载原因、业务对象、IP、追溯 ID 和脱敏说明；审计页新增文件下载审计表与本地筛选，通用审计 trace 对 token、password、secret、下载短链和 COS 地址做脱敏。验证：API 审计 Jest 3 例、Web API/审计配置 Vitest 232 例、API/Web typecheck、API/Web lint 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「字典只读页、配置页」：系统设置页新增业务字典只读页和系统治理配置只读页，集中展示岗位、合同/结算/付款状态、项目支出类型/明细、付款方式、文件用途，以及安全登录、敏感下载、上传限制和通知配置口径；仅展示不编辑，避免普通管理员改坏业务语义。验证：Web Vitest 29 套 / 229 例、Web typecheck 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「敏感文件下载原因」：通用私有文件下载票据新增必填下载原因，原因进入短时效 URL 签名并写入 `file.download.ticket` 与 `file.download` 审计；合同详情、结算详情、付款详情、资料库、合同工作台文档下载和项目支出附件/审批单下载均要求填写原因，空原因在控制器和服务层均不发票据；报销/零星采购专用下载接口同步透传原因。验证：API 文件 Jest 50 例、API 项目支出 Jest 49 例、Web API/敏感动作 Vitest 224 例、API/Web typecheck、API/Web lint 通过。
- 2026-07-08 (CodeX)：按用户确认收窄“先不接 AI，只做导入预检”：历史合同接管新增只读导入预检 API 和 Web 面板，支持粘贴 Excel/CSV 行后校验必填、金额、日期、接管等级、履约状态、系统既有合同编号和批内重复编号；预检结果返回可导入/需修正/warning 明细，不创建合同、不写接管记录、不调用 AI/OCR，并收紧不存在日期和非法历史金额校验。验证：API 合同接管 Jest 13 例、Web API/配置 Vitest 223 例、API/Web typecheck、API/Web lint 通过。
- 2026-07-08 (CodeX)：按用户确认推进 P2「小程序手机号密码登录与移动端直接审批」：小程序新增登录页，使用手机号 + 当前密码调用 `/api/auth/login`，本地保存访问令牌；移动待办未登录自动回登录页；后端 `/me/work-items` 审批待办补 `projectId/businessType/businessId`，并纳入项目支出审批，支持合同、结算、付款、报销/零星采购等项目支出在移动详情页直接通过或驳回；README 更新现场操作口径。验证：API MeService Jest 8 例、API typecheck、API lint、Web typecheck、小程序 JS 语法检查和 JSON 解析通过。
- 2026-07-08 (CodeX)：按用户确认推进外围模块「零星采购完整闭环」：新增 `spot_purchase` 一等项目支出类型、采购类别、采购执行和收货确认字段/迁移；物资员发起、物资部主管 -> 项目经理 -> 财务总监 -> 董事长/总经理审批，审批通过后进入已批待付并生成零星采购审批单 PDF；出纳实付、凭证、财务入账、最终 PDF 归档沿用项目支出安全链路，入账完成后发起人可确认收货；资料库区分报销与零星采购 PDF 留档，Web 项目经营页支持零星采购提交、执行、付款、入账、收货确认状态展示与操作。验证：API 项目支出/控制器/资料库 Jest 50 例、shared-domain 权限 Vitest 56 例、Web API/配置 Vitest 221 例、API/Web typecheck、API/Web lint、Prisma validate 通过。
- 2026-07-08 (CodeX)：按用户确认推进外围模块「报销申请完整闭环」：报销从综合费用子类提升为一等业务类型，审批节点固定为综合部主管 -> 项目经理 -> 财务总监 -> 董事长/总经理；审批通过后进入已批待付并 best-effort 生成审批单 PDF，出纳实付/凭证上传/财务入账沿用项目支出链路，入账覆盖已实付后生成最终归档 PDF；资料库识别报销归档，私有文件下载密钥改为非测试环境强制显式配置，审批/归档 PDF 下载补项目权限与统一不可下载错误；新增数据库迁移放开 `reimbursement` 约束。验证：API 项目支出/文件/资料库 Jest、Web API/配置 Vitest、API/Web typecheck、API/Web lint、Prisma validate 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P2「小程序移动待办、审批、附件查看、拍照上传」最小骨架：新增 `apps/miniprogram` 原生微信小程序目录，包含移动待办列表、待办详情、拍照/相册选择上传附件入口、后端 API 封装和导入说明；未写入真实 appid 或密钥，生产登录绑定和移动审批二次确认规则待后续确认。验证：小程序 JSON 全量解析、JS 语法检查通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P2「审批流配置 UI」安全首版：系统配置页新增审批规则只读配置，展示合同、材料/机械结算、劳务/专业分包结算、付款四类核心审批路线、节点顺序、会签/或签角色和关键业务限制；暂不开放在线编辑，避免改坏生产审批语义。验证：Web Vitest 28 套 / 219 例、Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：开始推进改造方案 P2「跨项目老板视图」：项目经营页为董事长/总经理新增跨项目经营总览，按可见项目汇总项目数、生效合同额、生效结算额、结算可付额、实际收款、已实付、已批待付、可用资金和数据缺口，并提供项目排行切换到单项目明细。验证：Web Vitest 27 套 / 215 例、Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「委托台账增加范围、期限、到期提醒和代某人处理标识」：委托台账新增委托范围、处理标识和到期提醒列，受托人视角显示“代某人处理”，委托人视角显示“某人代我处理”，并按自然日展示今日/明日/N 天后/过期/撤销/未生效状态。验证：Web Vitest 27 套 / 214 例通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「付款详情增加多笔实付、凭证、入账覆盖关系」：付款详情读模型新增实付与入账覆盖清单，按每笔实付展示实付时间、实付金额、付款凭证、已入账、未入账和覆盖状态；前端付款详情新增对应表格。验证：API 付款读服务 Jest、API/Web typecheck、API/Web lint、Web Vitest 26 套 / 210 例通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「结算详情增加可付金额计算明细」：结算详情读模型新增本期结算金额、本期可付金额、已申请付款、已实付金额、剩余可申请和计算说明；后端按本结算付款申请/实付记录计算，前端在结算详情展示金额拆解。验证：API 结算读服务 Jest、API/Web typecheck、API/Web lint、Web Vitest 26 套 / 209 例通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「合同详情增加资金链时间轴」：合同详情在结算与付款区新增资金链时间轴，将关联结算和付款按日期倒序合并展示，突出结算金额、实付金额、累计结算、审批/归档/凭证状态；不改后端金额规则，仅派生既有读模型。验证：Web Vitest 26 套 / 209 例、Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「项目详情页打通合同、结算、付款、资料、审批、审计」：在项目经营页新增当前项目业务入口，按项目跳转合同、结算、付款、资料库、审批中心和审计日志；合同/结算/付款/资料库列表读取 `?project=` 自动填入项目筛选，资料库跳业务归档入口时继承当前项目。验证：Web Vitest 26 套 / 208 例、Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「最近打开 5 个单据」：后台骨架新增最近打开业务单据条，记录合同、合同工作台、结算和付款详情路径，按登录账号隔离浏览器本地记录、去重保留 5 条并过滤非业务详情路径，便于试运行人员在台账与详情之间回跳；本轮不做完整页签缓存。验证：Web Vitest 26 套 / 207 例、Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：继续推进改造方案 P1「资料库治理筛选」：资料库筛选从只读占位变为可用本地筛选，支持项目、资料类型、归档状态、上传部门、治理状态（待确认/可授权下载/不可下载）和关键词；空态改为提示调整筛选或回业务单据补齐附件。验证：Web Vitest 25 套 / 201 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：按用户要求暂挂 P0-5 的备案终审和权限矩阵现场验收，继续推进企业流程系统前端改造方案；新增 `BusinessActionPanel` 统一展示合同/结算/付款详情页的后端动作元数据、可操作状态、禁用原因和密码/意见/文件要求，替换三页重复的禁用原因提示。验证：Web Vitest 25 套 / 200 例、Web typecheck、Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：用户确认 QQ 邮箱收到两封测试邮件，包括完整健康检查失败链路 `JiangKong-runtime-health-failed`；P0 错误告警触达通过。
- 2026-07-08 (CodeX)：已将支持 SMTP 邮件告警的健康检查脚本部署到生产服务器 `/usr/local/bin/jiangkong-healthcheck`，`jiangkong-healthcheck.service` 重启实测 `runtime health ok`，timer 下次运行时间正常。
- 2026-07-08 (CodeX)：已将 QQ 邮箱 SMTP 告警配置写入生产服务器 `/etc/jiangkong/healthcheck.env`（root:root 600，授权码未入仓）；低风险失败测试能触发健康检查失败，但 `smtp.qq.com` 返回 `Login denied`，需用户重新确认 QQ 邮箱 SMTP 服务开启状态并生成新授权码后复测。
- 2026-07-08 (CodeX)：用户提供新 QQ 邮箱授权码后已重新写入服务器并复测；`smtp.qq.com:465`（SSL）和 `smtp.qq.com:587`（STARTTLS）均仍返回 `Login denied`，告警邮件尚未触达，P0 错误告警仍不能勾选完成。
- 2026-07-08 (CodeX)：确认 QQ 邮箱 SMTP 需要强制 `AUTH=LOGIN`；`scripts/ops/check-runtime-health.sh` 新增 `SMTP_LOGIN_OPTIONS` 支持并已部署到生产服务器，`/etc/jiangkong/healthcheck.env` 已配置 `SMTP_LOGIN_OPTIONS=AUTH=LOGIN`。低风险失败测试通过健康检查触发，已无 SMTP 登录错误；待用户确认收件箱实际收到测试邮件。
- 2026-07-08 (CodeX)：错误告警接收通道改为 QQ 邮箱方案；`scripts/ops/check-runtime-health.sh` 已补 SMTP 邮件告警分支，配置项为 `SMTP_URL`、`SMTP_USER`、`SMTP_PASSWORD`、`ALERT_EMAIL_FROM`、`ALERT_EMAIL_TO`，授权码不入仓库；待用户提供 QQ 邮箱 SMTP 授权码后配置服务器并做触达测试。
- 2026-07-08 (CodeX)：生产服务器 `jiangkong-healthcheck.timer` 已启用并每 5 分钟运行；`/usr/local/bin/jiangkong-healthcheck` 已同步为仓库版本，覆盖 health/API 服务状态、磁盘阈值、API warning/error 日志，并通过 systemd drop-in 支持 `/etc/jiangkong/healthcheck.env` 告警配置。当前健康检查实测 `runtime health ok`；尚未配置真实告警接收通道，错误告警触达仍待现场确认。
- 2026-07-08 (CodeX)：用户确认 COS 生产桶版本控制已开启；结合私有读写、空 Policy、无 Everyone 授权、无生命周期删除规则，P0 附件基础备份/误删恢复口径通过。
- 2026-07-08 (CodeX)：人工复核 COS 生产桶 `jiangkong-prod-files-1438687719`（`ap-chengdu`）：存储桶访问权限为私有读写，Policy 权限设置为空，用户权限仅见主账号完全控制，生命周期规则为空；版本控制后续已开启。
- 2026-07-08 (CodeX)：复核 DNSPod 截图，`jgzg.site` 与 `www.jgzg.site` A 记录均已指向 `162.14.116.192`；用户浏览器访问 `https://jgzg.site/api/health` 已返回 `{"status":"ok","service":"jiangkong-api"}`。备案仍在管局审核中，本项改为等待备案终审，不再按 DNS 配置错误处理。
- 2026-07-08 (CodeX)：接入生产服务器 `162.14.116.192` 做 P0-5 生产等价验收：`verify:production-readiness` 全 PASS，seed 用户和 refresh token 已停用，Prisma 27 个迁移为最新，API 重启后健康，IP HTTPS 与安全响应头通过，PostgreSQL 仅本机监听，UFW 仅开放 22/80/443，数据库备份恢复到临时库并校验关键表数量通过；修复运行健康脚本把 `journalctl -- No entries --` 误计为 warning 的问题。生产库 `ContractGeneratedDocument` 当前只有 1 条 `draft/failed`，没有可用于母版验收包的成功草稿。剩余：COS 桶策略、附件备份、错误告警、权限矩阵、合同母版和 Go-Live 仍待现场确认。
- 2026-07-08 (CodeX)：P0 状态复核：本地可验证代码项已收口，P0-1/P0-2/P0-3/P0-7 标记完成；生产等价环境、真实数据、真实账号、合同母版人工签认和 Go-Live 签字仍需现场执行与业务确认。
- 2026-07-08 (CodeX)：补齐历史合同接管资料上传绑定：复用私有文件与 `ArchiveRecord`，支持历史合同扫描件、历史结算台账、历史付款凭证和其他资料绑定到接管记录，Web 详情展示文件卡片。验证：接管 API Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：补齐历史合同接管草稿编辑保存：新增接管 PATCH API，只允许草稿/待补充状态编辑，并同步合同、版本、付款条款和接管余额；Web 接管台账增加编辑入口。验证：接管 API Jest、Web 接管/API Vitest、API/Web typecheck、API/Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：合同/结算/付款列表筛选器从只读占位改为可用筛选：支持项目、来源/合同、状态、归档/实付、付款条款和关键词本地过滤，并补配置单测。验证：Web 全量 Vitest、Web typecheck/lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：更新 P0 浏览器冒烟首页 mock：从旧 `/me/workbench-summary` 改为逐单 `/me/work-items`，并断言真实工作项卡片字段。验证：Web typecheck/lint、P0 Playwright 冒烟 1 passed / 2 skipped、`git diff --check` 通过。
- 2026-07-08 (CodeX)：补齐合同/结算/付款详情审批历史时间线：读侧按业务单据读取最新审批实例和动作日志，映射操作人、动作、节点/角色、意见和时间；前端详情页统一展示审批历史。验证：新增 API helper Jest、API/Web typecheck、API/Web lint、`git diff --check` 通过。
- 2026-07-08 (CodeX)：统一文件证据卡补业务归属和下载审计提示：合同/结算/付款详情文件卡展示当前业务单据，并明确下载需当前密码且会记录审计。验证：Web typecheck/lint 和详情相关 Vitest 通过。
- 2026-07-08 (CodeX)：合同详情归档文件卡片去除上传/确认人硬编码：后端合同详情归档文件返回真实上传人、确认人，前端证据卡直接展示读模型字段。验证：合同读服务 Jest、API/Web typecheck、Web lint 通过。
- 2026-07-08 (CodeX)：详情页辅助动作继续收敛到后端 `availableActions`：合同/结算/付款补审批单、撤回、催办、转审、委托、PDF 生成等 action key，前端按钮不再用本地“有详情即可操作”的布尔值放行。验证：API 读服务定向 Jest、API typecheck、Web typecheck/lint 通过。
- 2026-07-08 (CodeX)：收敛资料库裸上传入口：资料库不再直接 `uploadPrivateFile`，改为跳转到合同归档、结算归档、付款凭证的业务上下文入口，资料库保留查询和授权下载。验证：Web typecheck、Web lint、Web Vitest 通过。
- 2026-07-08 (CodeX)：补齐合同/结算/付款台账 P0 过程字段：读模型返回当前处理人、停留时长、退回原因、下一步动作，Web 列表展示这些字段，并把“详情”链接改成带单据编号的可访问文案。验证：API 读服务定向 Jest、Web 列表配置 Vitest、API/Web typecheck、API/Web lint 通过。
- 2026-07-08 (CodeX)：继续执行企业流程系统前端改造 P0 收口：项目经营代发付款改为业务合同/结算选择器；合同/结算/付款详情和合同工作台清除核心人员 ID 手填，统一使用同项目人员选择器；驳回/退回审批意见后端必填并落审批日志；流程动作展示后端禁用原因；归档确认、审批、实付、入账、敏感下载提交前先校验再复述业务后果二次确认；后台骨架补 skip link、主内容焦点和标题；合作单位附件不再展示 `fileId`。验证：Web typecheck/lint/全量 Vitest、API typecheck/lint/全量 Jest、`git diff --check` 通过。
- 2026-07-08 (CodeX)：按业务确认将常驻审批委托候选人收窄到同项目：`user-options` 只返回当前用户可见项目内的活跃用户，创建委托时后端再次拒绝非同项目目标；不改委托表结构，保留“人到人”常驻委托。验证：API 全量 Jest、API typecheck、API lint、`git diff --check` 通过。
- 2026-07-07 (CodeX)：继续企业流程系统前端改造 P0：codebase-memory full 索引已生成；新增逐单工作项 API/首页消费、审批中心五视图、合同/结算/付款 `availableActions`、资料库行内授权下载、委托人员选择器；按评审修复常驻委托待办/详情按钮、部分付款财务入账与 PDF 归档动作、待确认归档件前后端下载硬拦截、委托审批守卫一致性。验证：API/Web typecheck、API 全量 Jest、Web 全量 Vitest、`git diff --check` 通过。
- 2026-07-07 (CodeX)：瘦身 `PROGRESS.md`，主文件改为驾驶舱；原 311 行详细记录已归档到 `docs/progress/full-history-through-2026-07-07.md`。
- 2026-07-07 (CodeX)：执行企业流程系统前端改造 P0 最小切片：详情文件证据卡、首页三队列工作池雏形、改密/认证错误业务化提示。验证：API/Web 定向测试、typecheck、lint、`git diff --check` 通过。
- 2026-07-07 (CodeX)：形成企业流程系统前端改造方案与可视化方案，结论为“项目容器、单据生命周期、角色待办、附件和审计证据链”。详见 `docs/design/建工智管_企业流程系统前端改造方案_20260707.md`。
- 2026-07-07 (CodeX)：合同详情敏感文件下载改为从当前合同归档件选择，不再手填内部文件 ID；仍保留当前密码二次确认和后端短时效票据。
- 2026-07-07 (CodeX)：排查试运行老板账号登录 401；确认需在目标库显式重置临时密码，并修复 Web 登录失败提示为“手机号或密码错误”。
- 2026-07-06 (CodeX)：完成生产安全、COS/备份/告警脚本、详情项目级读取、Web 详情错误态和 Playwright P0 冒烟收口；现场配置与演练仍需执行留证。
- 2026-07-06 (CodeX)：试运行主线收敛为历史合同接管、3-5 个活跃合同完整链路、合同台账与表单人工签认；ICP/域名等待不阻断内部试运行准备。
- 2026-07-06 (CodeX)：生产部署、强制改密、试运行账号脚本、默认真实项目名、多项目入口、时区稳定性和数据库约束完成多轮修正。

## 上线前闸门

- [ ] 合同母版人工逐页验收：合同部/法务打开最新验收包中的 DOCX，不只看 PDF/PNG。
- [ ] 字体环境：生产/验收服务器安装合同所需中文字体，并用 LibreOffice 实测 DOCX 转 PDF 不发生替换。
- [ ] 生产配置：确认数据库、JWT/Refresh、文件存储、COS、CORS、API 地址、Web 构建环境变量均为生产值且未提交。
- [ ] 数据库上线：执行并记录 `prisma migrate deploy`，确认 PostgreSQL 不公网暴露，备份策略和恢复演练通过。
- [ ] 文件与对象存储：COS 私有桶、后端短时效下载、上传/下载权限、敏感下载二次确认、审计日志在生产环境实测通过。
- [ ] 账号与权限：初始化真实岗位/项目授权，停用或改掉 seed 通用密码，确认合同员/合同部主管能创建草稿并发起审批。
- [ ] DNSPod 凭据：生产服务器证书续期凭据只允许保存在服务器受限路径，不得提交、截图或外传；如暴露必须立即吊销重建。
- [ ] 合同工作台上线验收：生产等价环境跑 `verify:contract-workbench`，重新生成合同母版验收包并抽查四类 DOCX/PDF。
- [~] 基础上线项：HTTPS/域名、反向代理、进程守护、数据库/附件每日备份、恢复演练、服务器时间同步和日志告警已具备；异地备份仍需确认。

## 模块状态

- [x] 企业级合同工作台第一阶段：22 个任务完成，四类合同 live DOCX/PDF 已生成并人工抽查；生产部署、小程序和更完整浏览器矩阵留后续。
- [x] 核心业务闭环：合同草稿、付款条款、审批、用章、归档、生效、结算、付款申请、实付、凭证、财务记录、PDF 归档、审计已成型。
- [~] 审批引擎：实例冻结、会签、或签、撤回、退回、转审、委托、催办已覆盖核心链路；条件节点仍缺显式合同类型字段。
- [x] 认证与授权：手机号密码、微信登录入口、JWT/refresh、强制改密、项目岗位权限、写端点登录态取人已完成。
- [~] 文件/PDF/审计/安全：私有文件、本地/COS 存储、短时效下载、下载原因审计、文件下载审计只读台账、审批单 PDF、水印、敏感二次确认、资料库治理筛选已覆盖主要链路；用户上传原始归档件水印暂不覆盖。
- [~] Web 管理端：企业后台、业务过程菜单、全局搜索、个人筛选/列设置首个可复用切片、合同/结算/付款/资料库/审计、登录鉴权、委托台账范围/期限/代办标识、写操作入口、真实首页逐单工作池、审批中心五视图、列表筛选器、项目业务入口、跨项目老板经营总览、审批规则只读配置、字典/治理配置只读页、合同资金链时间轴、结算可付金额明细、付款实付入账覆盖关系、报销申请闭环、零星采购闭环、历史合同导入预检、详情动作元数据、统一动作状态面板、最近打开业务单据、资料库行内授权下载和下载原因已完成；小程序和生产等价长链路验收仍待收口。
- [~] 小程序移动端：`apps/miniprogram` 原生微信小程序已具备手机号 + 当前密码登录、移动待办列表、待办详情、合同/结算/付款/项目支出直接审批、拍照上传附件入口和 API 封装；真实 appid、体验版发布和真机生产账号验收仍待后续确认。
- [~] 部署上线：HTTPS/域名、生产部署脚本、服务器 API/Web 发布路径已跑通；COS 实配、恢复演练和日志告警已收口，真实数据初始化仍待现场收口。

## 历史归档

- 完整旧版进度记录：`docs/progress/full-history-through-2026-07-07.md`
- 前端企业流程改造方案：`docs/design/建工智管_企业流程系统前端改造方案_20260707.md`
- 前端企业流程可视化方案：`docs/design/建工智管_企业流程系统前端改造可视化方案_20260707.html`
- 认证授权设计：`docs/design/建工智管_认证授权设计.md`
- 当前项目状态报告：`obsidian-current/建工智管_项目状态报告_20260709.md`

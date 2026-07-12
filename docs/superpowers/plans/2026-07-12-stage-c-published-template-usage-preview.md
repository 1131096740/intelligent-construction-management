# Stage C Published Template Usage Preview Plan

**Goal:** 在模板库和合同新建向导中展示最新已发布业务模板的真实冻结结构，不虚构业务场景推荐，也不把未绑定的版式 PDF 冒充所选模板预览。

## Backend

- 增强现有 `GET /contract-templates`：每个模板仍只选最新 published 版本，并从该同一版本返回紧凑 `usagePreview`。
- 预览仅包含字段标签/类型/必填/分组/条件标记，清单名称/金额角色/计价模式/列标签类型与必填，条款标题与必填，附件名称与要求，校验级别与提示。
- 不返回条款正文、内部 key、默认值、`standardClauseVersionId`、`requiredPhrases`、版式文件 ID 或非 published/旧 published 版本内容。
- 保持普通已认证用户只读访问；预览不写审计、不访问私有文件、不触发 Office/COS。

## Web

- 新增跨页面共享 TDesign 只读抽屉，标题明确“业务结构预览（非合同正文/版式 PDF）”。
- 模板库卡片增加“预览模板内容”，抽屉保留“用此模板建合同”；新建合同页在已选模板旁增加“预览所选模板”。
- runtime 对响应白名单与同版本绑定 fail closed；query 预填版本若不属于当前合同类型的最新 published 列表则立即清空。
- 切换类型/模板立即切换或关闭旧预览；预览期间不触发任何 POST/PATCH/下载/密码确认。
- “使用此模板”只携带 exact `contractTypeKey` 与 `templateVersionId`，最终创建继续由后端校验 published 和类型一致。

## Verification

- API：最新 published 同版本绑定、非 published/旧版不泄漏、字段白名单、纯读零审计/文件访问。
- Web：runtime fail closed、共享抽屉复用、切换清理、精确跳转参数、预览零 mutation；focused Vitest 与专项 Playwright。
- 运行 API/Web targeted tests、typecheck、lint、Web `check:ui`/build 与独立复审。

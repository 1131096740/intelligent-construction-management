# 建工智管 Web Admin UI 治理设计

日期：2026-07-09
状态：已由用户逐段确认
范围：Web Admin V2 的设计语言、组件复用、目录规则、项目级设计 token 和自动检查规则

## 1. 目标

本设计用于把 Web 管理端从“页面各自实现”收口为一套可持续维护的企业后台 UI 体系。

目标：

- 遵守当前前端框架官方规范：Vue 3、TypeScript、TDesign Vue Next、Vite。
- 优先复用选定 UI 组件库，不绕开 TDesign 自造基础组件。
- 建立项目级设计 token，统一颜色、字号、间距、圆角、阴影和布局尺寸。
- 明确页面、组件、请求接口、工具函数和样式文件放置规则。
- 用自动检查阻止新增硬编码样式、原生基础控件和重复 UI 继续扩散。
- 用第一批样板页面带动合同、结算、付款、项目、模板等模块逐步收口。

不做：

- 不一次性全站大重构。
- 不引入第二套 UI 组件库。
- 不引入低代码运行时、万能表格或万能表单。
- 不改变合同、结算、付款、归档和权限等业务规则。

## 2. 执行策略

采用方案 B：规则先行、样板先行、分模块推进。

执行方式：

1. 先落设计规格、agent 规则和前端改造文档。
2. 建立项目级 token 和 UI 检查脚本。
3. 选择 2 到 3 个高频样板页面先收口。
4. 后续按业务域分批改造：合同、结算、付款、项目、模板、资料、审计、设置。
5. 改到哪个模块，就把该模块收口到统一规则；不把全站一次性改爆。

## 3. 技术与设计底座

Web Admin 统一使用：

- Vue 3
- TypeScript
- Vite
- TDesign Vue Next
- CSS 变量项目级 token

组件库规则：

- TDesign 是唯一基础 UI 组件库。
- 不新增 Element Plus、Ant Design Vue、Naive UI、Arco、Vben、Soybean 等第二套组件体系。
- 基础控件优先使用 TDesign。
- TDesign 不足时，只能基于 TDesign 和项目 token 封装业务组件。

设计 token 方向：

- `apps/web-admin/src/app/design-tokens.css` 是项目级 token 的唯一入口。
- 页面和业务组件优先使用 `--jg-*` token。
- TDesign 原生组件继续使用 TDesign 官方主题变量。
- 必要时增加 TDesign 主题覆盖，让主色、圆角和字号方向一致。

## 4. 目录规则

页面放置：

```text
apps/web-admin/src/pages/<业务域>/<PageName>.vue
```

页面职责：

- 只做路由级编排。
- 不堆重复 UI。
- 不直接写请求细节。
- 不写可跨页面复用的业务组件。

单业务域组件：

```text
apps/web-admin/src/pages/<业务域>/components/
```

用于只服务当前业务域的组件，例如合同工作台步骤、模板卡片、付款动作区。

跨业务复用组件：

```text
apps/web-admin/src/components/
```

用于超过一个业务域的 UI，例如动作面板、证据文件卡、状态摘要、查询条、业务空态。

接口请求：

```text
apps/web-admin/src/api/<业务域>.api.ts
```

规则：

- 页面不得直接写 `fetch`。
- 页面不得拼 API URL。
- 请求、响应映射和错误中文化统一放在 api 层或已有 HTTP 封装中。

工具函数：

```text
apps/web-admin/src/lib/
```

用于纯函数、格式化、校验、本地存储和与 UI 无关的工具。已经存在同类目录时，优先复用现有位置。

样式与 token：

```text
apps/web-admin/src/app/design-tokens.css
```

规则：

- token 全局唯一。
- 页面 `<style scoped>` 只能引用 `--jg-*` 和 TDesign 变量。
- 新增全局样式必须有明确边界，不允许页面为了方便新增散落全局 CSS。

业务域边界：

- 登录、用户、合同、结算、付款、项目、模板、资料、审计、设置分别归档。
- 跨域能力下沉到 `components`、`api` 或 `lib`。
- 不把多个功能域混在一个页面目录中。

## 5. 组件复用规则

基础 UI 优先使用 TDesign：

- `t-button`
- `t-input`
- `t-select`
- `t-table`
- `t-dialog`
- `t-drawer`
- `t-message`
- `t-alert`
- `t-card`
- `t-tabs`
- `t-form`
- `t-upload`

禁止页面手写以下基础控件：

- 按钮
- 输入框
- 下拉框
- 表格
- 弹窗
- Toast
- Tag
- Tabs
- 导航栏

抽象判断：

同类 UI 结构出现超过 2 次时，必须优先抽象为可复用组件，不允许继续复制粘贴重复实现。

满足以下任意多项时，应抽组件：

- UI 形态相似度高。
- 字段结构相似。
- 操作逻辑相似。
- 在项目里出现第 3 次。
- 改一次样式时希望所有地方同步变化。

业务组件规则：

- 跨模块复用组件放 `src/components/`。
- 单模块内部复用组件放 `pages/<业务域>/components/`。
- 业务组件必须基于 TDesign 和 `--jg-*` token 封装。
- 业务组件不得另起一套视觉体系。

允许使用的原生结构标签：

- `main`
- `section`
- `header`
- `footer`
- `div`
- `span`
- `p`
- `ul`
- `li`

例外：

- 文件输入、富文本编辑器、文档预览区域等 TDesign 暂时无法覆盖的能力可以保留原生或专用实现。
- 例外必须写明原因，例如 `ui-rules-ignore: native-file-input`。
- 例外后续按模块复盘，不永久豁免。

## 6. 设计 Token

项目 token 文件：

```text
apps/web-admin/src/app/design-tokens.css
```

Token 采用薄层设计，只覆盖项目高频视觉语义。

颜色：

```css
--jg-color-bg-page
--jg-color-bg-panel
--jg-color-border
--jg-color-text-primary
--jg-color-text-secondary
--jg-color-brand
--jg-color-success
--jg-color-warning
--jg-color-danger
```

字号：

```css
--jg-font-size-page-title
--jg-font-size-section-title
--jg-font-size-body
--jg-font-size-meta
```

行高：

```css
--jg-line-height-tight
--jg-line-height-body
--jg-line-height-title
```

间距：

```css
--jg-space-xs
--jg-space-sm
--jg-space-md
--jg-space-lg
--jg-space-xl
--jg-space-xxl
```

圆角：

```css
--jg-radius-sm
--jg-radius-md
--jg-radius-lg
```

阴影：

```css
--jg-shadow-none
--jg-shadow-panel
--jg-shadow-overlay
```

布局尺寸：

```css
--jg-layout-page-max-width
--jg-layout-sidebar-width
--jg-layout-header-height
--jg-layout-table-row-height
```

兼容规则：

- 现有 `--jg-bg-page` 等旧 token 暂时保留别名，避免一次性改坏旧页面。
- 新代码统一使用新命名。
- 后续改到某个页面时，把旧硬编码逐步替换成 token。
- 不新增 Sass、Less token。
- 不引入 Style Dictionary。

## 7. 自动检查规则

新增轻量脚本：

```text
apps/web-admin/scripts/check-ui-rules.mjs
```

接入：

```json
{
  "scripts": {
    "check:ui": "node scripts/check-ui-rules.mjs"
  }
}
```

检查范围：

- `apps/web-admin/src/**/*.vue`
- `apps/web-admin/src/**/*.css`

后续可扩展到 `*.ts` 中的样式对象。

必须拦截：

- 原生基础控件：
  - `<button`
  - `<input`
  - `<select`
  - `<textarea`
  - `<table`
  - `<dialog`
- 硬编码颜色：
  - 任意 `#[0-9a-fA-F]{3,8}`
  - `rgb(...)`
  - `rgba(...)`
- 硬编码阴影：
  - `box-shadow: ...`
- 高风险内联样式：
  - `style="color:`
  - `style="background`
  - `style="font-size`
  - `style="border-radius`

允许例外：

- `apps/web-admin/src/app/design-tokens.css` 可以定义颜色、字号、间距和阴影。
- TDesign 官方覆盖样式文件可以少量使用变量映射。
- 原生文件输入等例外必须有 `ui-rules-ignore` 注释。
- 迁移期白名单必须集中在检查脚本顶部，不散落在页面里。

不拦截：

- 结构标签。
- `aria-*`、`role`、语义结构。
- 非视觉业务常量。

检查阶段：

1. 第一阶段：只对新增样板和已改模块严格。
2. 第二阶段：按模块移除白名单。
3. 第三阶段：全量强制。

## 8. 第一批样板

第一批只做 3 个样板页面：

| 样板 | 页面 | 目的 |
| --- | --- | --- |
| 列表页样板 | 合同台账 | 统一查询条、表格、状态标签、行操作和空态，后续结算台账、付款台账、资料库复用。 |
| 详情页样板 | 合同详情 | 统一顶部状态摘要、主信息区、流程区、证据文件区和动作区，后续结算详情、付款详情复用。 |
| 配置页样板 | 合同模板库 | 统一使用/配置模式、配置表格、维护入口和权限提示，后续标准条款、编号规则、版式模板复用。 |

第一批业务组件：

- `BusinessActionPanel`：动作区样板，已有，继续规范化。
- `EvidenceFileCards`：证据文件样板，已有，继续规范化。
- `BusinessStatusSummary`：顶部状态摘要，从详情页提取或新增。
- `BusinessTableToolbar`：查询条和表格工具区，从台账页提取或新增。
- `EmptyBusinessState`：业务空态，新增。

不做：

- 不做万能表格。
- 不做万能表单。
- 不做配置驱动页面生成器。

## 9. 验收标准

设计规格验收：

- 文档写入 `docs/superpowers/specs/2026-07-09-web-admin-ui-governance-design.md`。
- 规则与用户确认内容一致，无未决项。
- 后续实施计划必须从本规格拆解。

第一阶段代码验收：

- `design-tokens.css` 包含新命名 token 和旧 token 兼容别名。
- `check:ui` 可运行，并能拦截新增硬编码颜色和原生基础控件。
- 第一批样板页面通过 typecheck、lint、测试和生产构建。
- 新增或改造 UI 组件均使用 TDesign 和 `--jg-*` token。
- 旧页面迁移白名单有集中记录。

长期验收：

- 合同、结算、付款、项目、模板、资料、审计、设置逐步完成同一设计语言收口。
- 新增页面不再出现散落硬编码视觉样式。
- 同类 UI 第三次出现前必须抽象。
- 页面目录、接口目录、工具目录和组件目录保持可预测。

## 10. 后续步骤

1. 用户审阅本规格。
2. 用户确认后，进入实施计划。
3. 实施计划应按“规则与检查、token、样板组件、样板页面、文档更新、验证”拆分。
4. 每个实施切片都必须更新 `PROGRESS.md` 并通过对应验证。

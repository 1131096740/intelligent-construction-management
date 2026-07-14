# 建工智管《项目设计系统分析报告》

> 审计日期：2026-07-14
>
> 审计对象：`/Users/leoyang/Projects/建工智管` 现有代码与已跟踪设计文档
>
> 重点范围：Vue 3 + TypeScript Web Admin；小程序、API、共享领域包作为架构与业务真实性参照
>
> 审计方式：只读代码知识图谱、目录与静态样式扫描、核心业务链核验、现有治理检查；未修改任何业务代码
>
> 评分口径：基于当前仓库静态实现，不等同于真实用户可用性测试、视觉回归或无障碍认证

---

## 0. 执行摘要

### 0.1 总体判断

当前系统已经跨过“演示后台”阶段，核心合同—结算—付款链条具备明显的企业内控特征：版本、审批、用章、归档、生效、付款额度、实付、入账、凭证和审计均能在界面结构中找到对应位置。项目方向正确，且没有引入第二套 UI 库。

但“业务系统成熟度”明显领先于“Design System 成熟度”。现状更接近：

- 业务真相层：较成熟，核心主线约 **84/100**。
- 页面产品结构：已形成企业后台骨架，约 **74/100**。
- UI 一致性与设计系统执行：仍处于渐进治理阶段，综合 **68/100**。

最核心的问题不是界面不够花哨，而是治理覆盖不完整：项目已有 95 个 `--jg-*` token 和 `check:ui`，但 Web Admin 仍存在 515 处硬编码颜色、75 个不同颜色值；64 个 Vue 文件中有 38 个被 UI 检查整文件白名单豁免。换句话说，规范已经建立，迁移尚未完成。

### 0.2 关键数据

| 指标 | 当前值 | 结论 |
| --- | ---: | --- |
| Web Admin `src` 文件 | 200 | 工程规模已不适合继续依赖页面内约定 |
| Vue 文件 | 64 | 需要稳定的页面模板与组件分层 |
| `pages/` 下 Vue 文件 | 53 | 含 33 个路由页面、领域组件及 1 个无路由占位页 |
| 独立路由页面目标 | 33 | 已覆盖核心企业流程与治理页面 |
| 导航 | 6 组 / 21 项 | 角色过滤存在，信息架构基本成立 |
| 兼容重定向 | 33 | 中英文旧路由兼容充分，但路由文件偏重 |
| 跨域公共 Vue 组件 | 9 | 数量偏少，但已有正确的业务组件方向 |
| 公共组件二次及以上复用率 | 77.8% | 7/9 被至少 2 个生产 Vue 文件引用 |
| TDesign 基础控件出现量 | 约 881 次 | 单组件库策略执行总体良好 |
| 可比基础控件 TDesign 覆盖 | 80.6% | 531 次 TDesign 对 128 次原生控件；关键页仍有遗留 |
| 原生控件 | 128 次 / 约 19 个页面或组件 | 其中 `input` 69、`button` 33、`select` 22、`table` 4 |
| Design Token | 95 个 | 16 个未被 token 文件之外引用；新旧命名双轨 |
| 硬编码颜色 | 515 次 / 75 种 | 颜色治理仍是系统性问题 |
| 超过 1,000 行的页面 | 8 | 页面职责过重，维护与一致性风险高 |
| 最大页面 | 2,877 行 | `ContractTakeoverPage.vue` |
| UI 检查白名单 | 38/64 Vue 文件 | 59.4% Vue 文件绕过视觉/原生控件检查 |
| 图标系统 | 0 个 SVG / 0 个图标组件 | 视觉克制，但缺少统一图标规范和操作识别辅助 |
| 分页组件 | 0 | 真实数据增长后的台账可扩展性不足 |

### 0.3 最优升级策略

不建议整站重写，不建议替换 TDesign，也不建议复制 SAP、Salesforce 或 Ant Design Pro 的视觉皮肤。正确路线是：

1. **P0：先把治理闸门变真**，并统一首页、全局壳层、合同/结算/付款关键页面和敏感操作。
2. **P1：收敛页面模板与大文件职责**，补齐分页、固定表头、列偏好、详情页分段导航和财务确认摘要。
3. **P2：在 Go-Live 后按明确业务重定范围扩展**，采购、报销、移动 Web、签名和高级工作台不得反向挤占当前真实试运行主线。

---

## 1. 项目整体架构

### 1.1 仓库级目录树

以下树忽略 `.git`、`node_modules`、`dist`、测试产物、工作树和本地缓存。

```text
建工智管/
├── apps/
│   ├── web-admin/                         # [核心 UI] Vue 3 企业管理后台
│   └── miniprogram/                       # [移动 UI] 原生微信小程序，当前仅登录/待办/详情
├── services/
│   └── api/                               # NestJS 业务中心，UI 业务真相与权限来源
├── packages/
│   └── shared-domain/                     # 前后端共享角色、权限、状态、金额和读模型
├── docs/
│   ├── design/                            # 产品、架构、UI 与办公化设计文档
│   ├── progress/                          # 历史进度归档
│   └── superpowers/                       # 已跟踪的规格、计划、runbook
├── deploy/                                # Nginx 与部署相关配置
├── scripts/                               # 工作区、运维和校验脚本
├── .github/workflows/                     # CI/CD
├── obsidian-current/                      # 当前 Obsidian 产品真相快照
├── AGENTS.md                              # 项目业务与工程治理规则
├── PROGRESS.md                            # 项目实时进度唯一真相
├── package.json                           # pnpm monorepo 根脚本
└── pnpm-workspace.yaml                    # apps/services/packages 工作区
```

### 1.2 Web Admin 详细目录树与职责

```text
apps/web-admin/
├── public/                                # [Assets]
│   ├── favicon-512.png                    # 站点图标
│   └── images/auth-background.png         # 登录/改密背景
├── scripts/
│   └── check-ui-rules.mjs                 # UI 与业务语言静态治理检查
├── e2e/                                   # P0 浏览器冒烟测试
├── src/
│   ├── main.ts                            # Vue/Pinia/Router/TDesign/token 启动入口
│   ├── env.d.ts                           # Vite 类型声明
│   ├── app/                               # [Layout + Theme + App helpers]
│   │   ├── App.vue                        # 根路由出口
│   │   ├── AdminLayout.vue                # 全局侧栏、顶栏、最近访问、内容区、页脚
│   │   ├── design-tokens.css              # 全局 `--jg-*` Design Token 源
│   │   ├── personal-table-preferences.ts  # 表格列/查询本地偏好
│   │   └── recent-business-routes.ts      # 最近业务路由本地记录
│   ├── auth/                              # [Stores]
│   │   └── auth.store.ts                  # 唯一 Pinia Store：会话、用户、Token、登录/改密
│   ├── routes/                            # [Router]
│   │   ├── index.ts                       # Router、鉴权、改密与标题守卫
│   │   └── route-records.ts               # 路由、导航、角色可见性与兼容重定向
│   ├── api/                               # [API Service]
│   │   ├── http.ts / api-fetch.ts         # 通用请求能力
│   │   ├── core-flow-read.api.ts          # 核心读写接口聚合，当前 1,703 行
│   │   ├── contract-*.api.ts               # 合同工作台/场景/磋商
│   │   ├── settlement-*.api.ts             # 结算工作台/模板
│   │   └── organization.api.ts             # 组织权限
│   ├── components/                        # [跨域 Components]
│   │   ├── ApprovalSelfReviewFields.vue
│   │   ├── ApprovalTimeline.vue
│   │   ├── BusinessActionPanel.vue
│   │   ├── BusinessStatusSummary.vue
│   │   ├── BusinessTableToolbar.vue
│   │   ├── ContractTemplateUsagePreviewDrawer.vue
│   │   ├── EmptyBusinessState.vue
│   │   ├── EvidenceFileCards.vue
│   │   └── SiteFilingFooter.vue
│   ├── lib/                               # [Utils]
│   │   └── money.ts                       # 元/分安全转换与显示
│   └── pages/                             # [Views]
│       ├── home/                          # 首页工作台
│       ├── approval-center/               # 审批中心
│       ├── contracts/                     # 合同台账、详情、工作台、历史接管
│       │   └── workbench/                  # 14 个合同工作台领域子组件
│       ├── contract-templates/            # 模板、版式、条款、编号、场景治理
│       ├── settlements/                   # 结算台账、详情、工作台
│       │   └── components/                # 结算领域组件
│       ├── settlement-templates/          # 结算模板治理
│       ├── payments/                      # 付款台账、详情、工作台
│       ├── projects/                      # 项目经营、项目支出、花名册
│       ├── organization/                  # 组织权限及 4 个领域 Drawer
│       ├── archives/ audit/ search/        # 资料、审计、搜索
│       ├── delegations/ settings/          # 委托、配置
│       └── login/                         # 登录与首次改密
└── package.json                           # Vue/TDesign/Pinia/Router/Vite/Vitest/Playwright
```

### 1.3 用户要求的典型目录映射

| 常见前端目录 | 当前真实位置 | 评价 |
| --- | --- | --- |
| `Components` | `src/components/` | 跨域业务组件位置正确；数量仍少 |
| `Layout` | `src/app/AdminLayout.vue` | 没有独立 `layouts/` 目录，但单壳层足够，不必为目录而迁移 |
| `Views` | `src/pages/<domain>/` | 领域分组清晰，符合现有治理规则 |
| `Router` | `src/routes/` | 路由、导航和可见性集中；兼容重定向较多 |
| `Stores` | `src/auth/auth.store.ts` | 只有认证全局 Store；业务页以局部状态和 API 事实为主 |
| `Utils` | `src/lib/`、`src/app/*.ts`、各领域 `*.config.ts`/`*.state.ts` | 按职责就近放置，优于建立无边界的通用 `utils/` 大杂烩 |
| `Theme` | `src/app/design-tokens.css` | 已有正确入口，但 token 使用率和命名迁移不足 |
| `Assets` | `public/` | 只有认证背景和 favicon；没有 `src/assets/` |

### 1.4 架构优点

- Vue 3、TypeScript、Vite、Pinia、Vue Router 和 TDesign Vue Next 组合稳定，没有第二套 UI 库。
- 页面不直接调用 `fetch`；业务请求集中在 `api/`，符合治理要求。
- 角色过滤同时作用于导航和路由守卫，UI 不单独决定最终权限，后端仍是授权真相。
- `shared-domain` 共享金额、角色、权限、状态与读模型，降低前后端术语漂移。
- 路由以中文业务入口为主，同时保留英文旧路由重定向，迁移安全性较好。
- 合同工作台已经开始领域组件化，证明大型页面可以按业务段拆分，而不需要引入低代码或通用流程引擎。

### 1.5 架构风险

1. `core-flow-read.api.ts` 达 1,703 行，成为 API 聚合单点，合同/结算/付款/项目支出边界逐渐混合。
2. Pinia 只承载认证，项目范围、列表偏好、最近业务、页面草稿分别散在 localStorage 或页面局部状态；当前可用，但缺少明确的“哪些状态允许全局化”规则。
3. 8 个页面超过 1,000 行，页面模板、数据编排、表单、动作和样式常在同一文件内。
4. `AdminLayout.vue` 中真实侧栏为 208px、顶栏为 48px，而 token 定义为 240px/56px，设计规范与运行事实不一致。
5. `RoutePlaceholderPage.vue` 已无生产路由引用，属于可记录的历史残留；本报告不建议在 UI 审计任务中顺手删除。

---

## 2. Design Token 分析

### 2.1 当前 Token 结构

`apps/web-admin/src/app/design-tokens.css` 当前有 95 个 token，分为：

- `--jg-color-*`：背景、文本、边框、品牌和状态颜色。
- `--jg-font-size-*` / `--jg-line-height-*`：字号和行高。
- `--jg-space-*`：4/5/8/10/12/14/16/18/20/24/32 间距。
- `--jg-radius-*`：3/6/8px。
- `--jg-shadow-*`：无阴影、面板、浮层。
- `--jg-layout-*`：侧栏、顶栏、表格行高、详情、工作台等尺寸。
- 兼容别名：`--jg-bg-*`、`--jg-text-*`、`--jg-font-*`、`--jg-brand` 等。

当前 token 的方向正确，但处于“双层命名、旧名使用更广”的迁移态：`--jg-color-*` 等规范名有多项在 token 文件外使用次数为 0，页面主要继续使用别名。

### 2.2 静态使用率

以下数据来自 64 个 Vue 文件的 `<style>` 静态声明扫描：

| 维度 | 声明数 | 使用 `--jg-*`/TDesign 变量 | 约占比 | 结论 |
| --- | ---: | ---: | ---: | --- |
| 颜色/背景/边框色 | 418 | 178 | 42.6% | 已开始治理，但硬编码仍占多数 |
| 间距 | 579 | 210 | 36.3% | 页面节奏主要仍由局部 CSS 决定 |
| 字体相关 | 231 | 55 | 23.8% | 字号和字重缺少语义化收口 |
| 圆角 | 70 | 22 | 31.4% | 取值范围不算混乱，但命名执行不足 |
| 布局尺寸 | 191 | 11 | 5.8% | 绝大多数宽高仍是页面级硬编码 |

补充事实：

- token 文件外有 **515 次硬编码颜色、75 个不同颜色值**。
- 95 个 token 中有 **16 个在 token 文件外无引用**。
- 项目没有任何显式 `font-family` 声明，依赖浏览器/TDesign 继承。
- 没有图标尺寸 token，也没有实际图标组件。

### 2.3 重复与命名混乱

#### 颜色

出现频率最高的硬编码值包括：

| 值 | 次数 | 已有对应 token |
| --- | ---: | --- |
| `#dce1e8` | 66 | `--jg-color-border` / `--jg-border` |
| `#767f8d` | 61 | `--jg-color-text-muted` / `--jg-text-muted` |
| `#fff` | 54 | `--jg-color-bg-panel` / `--jg-bg-panel` |
| `#151922` | 41 | `--jg-color-text-primary` / `--jg-text-strong` |
| `#424955` | 36 | `--jg-color-text-secondary` / `--jg-text-main` |
| `#0052cc` | 15 | `--jg-color-brand` / `--jg-brand` |

同一语义仍出现多组近似值：

- 品牌蓝：`#0052cc`、`#0052d9`、`#165dff`、`#2f6fed`。
- 危险红：`#b51d2a`、`#b42318`、`#c9352b`、`#c9353f`、`#d54941`。
- 成功绿：`#1b6b3a`、`#227245`、`#2ba471`、`#0f7a3b`。
- 背景灰：`#f4f6f9`、`#f6f8fb`、`#f7f9fc`、`#f8fafc`、`#f9fafc`。

问题不在于某个颜色“难看”，而在于同一状态在不同页面的视觉重量不同，用户难以形成稳定识别。

#### 字体

- 12px 硬编码出现 124 次，13px 24 次，24px 14 次。
- 当前设计文档明确 12-14px 为主，这一方向正确；问题是语义没有绑定到 token。
- `600` 和 `700` 字重广泛存在，但没有 `--jg-font-weight-*`。
- 页标题、区块标题、字段标签、辅助文字和表格文字缺少统一的字重/行高组合。

#### 圆角

- `3px` 硬编码 65 次，同时 `--jg-radius-sm` 使用 41 次。
- `8px` 硬编码 13 次，同时 `--jg-radius-lg` 使用 3 次。
- `4px`、`6px`、`999px` 也存在。

现有 3/6/8px 尺度基本合理，建议改为“控件/面板/浮层”的语义命名，避免页面直接判断该用 `sm` 还是 `md`。

#### 间距

现有间距同时包含 5、10、14、18px 这种局部微调值。对于高密度 ERP，可保留 4px 基础网格，但推荐主节奏只使用 4/8/12/16/20/24/32；5px 只作为控件内部垂直补偿，10/14/18 不作为页面布局常规选项。

#### 布局尺寸

- token 侧栏 240px，真实布局 208px。
- token 顶栏 56px，真实布局 48px。
- token 表格行高 46px，但多数 TDesign 表格依赖 `size="small"`，没有统一显式落地。

这类错位比单个颜色更危险，因为设计稿、开发和回归会使用不同基线。

### 2.4 推荐版 Design Token

推荐保留 `--jg-*` 前缀，以“基础值 + 语义值”两层组织；页面只使用语义 token，基础值只供 token 文件内部引用。下面是建议基线，不代表本次直接修改代码：

```css
:root {
  /* Typography */
  --jg-font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
  --jg-font-weight-regular: 400;
  --jg-font-weight-medium: 500;
  --jg-font-weight-semibold: 600;
  --jg-font-weight-bold: 700;

  --jg-font-size-caption: 12px;
  --jg-font-size-body: 13px;
  --jg-font-size-control: 14px;
  --jg-font-size-section-title: 16px;
  --jg-font-size-page-title: 24px;
  --jg-line-height-caption: 18px;
  --jg-line-height-body: 20px;
  --jg-line-height-control: 22px;
  --jg-line-height-section-title: 24px;
  --jg-line-height-page-title: 32px;

  /* Neutral surfaces and text */
  --jg-color-bg-page: #f5f7fa;
  --jg-color-bg-surface: #ffffff;
  --jg-color-bg-subtle: #f7f8fa;
  --jg-color-bg-hover: #f2f3f5;
  --jg-color-text-primary: #16181d;
  --jg-color-text-secondary: #4e5969;
  --jg-color-text-muted: #86909c;
  --jg-color-text-disabled: #c9cdd4;
  --jg-color-text-inverse: #ffffff;
  --jg-color-border-subtle: #f0f1f2;
  --jg-color-border-default: #e5e6eb;
  --jg-color-border-strong: #c9cdd4;

  /* Brand: align with TDesign */
  --jg-color-brand: #0052d9;
  --jg-color-brand-hover: #266fe8;
  --jg-color-brand-active: #003cab;
  --jg-color-brand-soft: #edf4ff;

  /* Semantic states: foreground/background/border as one family */
  --jg-color-success: #216e39;
  --jg-color-success-bg: #f2faf4;
  --jg-color-success-border: #bce3c8;
  --jg-color-warning: #8f4b10;
  --jg-color-warning-bg: #fff7e8;
  --jg-color-warning-border: #f3d19e;
  --jg-color-danger: #b42318;
  --jg-color-danger-bg: #fff2f0;
  --jg-color-danger-border: #f4b8b3;
  --jg-color-info: #0052d9;
  --jg-color-info-bg: #edf4ff;
  --jg-color-info-border: #b9d3ff;

  /* 4px spacing grid */
  --jg-space-1: 4px;
  --jg-space-2: 8px;
  --jg-space-3: 12px;
  --jg-space-4: 16px;
  --jg-space-5: 20px;
  --jg-space-6: 24px;
  --jg-space-8: 32px;

  /* Geometry */
  --jg-radius-control: 4px;
  --jg-radius-panel: 6px;
  --jg-radius-overlay: 8px;
  --jg-radius-pill: 999px;
  --jg-border-width-default: 1px;
  --jg-border-width-emphasis: 3px;

  /* Elevation: normal panels use borders, not shadows */
  --jg-shadow-panel: none;
  --jg-shadow-floating: 0 6px 20px rgb(22 24 29 / 12%);
  --jg-shadow-overlay: 0 12px 32px rgb(22 24 29 / 16%);

  /* Iconography */
  --jg-icon-size-xs: 14px;
  --jg-icon-size-sm: 16px;
  --jg-icon-size-md: 18px;
  --jg-icon-size-lg: 20px;
  --jg-icon-size-xl: 24px;
  --jg-icon-stroke-width: 1.5;

  /* Enterprise layout */
  --jg-layout-sidebar-width: 208px;
  --jg-layout-header-height: 48px;
  --jg-layout-content-padding: 24px;
  --jg-layout-content-padding-compact: 16px;
  --jg-layout-table-row-height: 44px;
  --jg-layout-control-height: 32px;
  --jg-layout-page-max-width: 1440px;

  /* Motion */
  --jg-motion-fast: 120ms;
  --jg-motion-base: 160ms;
  --jg-motion-slow: 240ms;
}
```

### 2.5 Token 迁移规则

1. 先确认真实运行尺寸，再改 token，不允许 token 与壳层继续分叉。
2. 新增/触达文件只允许使用推荐语义 token 或 TDesign 变量。
3. 旧别名保留一个迁移周期；不得继续新增旧别名使用点。
4. 状态颜色必须按前景/背景/边框成组使用，不能只替换文字颜色。
5. 文件、金额、审批、归档等业务组件不得自行发明颜色。
6. `check:ui` 应统计和阻断新增硬编码，而不是依靠大范围文件白名单。

---

## 3. 组件库与复用分析

### 3.1 基础组件库

TDesign Vue Next 是唯一基础 UI 组件库。项目没有本地 `Button`、`Input`、`Select`、`Table` 等基础组件包装层，这是正确选择：不应为了“组件化”再包一层无业务含义的代理组件。

主要 TDesign 使用量：

| 组件 | 出现次数 | 涉及文件 | 评价 |
| --- | ---: | ---: | --- |
| `t-button` | 244 | 46 | 主按钮体系已基本统一 |
| `t-input` | 147 | 39 | 覆盖较广，项目经营与合同子组件仍有原生输入 |
| `t-card` | 93 | 28 | 使用充分，但详情页存在卡片层级过多风险 |
| `t-tag` | 72 | 36 | 状态表达方向正确，状态映射仍需统一 |
| `t-alert` | 62 | 22 | 业务提示较成熟 |
| `t-select` | 61 | 27 | 关键工作台已采用，历史页仍有 22 个原生 select |
| `t-table` | 40 | 25 | 核心台账和明细主力组件 |
| `t-link` | 41 | 19 | 链路跳转和表格操作较一致 |
| `t-textarea` | 25 | 13 | 意见/原因输入已覆盖 |
| `t-dialog` | 14 | 11 | 复杂弹窗使用统一；敏感操作仍绕到浏览器原生弹窗 |
| `t-drawer` | 6 | 6 | 组织、异常、预览等场景使用合理 |
| `t-upload` | 4 | 4 | 新工作台已采用，旧页文件输入仍多 |

### 3.2 原生控件遗留

| 原生标签 | 次数 | 文件数 | 主要集中位置 |
| --- | ---: | ---: | --- |
| `input` | 69 | 16 | 项目经营、历史接管、付款详情、合同编辑子组件 |
| `button` | 33 | 9 | 首页卡片、最近访问、项目经营、合同文档/清单 |
| `select` | 22 | 5 | 项目经营、合同模板编辑、历史接管、合同清单编辑 |
| `table` | 4 | 3 | 项目经营、合同条款/清单编辑 |

原生文件输入、`datetime-local` 有平台合理性；普通文本、按钮、下拉和表格则不应继续保留。尤其 `ProjectOperatingOverviewPage.vue` 同时承载收款、代付、支出、采购执行、实付、入账和收货，原生控件密度最高，是 P0/P1 交界处的重点治理对象。

### 3.3 跨域公共组件清单

| 组件 | 生产 Vue 引用数 | 当前职责 | 评价 |
| --- | ---: | --- | --- |
| `ApprovalSelfReviewFields` | 4 | 自审原因和密码确认 | 复用有效，属于安全业务组件 |
| `ApprovalTimeline` | 4 | 审批节点、处理人、意见和时间 | 复用有效，应继续成为唯一审批时间线 |
| `BusinessActionPanel` | 4 | 展示后端可用动作及禁用原因 | 方向正确，但具体动作区仍在三类详情页重复 |
| `EvidenceFileCards` | 4 | 证据文件、状态与下载信息 | 业务语义明确，复用有效 |
| `SiteFilingFooter` | 3 | 备案页脚 | 壳层级复用合理 |
| `BusinessStatusSummary` | 2 | 业务状态摘要条 | 应推广到结算/付款，当前两页仍手写同类结构 |
| `ContractTemplateUsagePreviewDrawer` | 2 | 模板使用预览 | 合同领域向跨页面复用，位置可接受 |
| `BusinessTableToolbar` | 1 | 台账查询/列设置工具条 | 当前是样板组件，尚未形成真实跨域复用 |
| `EmptyBusinessState` | 1 | 业务空态 | 当前是样板组件，首页等页面仍手写空态 |

复用率口径：

- 至少 2 个生产 Vue 文件引用：7/9，**77.8%**。
- 至少 3 个生产 Vue 文件引用：5/9，**55.6%**。
- 单例公共组件：2/9，**22.2%**。
- 完全未使用：0。

结论：公共组件“质量高于数量”。问题不是组件完全没有复用，而是页面骨架和动作区还没有进入公共层。

### 3.4 领域组件

- `pages/organization/components/` 与 `pages/settlements/components/` 有 5 个规范位置的领域组件。
- `pages/contracts/workbench/` 有 14 个合同工作台子组件，是当前最完整的领域拆分样板。
- 其余大型页面仍多为单文件实现。

### 3.5 重复结构与可抽象候选

静态类名跨文件统计显示：

| 重复结构 | 文件数 | 现状 |
| --- | ---: | --- |
| `page-head` | 26 | 页面头部复制最广 |
| `panel` | 11 | 面板边框、背景和间距重复 |
| `message` | 11 | 成功/失败/提示反馈重复 |
| `section-title` | 10 | 区块标题层级重复 |
| `form-grid` | 9 | 表单布局重复 |
| `workbench-section` | 9 | 合同工作台子区块重复 |
| `field` / `field-label` | 8 | 字段结构重复 |
| `summary-strip` | 7 | 摘要条未统一使用 `BusinessStatusSummary` |
| `filter-bar` | 5 | 台账筛选区重复 |
| `action-group` / `action-title` / `action-fields` | 3 | 合同/结算/付款详情动作区结构高度相似 |

推荐抽象顺序：

1. `BusinessPageHeader`：标题、说明、返回、刷新、主动作、面包屑/业务编号。
2. `BusinessFeedback`：加载、错误、成功、空态，不再手写 `.message`。
3. `BusinessLedgerShell`：摘要、筛选、列设置、表格、分页、空态。
4. `BusinessDetailHeader`：对象状态、版本、责任人、下一步、链路。
5. `BusinessActionGroup`：动作标题、说明、字段和按钮；不吞掉业务判断。
6. `SensitiveActionDialog`：原因、影响说明、密码和二次确认统一承载。
7. `MoneyInput`：用户输入元、内部转换分，统一精度/错误/千分位。
8. `BusinessFileUpload`：文件策略、摘要、重置、状态和证据用途。

不建议：为每个 TDesign 按钮、输入框、卡片再建一层薄包装；这会增加 API 面积而不增加业务价值。

---

## 4. 页面统一性与复杂度分析

### 4.1 复杂度口径

- 低：少于 300 行。
- 中：300-599 行。
- 高：600-999 行。
- 很高：1,000 行及以上。

53 个页面/领域 Vue 文件中：

- 超过 300 行：33 个。
- 超过 500 行：24 个。
- 超过 800 行：10 个。
- 超过 1,000 行：8 个。
- 超过 1,500 行：5 个。
- 最大 10 个文件占全部页面 Vue 代码的 **51.0%**。

### 4.2 全部路由页面用途与复杂度

| 领域 | 页面 | 行数 | 复杂度 | 用途与判断 |
| --- | --- | ---: | --- | --- |
| 认证 | `LoginPage.vue` | 157 | 低 | 登录；认证背景和表单已形成独立视觉面 |
| 认证 | `ChangePasswordPage.vue` | 189 | 低 | 首次强制改密；与登录页结构相近 |
| 工作入口 | `HomePage.vue` | 303 | 中 | 真实待办工作台；当前为三列卡片队列 |
| 工作入口 | `GlobalSearchPage.vue` | 392 | 中 | 合同/结算/付款/资料只读聚合检索 |
| 工作入口 | `ApprovalCenterPage.vue` | 247 | 低 | 审批任务入口，功能轻量 |
| 合同 | `ContractListPage.vue` | 652 | 高 | 合同高密度台账、筛选、列偏好 |
| 合同 | `ContractWorkbenchPage.vue` | 1,837 | 很高 | 合同新建/编辑总编排；已有 14 个子组件但容器仍重 |
| 合同 | `ContractDetailPage.vue` | 1,800 | 很高 | 版本、审批、用章、归档、条款、结算与付款全链详情 |
| 合同 | `ContractTakeoverPage.vue` | 2,877 | 很高 | 历史合同接管、余额、证据、复核、更正一体页 |
| 合同治理 | `ContractTemplateListPage.vue` | 402 | 中 | 模板使用/配置入口 |
| 合同治理 | `ContractTemplateEditorPage.vue` | 873 | 高 | 字段、清单、条款、规则编辑；原生控件较多 |
| 合同治理 | `LayoutTemplateEditorPage.vue` | 645 | 高 | Word/版式模板治理 |
| 合同治理 | `StandardClauseLibraryPage.vue` | 251 | 低 | 标准条款台账 |
| 合同治理 | `ContractNumberRulePage.vue` | 303 | 中 | 合同编号规则 |
| 合同治理 | `ContractScenarioGovernancePage.vue` | 557 | 中 | 业务场景与模板映射 |
| 合作单位 | `BusinessPartyListPage.vue` | 160 | 低 | 合作单位档案列表 |
| 合作单位 | `BusinessPartyEditorPage.vue` | 264 | 低 | 单位资料和附件维护 |
| 结算 | `SettlementListPage.vue` | 526 | 中 | 结算完整台账 |
| 结算 | `SettlementWorkbenchPage.vue` | 1,626 | 很高 | 有效合同选行、Excel 预检、后台核算、人工调整 |
| 结算 | `SettlementDetailPage.vue` | 1,288 | 很高 | 审批、归档、生效、可付额、明细、付款规则 |
| 结算治理 | `SettlementTemplateListPage.vue` | 171 | 低 | 结算模板库 |
| 结算治理 | `SettlementTemplateEditorPage.vue` | 659 | 高 | 结算模板字段、表头和规则治理 |
| 付款 | `PaymentListPage.vue` | 532 | 中 | 付款申请完整台账 |
| 付款 | `PaymentWorkbenchPage.vue` | 589 | 中 | 合同累计结算、单结算、预付款申请 |
| 付款 | `PaymentDetailPage.vue` | 1,371 | 很高 | 审批、实付、入账、凭证、分摊和阻断 |
| 项目 | `ProjectOperatingOverviewPage.vue` | 2,240 | 很高 | 概览、收款、代付、零星支出/采购/报销等混合页面 |
| 项目 | `ProjectExpenseApprovalDetailPage.vue` | 297 | 低 | 支出审批摘要、办理和记录 |
| 项目 | `ProjectRosterPage.vue` | 160 | 低 | 公司岗位/项目岗位花名册 |
| 资料治理 | `ArchiveListPage.vue` | 561 | 中 | 证据资料只读台账和安全下载 |
| 资料治理 | `DelegationListPage.vue` | 305 | 中 | 审批委托台账 |
| 资料治理 | `AuditLogPage.vue` | 515 | 中 | 审计日志和文件下载追踪 |
| 组织治理 | `OrganizationManagementPage.vue` | 1,054 | 很高 | 人员、部门、岗位、项目归属与影响预览 |
| 系统 | `SettingsPage.vue` | 825 | 高 | 个人资料、密码、流程/治理只读配置 |

内部领域组件中，合同文档、清单、条款、合作单位和组织 Drawer 已有明确职责；`RoutePlaceholderPage.vue` 当前无生产路由引用。

### 4.3 统一性优点

- 多数业务页使用“页面头—状态摘要—操作/筛选—主内容”的企业后台结构。
- 合同、结算、付款详情均采用基础信息、流程动作、证据文件、审批时间线、业务账本的顺序。
- 列表页以表格为主，没有滑向营销式 Dashboard。
- 状态、阻塞、下一步动作和责任角色普遍可见。
- 新的结算/付款工作台把“新建”与“管理台账”拆开，职责清晰。

### 4.4 统一性问题

1. **页面头部复制**：26 个文件各自维护标题、说明、按钮与响应式。
2. **反馈组件分裂**：`t-alert`、手写 `.message`、`.state-message`、`.detail-error` 并存。
3. **摘要条分裂**：`BusinessStatusSummary`、`summary-strip`、`flow-summary-strip`、`meta-panel` 多种近似结构。
4. **详情页过长**：核心详情同时展现所有动作和所有账本，缺少锚点/页签式渐进披露。
5. **台账能力不完整**：没有统一分页；固定表头、列偏好和筛选保存只在局部出现。
6. **表单控件分裂**：新工作台以 TDesign 为主，项目经营和部分合同治理仍使用原生控件。
7. **敏感操作体验不统一**：页面有 TDesign Dialog，但下载原因和确认仍大量使用浏览器 `confirm`/`prompt`。
8. **布局 token 与实际不一致**：全局壳层仍硬编码 208/48/24px。

### 4.5 推荐的四类标准页面模板

#### A. 台账页

```text
BusinessPageHeader
CompactSummaryStrip
BusinessTableToolbar（关键词/条件/列设置/重置）
TDesign Table（44px 行高、金额右对齐、操作列固定）
Pagination + EmptyBusinessState
```

#### B. 详情页

```text
BusinessDetailHeader（编号/状态/版本/责任人/下一步）
BusinessStatusSummary
Business chain links
锚点或页签：概览 / 流程 / 资料 / 关联账本 / 审计
BusinessActionPanel + BusinessActionGroup
SensitiveActionDialog
```

#### C. 工作台/编辑器

```text
Page header + 返回台账
前置条件/就绪检查
主体编辑区（可拆领域 section）
异常 Drawer
Sticky footer（后端核算合计、异常数、主提交）
```

#### D. 治理配置页

```text
使用模式 / 配置模式
左侧对象列表或紧凑台账
右侧 Drawer/详情编辑
影响预览 + 权限说明 + 审计结果
```

---

## 5. UI 一致性评分

### 5.1 评分结果

| 维度 | 权重 | 得分 | 主要扣分原因 |
| --- | ---: | ---: | --- |
| 颜色 | 12% | 58 | 515 处硬编码、75 种颜色、同义状态色重复 |
| 字体与字号 | 8% | 61 | 无字体族 token；字体 token 使用率约 23.8%；12px 大量硬编码 |
| 按钮 | 10% | 78 | 244 个 TDesign 按钮是优势；仍有 33 个原生按钮分布在关键页 |
| 圆角 | 6% | 66 | 取值总体克制，但 token 使用率约 31.4%，3px/8px重复硬编码 |
| 间距 | 10% | 62 | 4px 节奏雏形存在；页面级间距 token 使用率约 36.3% |
| 图标 | 5% | 45 | 无图标混用，但也没有图标库、尺寸、描边和操作语义规范 |
| 表格 | 16% | 78 | 40 个 TDesign 表格、金额对齐较好；无分页，仍有 4 个原生表格 |
| 弹窗/抽屉 | 10% | 67 | TDesign Dialog/Drawer 已采用；敏感动作仍使用浏览器确认/输入框 |
| 布局与导航 | 13% | 72 | 6 组角色化导航清晰；壳层尺寸与 token 不一致，最近访问用原生按钮 |
| 状态与反馈 | 10% | 74 | `Alert/Tag/ActionPanel` 基础好；摘要/错误/空态仍有多套实现 |
| **综合** | **100%** | **68/100** | 业务结构成熟，设计系统执行仍不完整 |

### 5.2 评分解释

68 分不是“界面不可用”。它代表：

- 已有正确的组件库、业务语言和企业后台骨架。
- 核心页面比普通 CRUD 后台更专业。
- 但规范无法稳定约束全站，新增和历史代码仍可能继续产生视觉债务。
- `check:ui` 当前通过，只能证明非白名单文件符合规则；不能证明全站统一。38 个 Vue 文件整文件白名单是本轮最重要的治理扣分项。

---

## 6. 企业级产品视角评估

### 6.1 与成熟产品的对照

| 参考体系 | 可借鉴原则 | 当前表现 | 建议 |
| --- | --- | --- | --- |
| SAP Fiori | List Report 与 Object Page 分工、角色化、渐进披露 | 合同/结算/付款已具备对象详情骨架；详情过长 | 详情只预览 10-20 条关联记录，完整账本回台账页；增加锚点/页签 |
| Salesforce Lightning | token、utility、guideline、component blueprint 共同构成系统 | 有 token 和业务组件，但硬编码仍多 | 将 token、页面模板、组件和检查统一成一套可执行规范 |
| Linear | 降低 chrome 噪声，提高层级、对齐与密度 | 整体克制、少装饰；首页卡片和多种摘要条仍有噪声 | 首页改为紧凑工作项表，统一壳层和标题对齐 |
| Notion | 用稳定间距形成可预测节奏，组件组合自然 | 页面内局部节奏尚可；跨页面间距不统一 | 固化 4px 间距网格和页面模板，不靠每页手调 |
| 飞书后台 | 表格承载大量数据，工具区、固定列、操作数量和分页清晰 | TDesign 表格覆盖高；无分页、原生表格仍存在 | 固定操作列、吸顶、分页；行内操作不超过 3 个 |
| Ant Design Pro | PageContainer、路由/服务/模型分层、标准台账与表单模式 | 路由/API/页面分层已存在；缺少统一 Page/Ledger Shell | 借鉴高阶页面容器思想，不引入 Ant Design 组件库 |

参考资料：

- [SAP Fiori Object Page](https://experience.sap.com/fiori-design-web/object-page/)
- [Salesforce Lightning Design System 基础与 Design Token](https://trailhead.salesforce.com/content/learn/modules/lightning-design-system-development-for-designers/get-started-with-slds)
- [Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Notion 页面节奏与间距更新](https://www.notion.com/blog/updating-the-design-of-notion-pages)
- [飞书表格设计规范](https://open.feishu.cn/document/design-specification/component---data-display/table?lang=zh-CN)
- [Ant Design Pro 页面与工程结构参考](https://preview.pro.ant.design/welcome/)

### 6.2 专业度

当前专业度约 **7.3/10**。

专业之处：

- 业务名词准确，审批通过与实际付款明确分开。
- 合同/结算归档后才生效，界面有阻断说明。
- 金额以后端核算为准，结算工作台不提交前端自算总额。
- 文件被视为业务证据，而非普通网盘附件。
- 详情页显示责任人、下一步、版本、证据和审计。

仍显“内部开发系统”的部分：

- 页面文件过大，导致同类结构无法自然统一。
- 原生控件与 TDesign 在同一业务模块并存。
- 浏览器原生确认框出现在敏感业务动作。
- 合同变更金额直接要求输入“分”，不符合财务用户习惯。
- 首页用较高卡片展示逐项待办，信息密度低于真实日常工作池。

### 6.3 信息密度与留白

- **合同、结算、付款台账**：密度方向正确。
- **结算工作台**：高密度但任务清晰，属于“复杂而不混乱”的优秀页面。
- **详情页**：信息完整，但纵向过长；大量卡片连续出现会削弱主次。
- **首页**：每个待办卡最小高度约 142px，信息密度偏低；不适合一天处理几十条事项。
- **项目经营**：一个页面承载概览与多个资金动作，既密又长，属于结构不足而非留白不足。

### 6.4 操作路径

优点：

- 新建工作台与管理台账分开。
- 列表进入详情，详情可以回到业务链路。
- 动作由后端 `availableActions` 驱动，避免只靠前端状态猜测。

问题：

- 导航同时出现“工作台”和“管理”，对新用户需要更清晰的副说明：工作台=新建/办理，管理=查询/详情。
- 合同模板、场景、合作单位均在“合同”组中，主管用户可接受，普通经办仍可能感到入口过多。
- 详情页所有动作平铺，角色可见动作虽有限，但流程辅助、文件、审批、归档仍可能竞争注意力。

### 6.5 过度设计与设计不足

过度设计主要不是视觉装饰，而是页面承载过多：

- 合同/结算/付款详情把对象信息、动作、资料、时间线和多个账本全部平铺。
- 项目经营把概览、收款、代付、支出、采购、实付、入账、收货合并。

设计不足集中在基础能力：

- 页面壳层、标题、反馈、摘要条、筛选区没有完全标准化。
- 台账无分页，详情无长内容导航。
- 金额、日期、文件和敏感确认缺少统一业务控件。
- 采购/报销字段不足以支撑完整企业管理，仅适合零星支出范围。

---

## 7. 首页工作台专项分析

### 7.1 当前结构

当前 `HomePage.vue` 为：

```text
页面标题 + 说明 + 刷新
错误/加载/空态
三列 queue-grid
├── 待我处理
├── 阻塞事项
└── 我发起的进行中
    └── 每条工作项为可点击卡片
        标题 / 金额或数量 / 项目与单号 / 当前节点与停留时间 / 下一步动作
```

优点：

- 使用真实逐项工作项，不是虚假 KPI。
- 三类队列符合经办、阻塞、发起跟踪的业务心智。
- 项目、业务编号、当前节点、停留时间和下一步动作均可见。
- 后端按可见项目范围返回数据，普通账号不会看到无权限项目。

### 7.2 主要问题

1. 三列卡片适合少量事项，不适合真实工作池扩张。
2. 待办和阻塞并列，没有按超时、金额风险、流程阻断排序。
3. 缺少项目范围筛选、业务类型筛选和关键词。
4. 缺少紧凑统计条，用户无法快速判断今日负荷。
5. 整卡可点击，但“下一步动作”只是文本，操作性不够明确。
6. 首页使用原生 `button` 和多组硬编码颜色/圆角/阴影，未进入 token 治理样板。
7. 与既有设计文档定义的“阻塞事项主表”相比，当前实现更像三栏卡片看板。

### 7.3 推荐布局

```text
┌ 工作台 ─ 当前范围：全部可见项目 ─ 搜索 ─ 刷新 ┐
├ 待我处理 12 │ 阻塞 3 │ 待归档 4 │ 待实付 2 │ 超时 1 ┤
├ [待我处理] [阻塞事项] [我发起的进行中] ─ 业务类型/项目/状态 ┤
├ 优先级 │ 类型/单据 │ 项目 │ 当前节点 │ 责任人 │ 停留 │ 下一步 │ 操作 ┤
│ 紧急   │ 付款 FK… │ …   │ 待实付   │ 财务   │ 2天  │ 登记凭证│ 办理 │
│ 高     │ 合同 HT… │ …   │ 待归档   │ 合同部 │ 1天  │ 主管确认│ 查看 │
└ 分页 / 加载更多 / 空态 ─ 最近访问作为低权重辅助 ┘
```

设计原则：

- 首页不做经营大屏，不引入饼图/折线图。
- 摘要条高度控制在 40-44px，不做大 KPI 卡片。
- 桌面表格行高 44px；金额、超时和阻塞用低饱和状态表达。
- 默认优先展示“阻塞+超时”，但不把所有行染成红色。
- 右侧操作列最多一个主动作和一个“更多”。
- “我发起的”保留跟踪语义，不与待办混成同一优先级。

---

## 8. 核心业务页面与企业/财务规范评估

### 8.1 合同

**符合项**

- 合同工作台覆盖基础信息、合作单位、金额计价、清单、付款条款、专业字段、条款和文档。
- 合同详情展示合同版本、付款条款版本、生效流程、审批、用章、归档、结算和付款。
- 合同变更/补充协议不会直接修改当前有效版本；新版本归档确认后替代。
- 历史结算和付款保留原合同版本与付款条款版本引用。
- 归档文件、审批时间线和动作权限与责任角色可见。

**风险与缺口**

- `ContractDetailPage.vue` 1,800 行，动作和账本过多，缺少对象页分段导航。
- 合同变更弹窗要求输入“变更金额（分）”，这是内部存储单位泄漏，财务用户应输入元。
- 合同工作台虽然拆出子组件，容器仍达 1,837 行，数据编排和流程控制偏重。
- 合同模板编辑仍有较多原生控件，和已治理的合同台账视觉不一致。

**结论**

合同产品模型符合真实企业合同管理主线，UI 应重点做“信息分层和金额输入统一”，不需要推翻业务结构。

### 8.2 结算

**符合项**

- 只能从有效合同创建结算。
- 结算工作台基于合同清单选择本期项目，显示合同数量、前期已结算、本期、累计和剩余。
- 普通清单由合同单价自动计价；人工金额必须明确标识。
- 人工调整支持正负金额且原因必填。
- Excel 导入先预检、错误可下载、结果冻结后确认应用。
- 页面明确“不提交自算总额”，后端创建时重新核算并事务复核。
- 详情包含付款比例、账期、发票要求、触发条件和付款状态。

**风险与缺口**

- 页面 1,626 行，导入、选行、异常、调整、粘贴和提交耦合在同一视图。
- 真实工程结算常见的质保金、扣款、税额/含税口径、发票到票、签证/变更依据虽可通过规则和调整表达，但首屏解释不够集中。
- 详情页关联表过长时没有预览上限和“查看全部”。

**结论**

结算工作台是当前产品和 UI 最成熟的页面之一，符合“合同清单事实 + 后端核算 + 证据链”要求。优化应以组件拆分、长页导航和异常解释为主，不应简化业务字段。

### 8.3 付款

**符合项**

- 付款申请支持合同累计结算、单张结算和合同预付款三种来源。
- 可见累计结算、最多可申请、预付款扣回和纳入结算明细。
- 付款审批与实际付款执行严格分开。
- 出纳实付要求金额、时间、密码和付款凭证。
- 财务入账基于实付金额独立记录。
- 详情提供实付覆盖、未入账金额和分摊台账。
- 董事长/总经理或签节点、审批意见、自审确认和凭证审计均有界面支持。

**风险与缺口**

- 付款创建页只有项目、合同、来源、结算、编号和申请金额，缺少提交前的统一付款确认摘要。
- 对真实财务复核，建议显式显示：收款方、账户、开户行、合同/结算来源、付款阶段、到期日、可付额度、已付/待付、发票或附件要求、付款用途。
- 日期时间仍为原生 `datetime-local`，金额输入和日期控件视觉不统一。
- 下载原因、实付、入账等敏感动作仍部分依赖浏览器原生确认。

**结论**

付款的内控模型正确，已经明显优于普通“审批通过即付款”的错误设计。P0 重点应是付款提交确认摘要和敏感动作统一，而不是增加新付款类型。

### 8.4 零星采购

当前能力位于 `ProjectOperatingOverviewPage.vue` 的“资金办理/支出明细”，类型名为“零星采购”，支持：

- 采购事项、预算金额、供应商、付款方式、银行信息、附件/发票、采购用途。
- 审批、采购执行、实付、财务入账和收货确认。

它适合小额、低复杂度、非合同主线的零星采购，但**不等同于完整采购管理**。缺少：

- 采购申请明细行、数量、单价、税率和含税/不含税口径。
- 预算科目/成本中心/项目部位。
- 询价、比价、定标和供应商准入。
- 采购订单、到货数量、验收差异和退换货。
- 订单—收货—发票三单匹配。
- 库存入库、领用和材料结存。

基于当前 Phase 1 边界，正确做法是明确标为“零星采购/项目零星支出”，保持扩展点，不在当前 P0 扩成完整采购模块。

### 8.5 报销

当前“报销申请”与零星付款、借款/备用金、综合费用、零星采购共用一套支出表单。现有字段包括支出单号、类型、付款主体、金额、付款方式、对方银行信息、附件/发票和事由。

这足以形成轻量支出审批，但不足以满足成熟企业费用报销：

- 缺少报销人、所属部门、费用发生日期、出差/项目关联。
- 缺少多行费用明细、费用科目、发票类型/号码/税额和查验状态。
- 缺少借款/备用金冲销、个人垫付与对公付款区分。
- 缺少费用标准、超标原因、预算占用和会计科目映射。
- 单个“附件/发票”无法表达多票据、多明细和票据核验。

因此当前应定义为“项目轻量支出/报销审批”，不能在产品宣传或用户培训中称为完整费用管理。完整报销应在 Go-Live 后单独立项，不应挤占合同—结算—付款主线。

### 8.6 综合业务合规矩阵

| 业务 | 当前成熟度 | 是否适合真实试运行 | 关键 UI 风险 | 当前建议 |
| --- | ---: | --- | --- | --- |
| 合同 | 88/100 | 是 | 长页、金额“分”输入、模板页控件不统一 | P0/P1 收口 UI，不改业务模型 |
| 结算 | 90/100 | 是 | 页面过大、异常与规则解释较分散 | 保持后端核算，拆分视图 |
| 付款 | 86/100 | 是 | 提交确认摘要不足、敏感弹窗不统一 | P0 补财务复核摘要 |
| 零星采购 | 55/100 | 仅限零星场景 | 易被误解为完整采购 | 明确边界，完整采购暂不扩展 |
| 报销 | 48/100 | 仅限轻量支出审批 | 费用/票据/预算字段不足 | Go-Live 后另立规格 |

---

## 9. UI 优化建议

### 9.1 总体风格

目标风格：**企业级、极简、高密度、高效率**。

- 借鉴 Linear 的清晰层级和低视觉噪声。
- 借鉴 Notion 的稳定间距和内容节奏。
- 借鉴 Ant Design Pro 的页面容器、台账和表单组织。
- 保持 TDesign，禁止引入 Ant Design Vue、Element Plus 或第二套图标体系。
- 不做大屏、不做渐变光效、不做彩色 KPI 卡片、不做每个区块一张悬浮卡。

### 9.2 色彩

- 品牌蓝只保留一套，建议对齐 TDesign `#0052d9`。
- 状态色只保留 default/primary/success/warning/danger 五类语义。
- 正常表格行不使用背景色；风险只在状态、数字和左侧小标记上体现。
- 页面背景、面板、悬浮、禁用、边框必须从 token 获取。

### 9.3 字体

- 中文系统字体栈，不新增 Webfont 依赖。
- 主体 13px、控件 14px、辅助 12px、区块标题 16px、页面标题 24px。
- 正文 400，字段/按钮 500，区块标题 600，页面标题 700；避免正文大面积 700。
- 金额使用等宽数字能力或 `font-variant-numeric: tabular-nums`。

### 9.4 布局与留白

- 全局内容区桌面 24px，紧凑页 16px；页面内主节奏 16/20/24px。
- 减少卡片嵌套，普通区块优先“标题 + 分隔线 + 内容”。
- 详情页采用锚点/页签，不把所有账本无限铺开。
- 页面宽度按内容类型控制：表格流式全宽，表单 720-960px，详情最大 1440px。

### 9.5 表格

- 统一 44px 行高，表头吸顶。
- 业务主键/名称固定左侧，操作固定右侧。
- 金额右对齐、数量右对齐、状态居左、日期不强制居中。
- 行内操作最多 3 个；多余操作进“更多”。
- 核心台账必须有服务端分页或明确加载更多策略。
- 列偏好、筛选保存按用户隔离，推广现有合同台账样板。

### 9.6 表单与高风险动作

- 金额统一输入“元”，内部转换为“分”。
- 日期、日期时间、上传和密码确认统一为 TDesign/业务组件。
- 高风险动作统一 Dialog：影响说明、原因、密码、最终按钮一次完成。
- 不再使用浏览器 `confirm`/`prompt` 承载审批、归档、实付、下载或接管确认。
- 付款提交前必须显示不可编辑的收款与额度确认摘要。

### 9.7 图标

- 只在导航、刷新、搜索、筛选、展开、下载、上传、更多、警告等高识别场景使用。
- 使用与 TDesign 匹配的单一图标来源。
- 默认 16/18px、描边 1.5；不为每个菜单强行配彩色图标。
- 图标永远配合可访问文本或 `aria-label`，不作为业务状态的唯一表达。

---

## 10. 分阶段 UI 升级路线图

### 10.1 P0：真实试运行主线收口

目标：不扩模块，降低合同—结算—付款的操作错误和视觉漂移。

| 工作项 | 范围 | 验收口径 |
| --- | --- | --- |
| Design Token V2 定稿 | 颜色、字体、间距、圆角、布局、图标 | 壳层尺寸与 token 一致；关键页无新增硬编码 |
| 收紧 `check:ui` | 取消整文件大白名单 | 38 个 Vue 白名单降至不超过 10 个；例外只允许文件/日期等平台能力且就近注释 |
| 全局壳层统一 | `AdminLayout`、最近访问、页头 | 无原生按钮；208/48/24 使用 token；选中、hover、focus 一致 |
| 首页工作台改为紧凑工作项表 | `HomePage` | 保留三队列语义；增加摘要/筛选；44px 行高；阻塞/超时可排序 |
| 核心详情摘要统一 | 合同/结算/付款 | 统一 `BusinessStatusSummary`、页面头和链路区 |
| 敏感动作统一 | 审批、归档、下载、实付、入账 | 不使用浏览器原生确认/输入；原因+密码+影响同一 Dialog |
| 金额输入修正 | 合同变更、付款、支出 | 用户只输入元；展示千分位；内部安全转分 |
| 付款提交确认摘要 | `PaymentWorkbenchPage` | 收款方、账户、来源、阶段、额度、申请金额、附件要求可复核 |
| 零星采购/报销边界文案 | 项目经营 | 明确“零星/轻量”，不暗示完整采购或费用系统 |

P0 不做：全站换肤、暗色模式、完整采购、完整报销、经营大屏、第二组件库、路由重写。

### 10.2 P1：页面模板与可扩展性

目标：让业务增长不再线性增加页面复制和大文件。

| 工作项 | 重点 |
| --- | --- |
| 四类页面模板落地 | 台账、详情、工作台、治理配置 |
| 大文件拆分 | 优先 `ProjectOperatingOverview`、`ContractTakeover`、三类详情页 |
| API 领域拆分 | 将 `core-flow-read.api.ts` 按 contract/settlement/payment/project 分域 |
| 台账可扩展能力 | 服务端分页、固定表头、固定操作列、列偏好、筛选保存 |
| 详情渐进披露 | 锚点/页签；关联记录预览 10-20 条并“查看全部” |
| 业务字段组件 | MoneyInput、BusinessFileUpload、SensitiveActionDialog、EntitySelect |
| 项目经营拆视图 | 概览、收款/代付、零星支出台账职责分离，但保持路由兼容 |
| 图标与快捷操作 | 单一图标源；搜索、刷新、筛选、下载等固定语义 |

量化目标：

- 超过 1,000 行的路由页面从 8 个降至不超过 3 个。
- 核心台账 100% 有分页或明确加载更多。
- 核心页面普通原生 `button/select/table/text input` 清零。
- 触达页面硬编码颜色清零；全站硬编码颜色显著下降。

### 10.3 P2：Go-Live 后增强

目标：在真实使用数据证明价值后扩展，不提前建设大而全平台。

- 按批准规格实施移动 Web 外壳和手写签名。
- 首页支持角色自定义视图、常用筛选和快捷键，但不做自由拖拽大屏。
- 基于真实数据优化跨项目经营分析；图表只服务明确决策。
- 采购、报销、发票、预算和三单匹配单独做产品立项、数据模型和权限评审。
- 进一步完善 Design Token 文档、Figma 变量映射和视觉回归基线。
- 根据无障碍测试补充键盘、焦点、对比度和屏幕阅读器支持。

---

## 11. Design System 治理机制建议

### 11.1 规范层级

```text
Business rules / shared-domain
          ↓
Page patterns（Ledger / Detail / Workbench / Governance）
          ↓
Business components（Action / Evidence / Timeline / Summary）
          ↓
TDesign base components
          ↓
Design tokens + accessibility + UI checker
```

页面不能绕过业务组件自行决定审批、归档或付款状态；业务组件也不能绕过 TDesign 建立第二视觉系统。

### 11.2 变更门禁

每个 UI 变更至少满足：

1. 使用现有页面模板或说明为什么需要新模式。
2. 不新增整文件白名单。
3. 不新增硬编码颜色、阴影、字号和圆角。
4. 不新增普通原生基础控件。
5. 金额、权限、状态、归档和审计仍以后端事实为准。
6. 定向 Vitest、`typecheck`、`lint`、`check:ui` 通过。
7. 核心页面在 1440、1280、1024 和目标窄屏做截图回归。
8. 真实业务动作验证空态、加载、失败、无权限、禁用和成功状态。

### 11.3 `check:ui` 改进方向

当前检查能发现原生控件、硬编码颜色、阴影和高风险内联样式，也有自测；问题是整文件白名单过大。

建议：

- 白名单改为“具体规则 + 具体行附近注释”，不豁免整个文件。
- 对硬编码尺寸增加分级：先治理颜色/字体/圆角，再治理布局尺寸。
- 输出统计而非只输出 pass/fail：新增硬编码、白名单数、原生控件数、token 使用率。
- CI 采用基线不回退模式：历史债务可逐步减少，但任何提交不得增加。
- 将首页、全局壳层、合同/结算/付款核心页面列为无豁免关键面。

---

## 12. 最终结论

建工智管当前最有价值的不是某个视觉风格，而是已经把施工企业合同、结算、付款、实付、凭证和审计关系做成了可见的业务链。UI 升级必须保护这条链，不能为了“更现代”把台账改成卡片墙、把复杂规则藏掉，或引入第二套组件库。

推荐的最终设计方向可以概括为：

> 前台像 Linear/Notion 一样克制、清晰、快速；页面组织像 SAP Fiori/Ant Design Pro 一样稳定；表格和协作体验接近飞书；业务事实、权限和审计仍由建工智管自己的后端账本决定。

当前最优先的不是再写一份视觉规范，而是把已有规范变成真正覆盖首页、壳层和核心业务页的自动门禁。完成 P0 后，系统的 UI 一致性有条件从 68 分提升到约 80 分；完成 P1 页面模板和可扩展能力后，可进入 85 分以上的稳定企业级区间。

---

## 附录 A：本次审计证据范围

- `PROGRESS.md`
- `AGENTS.md`
- `docs/design/web-admin-v2-enterprise-ui.md`
- `docs/design/建工智管_企业流程系统前端改造方案_20260707.md`
- `docs/design/建工智管_办公化合同结算工作台与效率提升方案_20260709.md`
- `docs/superpowers/specs/2026-07-09-web-admin-ui-governance-design.md`
- `apps/web-admin/src/` 全量文件清单、Vue 页面、路由、组件、token 和样式统计
- 合同、结算、付款、项目支出前端页面及其共享读模型/API 关系
- `pnpm --filter @jiangkong/web-admin check:ui`：当前执行通过

## 附录 B：审计限制

- 未使用真实生产账号执行完整浏览器走查，因此本报告不对真实数据密度、网络延迟和岗位操作时长作定量结论。
- 未修改任何代码、样式、路由、数据库、生产数据或部署配置。
- 采购与报销评价以当前页面字段和 Phase 1 边界为准，不代表建议在当前阶段扩展完整模块。

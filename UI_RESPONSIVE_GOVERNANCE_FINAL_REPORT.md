# 建工智管 Web Admin 响应式治理最终回归报告

> 更新日期：2026-07-14
>
> 分支：`codex/ui-responsive-governance`
>
> 治理基线：`87a5b582621e41baaf699d21009906be67c03907`
>
> 状态：阶段 0–7 已完成，待阶段 8 发布候选审计

## 1. 最终结论

本轮已在现有 Vue 3 + TypeScript + TDesign Vue Next 设计系统内完成 Web Admin 响应式与横向滚动治理，没有改变业务逻辑或建立第二套视觉系统。

- 普通 Flow/Detail 页面按实际内容容器宽度重排，不依赖整页横向滚动。
- Ledger 页的页头、摘要、筛选、反馈和分页留在页面流中，仅数据表区域横向滚动。
- 合同模板、合同清单、文档画布、历史接管、结算选行和模板检查等 Workspace 保留业务可读最小宽度，仅专业区内部滚动。
- 主内容壳层横向滚动只保留给小于 720px 的最终兜底；本次 900px 及以上六档桌面窗口均未触发文档根横向溢出。
- 浏览器断言未发现父子嵌套横向滚动条、页面运行错误或因窄屏隐藏业务字段。

## 2. 分阶段落地结果

| 阶段 | 范围 | 核心结果 |
| --- | --- | --- |
| 0 | 只读审计与主计划 | 建立 34 个顶层页面矩阵、三类响应式模式和阶段门禁 |
| 1 | Design Token、AdminLayout、共享组件 | 建立内容容器断点、台账/专业区最小宽度和共享滚动语义 |
| 2 | 合同模板治理 | 模板台账、十列编辑器、编号规则、业务场景、版式和条款库按模式治理 |
| 3 | 合同工作台、历史接管 | 主侧区按容器切换；清单、画布、预检和接管台账各自局部滚动 |
| 4 | 结算工作台、结算模板 | 1680px 结算选行保持业务列宽；模板检查/预览与台账建立独立边界 |
| 5A | 审批、资料、审计、委托、搜索 | 五类业务台账统一为数据区滚动 |
| 5B | 往来单位、花名册、组织权限 | 主数据表、组织三表及 Drawer 影响表按各自边界滚动 |
| 6 | 表单、费用详情、项目概览、设置 | 普通页面渐进降列；项目经营宽表在各自页签内局部滚动 |
| 7 | 全站回归 | 33 个有效路由页面六档验证，补齐认证页与 4 个模板治理子页面 |

## 3. 页面与路由覆盖

主计划清点的 34 个顶层页面中：

- 33 个当前存在活动路由的页面均已通过阶段定向或阶段 7 六档浏览器回归。
- `RoutePlaceholderPage.vue` 当前没有活动路由；路由测试明确验证主页不再落入占位页。本轮只做静态结构复核，没有为截图修改受保护路由或重新接回废弃入口。
- 阶段 7 额外补齐 `ContractNumberRulePage.vue`、`StandardClauseLibraryPage.vue`、`ContractScenarioGovernancePage.vue`、`LayoutTemplateEditorPage.vue` 六档浏览器覆盖。

## 4. 滚动所有权验收

| 页面模式 | 唯一横向滚动所有者 | 明确不参与横滚的内容 |
| --- | --- | --- |
| Flow / Detail | 默认无；关联宽表存在时仅表格内容区 | 页头、事实、表单、反馈、主操作 |
| Ledger | `.t-table__content` | 页头、统计、筛选、错误、分页和空态 |
| Workspace | `.jg-workspace-scroll` 或指定 TDesign 表格内容区 | 页面标题、保存/提交、业务规则、反馈和就绪检查 |
| AdminLayout | 仅小于 720px 的最后兜底 | 侧栏、顶栏、最近访问和页脚 |

六档浏览器断言结果：

- 文档根横向溢出：0。
- 父子嵌套且同时可滚动的横向容器：0。
- 页面脚本错误：0。
- 页头或主操作被局部横滚带走：0。
- 因窄屏隐藏业务字段：0。

## 5. 阶段 7 实际修改文件

- `apps/web-admin/e2e/ui-p0-visual.e2e.ts`
- `apps/web-admin/e2e/ui-p1-contract-visual.e2e.ts`
- `apps/web-admin/e2e/ui-p1-settlement-visual.e2e.ts`
- `apps/web-admin/e2e/auth-responsive-regression.e2e.ts`
- `apps/web-admin/e2e/contract-template-supplemental-responsive.e2e.ts`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_GOVERNANCE_FINAL_REPORT.md`
- `PROGRESS.md`

阶段 7 没有修改业务页面、组件、API、路由或业务实现；只扩展六档回归、截图和治理文档。

## 6. 测试结果

| 检查 | 结果 |
| --- | --- |
| Web 全量 Vitest | 84 个文件，626/626 通过 |
| Web build | 通过；保留既有大于 500 kB chunk 提醒，不是本轮新增失败 |
| `typecheck` | 通过 |
| `lint` | 通过 |
| `check:ui` | 通过 |
| 合同模板补充 Playwright | 1/1 通过 |
| 全量 `test:e2e:p0` | 32/32 通过；2 条按既有配置条件跳过，0 失败 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

内置浏览器会话被当前环境的首次改密门禁限制。本阶段没有使用真实账号、绕过认证或修改数据，而是按主计划回退到项目现有 Playwright 能力，使用稳定 Mock/隔离数据完成浏览器验证。

## 7. 截图结果

统一根目录：

`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance`

| 目录 | 数量 |
| --- | ---: |
| `r0-foundation` | 6 |
| `r1-contract-templates` | 12 |
| `r2-contract-workspace` | 12 |
| `r3-settlement-workspace` | 18 |
| `r4-ledger-stage5a` | 30 |
| `r4-ledger-stage5b` | 20 |
| `r5-form-detail` | 30 |
| `r6-final-auth` | 12 |
| `r6-final-contract` | 25 |
| `r6-final-contract-template-supplemental` | 24 |
| `r6-final-p0` | 28 |
| `r6-final-settlement` | 17 |
| **合计** | **234** |

每类目标页面均覆盖 1512×982、1440×900、1280×800、1180×820、1024×768、900×768。截图数据全部来自稳定 Mock 或隔离测试数据，没有读写生产业务数据。

## 8. 红线复核

以下目录相对治理基线 diff 为空：

- `services/api`
- `packages/shared-domain`
- `apps/web-admin/src/api`
- `apps/web-admin/src/routes`

本轮没有数据库迁移，没有修改 API、路由、权限、业务状态、审批逻辑、金额计算、元分转换、上传规则、发布/停用/归档逻辑，也没有引入组件库、动画、渐变、玻璃拟态或装饰性阴影。

## 9. 保留事项

1. `RoutePlaceholderPage.vue` 没有活动路由，因此不存在浏览器可达路径；这是路由现状，不是响应式缺陷。
2. 构建仍提示既有单个 chunk 大于 500 kB；本轮没有扩依赖或改打包策略，建议在独立性能任务中评估，不能与响应式治理混改。
3. 两条 P0 E2E 由既有环境条件控制而跳过；其余 32 条全部通过，没有测试失败。

## 10. 下一步与回滚

下一步只执行阶段 8 发布候选审计，形成目标 SHA 和提交清单后停止。未经用户明确批准目标 SHA，不推送 `main`、不部署生产、不进行生产写入或数据库迁移。

如需回滚，按本轮各阶段提交从新到旧执行 `git revert <sha>`。阶段 1 是后续页面的公共依赖；若回滚阶段 1，必须连同阶段 2–7 逆序回滚，避免保留半套类名或共享 CSS。

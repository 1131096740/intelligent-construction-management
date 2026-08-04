# 五包阶段 D：C-P1-02 模板治理只读隔离回执

## 1. 结论

`C-P1-02` “合同/版式/条款/编号/场景/结算模板治理”已在唯一候选工作树完成首次上线只读隔离。阶段 C 登记的 37 个未覆盖生产 mutation pair 已全部从生产页面不可达；只保留已发布版本的查看、选用和业务消费。

整站能力矩阵仍为 `blocked`：442 条 Nest 路由中 0 条未分类，仍有 12 个未覆盖生产 mutation pair、0 个 unresolved binding 和 99 个整站 matrix blocker。剩余 12 个 pair 已精确对账为 `C-P1-03` 的 11 个和 `C-P1-04` 的 1 个；阶段 D、Task 11、实施包 5 和五包整体均未完成。

本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署。

## 2. 首次上线只读边界

- 合同模板库只列出已发布模板，保留模板内容预览与“用此模板建合同”。
- 合同模板、版式模板和结算模板详情只展示 `published` 版本；新建静态路由也进入同一只读页并明确不可新建。
- 标准条款只读取已发布条款；编号规则只展示已启用规则；场景映射只展示已有映射与已发布合同模板。
- 新建、克隆、编辑、上传、检查、预览生成/下载、提交、发布、停用和草稿处置入口均从生产路由可达面移除。
- 7 个新页面统一显示“上线准备期间暂为只读”，明确这是首次上线隔离，不冒充最终治理能力完成。

旧编辑页、API wrapper 和后端路由仍保留在仓库中，但不再被生产 router 引用。本组有 40 条路由失去生产消费证据，仅在 route usage registry 中标为 `exit_candidate`，且语义锁定为 `candidate_only_no_deletion_authorization`；未授权 Task 12 退出或任何物理删除。

## 3. 自动化隔离证明

新增结构门覆盖以下失败关闭条件：

- 9 个生产路由记录必须指向 7 个新只读页，不得再引用 7 个旧治理/编辑页。
- 新只读页必须全部显示上线准备期间只读提示，且不得引用 36 个模板治理 mutation wrapper 或通用上传。
- 合同、条款、版式、场景、编号和结算模板的必要读 wrapper 仍然存在，“只允许已发布版本”不是纯文案，而是由读 API 或页面状态过滤实际执行。

TDD RED 阶段新结构门 3/3 失败；最小实现后，目标 Web 14 文件 137/137 通过。旧页源码与其历史测试保留，以便后续终态治理；它们不再构成生产可达证据。

## 4. 分析器一致性修复

只读路由隔离暴露了三个原有的清单联动缺口，均以失败用例后的最小修复关闭：

1. 整站矩阵现在与 Web wrapper 清单一致区分 `test_only`、`unreachable_only` 和 `unreferenced` orphan，不再把仅被不可达旧页引用的 wrapper 误分类。
2. 整站矩阵只统计仍有生产 consumer 的下载票据 follow-up，不再把不可达结算模板预览下载当作生产证据。
3. 合同专项矩阵 CLI 现在调用实时 Web 可达性分析结果，仍会在退出候选重新获得真实生产 consumer 时失败关闭，但不再因仓库中保留的不可达旧页误报。

两个旧停用动作的 page-action registry 条目已同生产路由一起移除；其后页面动作清单无 stale registry、unresolved wrapper 或 unresolved action。

## 5. 矩阵对账

| 项目 | C-P1-01 后 | C-P1-02 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 442 | 442 | 0 |
| Web wrappers / bindings | 432 / 452 | 432 / 452 | 0 |
| production mutation consumer pairs | 282 | 243 | -39 |
| covered production mutation pairs | 233 | 231 | -2 |
| uncovered production mutation pairs | 49 | 12 | -37 |
| orphan wrappers | 42 | 81 | +39 |
| page / exit-candidate routes | 330 / 48 | 290 / 88 | -40 / +40 |
| unclassified routes | 0 | 0 | 0 |
| unresolved action bindings | 0 | 0 | 0 |
| raw matrix blockers | 97 | 99 | +2 |

39 个生产 mutation pair 中，37 个是阶段 C 登记的未覆盖目标，另 2 个是原已覆盖的合同模板/版式模板停用动作。raw blocker 增加 2 是预期结果：39 个生产 pair 被隔离后，对应的 39 个 wrapper 转为 orphan，其中 74 个整站 orphan 为 `test_only`、6 个为 `unreachable_only`、1 个为 `unreferenced`。这些属于 P2/Task 12 最终治理证据，不影响首次上线只读隔离，但不能据此把 Task 11 标记为完成。

## 6. 验证回执

- Shared Domain：15 文件 151/151。
- API 合同/版式/场景/结算模板域：10 套，217 passed、4 skipped；既有服务端发布、版本、检查、并发和文档不变量保持通过。
- Web 模板治理域：14 文件 137/137；新只读结构门 3/3。
- 能力清单与矩阵分析器：7 文件 228/228。
- API/Web typecheck、lint 通过；API/Web production build、Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；Web/Page/整站矩阵按设计保留 P1/P2 blocker，route usage 为 ready。
- `git diff --check` 通过。

本组没有 Schema、迁移或后端业务实现变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重跑数据库、四岗位浏览器、公安备案和运维安全总门；本地结构测试不能替代最终上线证据。

## 7. 下一步与授权边界

下一步严格执行 `C-P1-03`：隔离组织部门/用户/岗位赋权与审批委托的 11 个未覆盖生产 mutation pair。其后执行 `C-P1-04` 复制已放弃合同草稿的 1 个 pair。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

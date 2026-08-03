# 五包阶段 D：C-P1-01 主数据只读隔离回执

## 1. 结论

`C-P1-01`“主体与相对方主数据”已在唯一候选工作树完成首次上线只读隔离。阶段 C 登记的 6 个未覆盖生产 mutation pair 已全部从生产页面不可达；主体和相对方的查询、选择、详情、历史版本与既有附件事实仍可读取。

整站能力矩阵仍为 `blocked`：442 条 Nest 路由中 0 条未分类，仍有 49 个未覆盖生产 mutation pair、0 个 unresolved binding 和 97 个整站 matrix blocker。剩余 49 个未覆盖 pair 精确对应 `C-P1-02` 至 `C-P1-04`；阶段 D、Task 11、实施包 5 和五包整体均未完成。本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署。

## 2. 首次上线只读边界

- 我方公司主体台账保留列表查询、状态筛选和不可覆盖的历史版本查看；移除新增、编辑、启用和停用的生产页面触发器。
- 合作单位台账保留名称/统一社会信用代码查询和详情导航；移除新增档案入口。
- 合作单位详情保留当前资料、版本历史与既有附件事实展示；移除新增版本和附件上传入口。
- 三个页面均显示“上线准备期间暂为只读”，明确这是首次上线隔离，不冒充最终能力完成。
- 页面路由和读 API 保留；直接访问仍经过既有全局认证、服务层岗位与业务权限校验。

本组没有删除 API wrapper 或后端路由。失去生产消费者的 5 条后端写路由只在 route usage registry 中标为 `exit_candidate`，且语义锁定为 `candidate_only_no_deletion_authorization`：

1. `POST /company-entities`
2. `PATCH /company-entities/:id`
3. `POST /company-entities/:id/status`
4. `POST /business-parties`
5. `POST /business-parties/:partyId/versions`

相对方附件原先复用的通用 `uploadPrivateFile` 已从该页面移除，但该 wrapper 仍有其他生产消费者，未被误标为退出候选。

## 3. 自动化隔离证明

新增结构门覆盖以下失败关闭条件：

- 主体页面必须保留管理查询和历史抽屉，同时不得引用表单抽屉、敏感操作对话框或三类写 wrapper/触发函数。
- 相对方列表必须保留查询，同时不得引用新增 wrapper 或创建触发器。
- 相对方详情必须保留读取和历史，同时不得引用版本新增、通用上传、文件输入或相应触发器。

TDD RED 阶段新结构门 3/3 失败；最小实现完成并调整既有响应式/配置断言后，目标 Web 4 文件 18/18 通过。

## 4. 矩阵对账

| 项目 | C-P0-07 后 | C-P1-01 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 442 | 442 | 0 |
| Web wrappers / bindings | 432 / 452 | 432 / 452 | 0 |
| production mutation consumer pairs | 288 | 282 | -6 |
| covered production mutation pairs | 233 | 233 | 0 |
| uncovered production mutation pairs | 55 | 49 | -6 |
| orphan wrappers | 37 | 42 | +5 |
| unclassified routes | 0 | 0 | 0 |
| unresolved action bindings | 0 | 0 | 0 |
| raw matrix blockers | 98 | 97 | -1 |

raw blocker 只下降 1 是预期结果：6 个 P1 uncovered pair 从生产可达面移除，同时 5 个专用写 wrapper 转为 test-only orphan。后者属于 P2/Task 12 的最终治理证据，不影响首次上线只读隔离，但不能据此把 Task 11 标记为完成。route usage 通过 5 条无删除授权的退出候选覆盖保持 442 routes、0 unclassified、0 blocker。

## 5. 验证回执

- Shared Domain：15 文件 151/151。
- API 主数据域：4 套 141/141，覆盖主体访问、主体服务/controller、统一社会信用代码和相对方服务；既有服务端岗位、状态、历史与审计不变量保持通过。
- Web 主数据域：4 文件 18/18；新增只读结构门 3/3。
- 能力清单与矩阵分析器：7 文件 225/225。
- 全仓 typecheck、lint 通过；API/Web production build、Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；Web/Page/整站矩阵按设计保留 P1/P2 blocker，route usage 为 ready。
- `git diff --check` 通过。

本组没有 Schema、迁移或后端业务实现变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重跑数据库、四岗位浏览器、公安备案和运维安全总门；本地结构测试不能替代最终上线证据。

## 6. 下一步与授权边界

下一步严格执行 `C-P1-02`：将合同模板、版式模板、标准条款、编号规则、合同场景和结算模板治理冻结为只读，只允许消费既有已发布版本，隐藏创建、克隆、编辑、提交、发布、停用和预览生成入口。之后依次处理 `C-P1-03` 组织/岗位/审批委托和 `C-P1-04` 复制已放弃合同草稿。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

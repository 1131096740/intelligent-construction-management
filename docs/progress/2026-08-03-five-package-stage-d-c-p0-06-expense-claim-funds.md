# 五包阶段 D：C-P0-06 员工费用与借款资金流清零回执

## 1. 结论

`C-P0-06`“员工费用/借款/报销、放款、还款与付款”已在唯一候选工作树本地确定性清零。阶段 C 登记的 15 个未覆盖生产 mutation pair 和 1 个 unresolved binding 当前均为 0；本组新增的 5 个业务域上传 pair 也已同步闭环。下一步严格进入 `C-P0-07` 零星采购申请、付款、收货、发票、退款与异常终止修复流。

整站能力矩阵仍为 `blocked`：435 条 Nest 路由中 0 条未分类，仍有 84 个未覆盖生产 mutation pair、0 个 unresolved binding 和 127 个整站 matrix blocker。因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署；旧 CI、数据库和浏览器证据不能作为本组新提交的发布回执。

## 2. 服务端能力与文件边界

- 费用申请创建选项从既有创建岗位规则发布 `create_expense_claim`，Web 在创建 POST 前重新读取并核对该动作。
- 费用申请实例 capability 从服务端授权详情的当前申请人、状态、附件、审批与资金事实计算提交、审核、附件新增/补充/移除、付款主体调整、公司付款、最终付款/放款 PDF、借款放款及还款动作。
- 草稿附件移除额外返回当前申请人可移除的精确 `attachmentId` 集合，客户端不能只凭页面上存在附件发起删除。
- 还款确认与冲销 capability 同时锁定精确 `claimId` 和 `repaymentId`：确认要求 recorded 状态、财务负责人能力及不超过实时账户余额；冲销要求 confirmed 状态、财务负责人能力及精确原还款台账金额和余额变化。
- 草稿附件、补充附件、付款凭证、放款凭证和还款凭证分别使用费用申请业务域私有上传路由。controller 在调用文件服务前先复核精确申请动作，无能力请求不落盘、不产生孤立文件。

## 3. Web 失败关闭链路

下列动作均在 mutation 前 fresh 读取服务端 capability，并校验精确费用申请、还款或附件坐标及唯一动作键；能力缺失、坐标漂移或可移除附件集合不包含目标时，均在写请求前失败关闭：

1. 费用申请创建、提交与审核；
2. 草稿附件上传、关联和精确移除，以及审批后的补充附件上传与关联；
3. 付款主体调整、公司付款与最终付款 PDF；
4. 借款放款、最终放款 PDF 和借款还款；
5. 精确还款确认与冲销。

原 `expense-claim.submit-local-status` 客户端状态动作已退出，替换为 19 个服务端派生动作。五类业务上传不再调用通用 `uploadPrivateFile`；页面 preflight 与业务上传端点的服务端复核共同保证失败关闭。

## 4. 矩阵对账

| 项目 | C-P0-05 后 | C-P0-06 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 428 | 435 | +7 capability/业务域上传路由 |
| Web wrappers / bindings | 418 / 438 | 425 / 445 | +7 / +7 |
| 注册动作 | 191 | 209 | +18（以 19 个服务端动作替换 1 个本地动作） |
| accepted action bindings | 201 | 220 | +19 |
| unresolved action bindings | 1 | 0 | -1 |
| covered production mutation pairs | 182 | 201 | +19 |
| uncovered production mutation pairs | 99 | 84 | -15 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 0 | 0 | 0 |
| raw matrix blockers | 143 | 127 | -16 |

覆盖增加 19 而未覆盖减少 15，是因为本组把原通用上传调用拆为 5 个费用业务域上传 pair，并在同一提交内完成能力绑定；它们没有扩大阶段 C 的旧缺口基数。

## 5. 验证回执

- TDD RED：新 Web 费用能力结构测试最初 21/21 失败；controller 测试在能力端点和上传 preflight 尚不存在时失败。GREEN 后均通过。
- Shared Domain：15 文件 151/151。
- API 费用申请域：4 套 47/47，覆盖实例 capability、精确还款 capability、权限 metadata，以及 capability preflight 先于文件存储的真实调用顺序。
- Web 费用申请域：2 文件 33/33，其中新结构门 21/21。
- 能力清单与矩阵分析器：7 文件 224/224；route usage 仓库锁定基线按新增 7 条真实页面路由更新后复验通过。
- API/Web typecheck、lint、production build 通过；Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；其中 Web/Page/整站矩阵按设计保留后续组 blocker，route usage 为 ready。
- `git diff --check` 通过。

本组没有 Schema 或迁移变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重新运行数据库、四岗位浏览器、公安备案和运维安全总门；本地单元、结构和静态清单证据不能替代最终上线证据。

## 6. 下一步与授权边界

下一步严格执行 `C-P0-07`，从当前矩阵重新提取零星采购申请、付款、收货、发票、退款与异常终止的 29 个 uncovered pair，并按“整个零星采购子模块未通过即只读，不只关闭其中一段”的失败关闭规则整体清零。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

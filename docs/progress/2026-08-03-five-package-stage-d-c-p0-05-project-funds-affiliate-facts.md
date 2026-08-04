# 五包阶段 D：C-P0-05 项目费用与项目资金清零回执

## 1. 结论

`C-P0-05`“项目费用、项目资金/垫资、上游资金与挂靠事实”已在唯一候选工作树本地确定性清零。阶段 C 登记的 18 个未覆盖生产 mutation pair 和 1 个 unresolved binding 当前均为 0；本组新增的 4 个业务域上传 pair 也已同步闭环。下一步严格进入 `C-P0-06` 员工费用/借款/报销、放款、还款与付款修复流。

整站能力矩阵仍为 `blocked`：428 条 Nest 路由中 0 条未分类，仍有 99 个未覆盖生产 mutation pair、1 个 unresolved binding 和 143 个整站 matrix blocker。因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署；远端候选仍为 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`，旧 CI 与旧浏览器证据不能作为本组新提交的发布回执。

## 2. 服务端能力与文件边界

- 项目新增与编辑 capability 复用 `chairman/general_manager` 的同一岗位边界；编辑能力返回精确 `projectId`。
- 项目支出创建 capability 与附件上传均受 `project_expense.create` 保护；实例 capability 从真实支出状态、申请人、有效项目岗位、实付、收货、采购执行、附件和审批 PDF 事实计算 `void`、`record_purchase_execution`、`download_attachment` 和 `download_approval_pdf`。
- 项目支出附件下载补齐服务端可见性复核，并与申请人、项目支出读岗位及历史零星采购材料员边界保持一致；无权请求在密码校验和票据生成前失败关闭。审批 PDF capability 只向实际具备该 PDF 下载权限的申请人或项目支出读岗位发布。
- 上游资金登记、依据上传和确认分别受既有项目动作保护；确认 capability 复用事实类型、依据类型、待确认状态与财务岗位规则，不把客户端角色判断当成授权事实。
- 挂靠合同、结算、付款登记 capability 按业务类型、原始/更正/冲销类型、目标事实状态及有效项目岗位计算；确认和补充依据 capability 复用既有事实动作规则。
- 挂靠补充依据上传在文件服务落盘前复核活动项目、业务类型、目标事实和该业务类型的有效证据岗位；登记依据退出通用 `/files`，改用受对应项目动作保护的业务域上传路由。

## 3. Web 失败关闭链路

下列动作均在 mutation 前直接读取服务端 capability，校验精确项目、支出申请、上游资金事实或挂靠业务事实坐标和唯一动作键；能力缺失或坐标漂移均在写请求前失败关闭：

1. 项目新增与项目名称编辑；
2. 项目支出创建、申请附件上传、采购执行、作废、附件下载和审批 PDF 下载；
3. 上游资金事实登记、依据上传与独立确认；
4. 挂靠合同、结算、付款事实登记及各自依据上传；
5. 三类挂靠事实确认和已确认事实的补充依据上传、关联。

页面动作分析器对三个目标生产页面的未验证 binding 和目标 blocker 均为 0。原本仅由客户端岗位控制的 `project-expense.create-local-role` 已改为服务端动作；通用 `uploadPrivateFile` 不再承担本组新增业务文件上传。

## 4. 矩阵对账

| 项目 | C-P0-04 后 | C-P0-05 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 414 | 428 | +14 capability/业务域上传路由 |
| Web wrappers / bindings | 404 / 424 | 418 / 438 | +14 / +14 |
| 注册动作 | 171 | 191 | +20 |
| accepted action bindings | 179 | 201 | +22 |
| unresolved action bindings | 2 | 1 | -1 |
| covered production mutation pairs | 160 | 182 | +22 |
| uncovered production mutation pairs | 117 | 99 | -18 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 0 | 0 | 0 |
| raw matrix blockers | 162 | 143 | -19 |

覆盖增加 22 而未覆盖减少 18，是因为本组把 4 个原通用上传调用拆为新增业务域上传路由，并在同一提交内完成能力绑定；它们没有扩大阶段 C 的旧缺口基数。

## 5. 验证回执

- TDD RED：新项目域结构测试最初 15/15 失败；controller 测试先因能力与上传方法不存在而编译失败；项目支出附件越权下载测试先错误成功。GREEN 后均通过。
- Shared Domain：15 文件 151/151。
- API 项目与项目支出域：22 套 669/669；另有项目支出 capability 与下载边界定向 122/122。
- Web 项目域：16 文件 156/156，其中新结构门 17/17。
- 能力清单与矩阵分析器：7 文件 204/204；route usage 仓库锁定基线按新增 14 条真实页面路由更新后复验通过。
- API/Web typecheck、lint、production build 通过；Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；其中 Web/Page/整站矩阵按设计保留后续组 blocker，route usage 为 ready。

本组没有 Schema 或迁移变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重新运行数据库、四岗位浏览器、公安备案和运维安全总门；本地单元、结构和静态清单证据不能替代最终上线证据。

## 6. 下一步与授权边界

下一步严格执行 `C-P0-06`，从当前矩阵重新提取员工费用/借款/报销、放款、还款与付款的 15 个 uncovered pair 和 1 个 unresolved binding，再按资金动作失败关闭边界清零。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

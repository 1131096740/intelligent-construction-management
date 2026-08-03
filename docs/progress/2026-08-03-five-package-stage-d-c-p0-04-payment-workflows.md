# 五包阶段 D：C-P0-04 付款全链路清零回执

## 1. 结论

`C-P0-04`“付款申请、审批、实付、凭证、财务与 PDF”已在唯一候选工作树本地确定性清零。阶段 C 登记的 12 个未覆盖生产 mutation pair 和 1 个 unresolved binding 当前均为 0；下一步严格进入 `C-P0-05` 项目费用、项目资金/垫资、上游资金与挂靠事实修复流。

整站能力矩阵仍为 `blocked`：414 条 Nest 路由中 0 条未分类，仍有 117 个未覆盖生产 mutation pair、2 个 unresolved binding 和 162 个整站 matrix blocker。因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署；远端候选仍为 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`，旧 CI 与旧浏览器证据不能作为本组新提交的发布回执。

## 2. 服务端能力与文件边界

- `GET /payments/create-capability?projectId=...` 受 `payment.create` 项目权限保护，只返回精确 `projectId` 与 `create_payment`；付款 POST 仍按提交的合同版本或结算资源解析真实项目并执行原有业务校验。
- `GET /payments/:paymentId/capability` 只对已认证且可见该项目或当前审批节点的用户开放，动作由现有付款读模型按状态、有效项目岗位、当前冻结审批节点、实付金额、财务入账金额和凭证事实计算。
- 付款详情保留对象化 `availableActions` 用于 UI 展示，并新增由 enabled 动作确定性投影的 `availableActionKeys`；没有把客户端角色、页面状态或本地按钮状态提升为授权事实。
- `POST /payments/:paymentId/pdf-archive-file-uploads` 受 `payment.pdf_archive` 保护，并在文件落盘前重新读取当前付款详情，复核可见性、状态和 `archive_pdf`；动作不可用时不调用文件服务。
- 实付登记继续沿用既有服务端 capability composite、付款版本坐标、幂等键、付款凭证、当前密码、金额上限与事务审计，本组没有改写该高风险事务链。
- 文件下载继续执行文件级 ACL capability、当前密码、下载原因、短时票据和后端审计。

## 3. Web 失败关闭链路

下列动作均在 mutation 前直接读取服务端 capability，校验精确项目、付款或文件坐标和唯一动作键；任一能力缺失、坐标漂移或文件 ACL 变化均在写请求前失败关闭：

1. 新建付款申请；
2. 放弃退回待修改的付款申请；
3. 审批单下载、催办、撤回、转审和委托；
4. 财务入账；
5. 付款 PDF 生成、财务归档文件上传与归档关联；
6. 付款凭证和归档文件下载票据。

审批通过/驳回继续使用原四坐标、自审确认和结果未知权威续读；实际付款继续使用原单提交合并、幂等上传和权威详情续读。本组没有重复改写已经被清单证明覆盖的动作。

## 4. 矩阵对账

| 项目 | C-P0-03 后 | C-P0-04 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 411 | 414 | +3 capability/付款域上传路由 |
| Web wrappers / bindings | 401 / 421 | 404 / 424 | +3 / +3 |
| 注册动作 | 161 | 171 | +10 |
| accepted action bindings | 167 | 179 | +12 |
| unresolved action bindings | 3 | 2 | -1 |
| covered production mutation pairs | 148 | 160 | +12 |
| uncovered production mutation pairs | 129 | 117 | -12 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 0 | 0 | 0 |
| raw matrix blockers | 175 | 162 | -13 |

`PaymentDetailPage.vue` 与 `PaymentWorkbenchPage.vue` 的本组目标 blocker 均为 0。零星采购付款属于 `C-P0-07`，项目/员工费用付款分别属于 `C-P0-05`、`C-P0-06`，没有混入本组或据此提前宣告完成。

## 5. 验证回执

- TDD RED：新付款能力结构测试最初 12/12 失败；controller 测试先因 create/detail capability、付款域上传和第四个依赖不存在而编译失败；`availableActionKeys` 断言先因共享契约缺字段而失败。GREEN 后全部通过。
- Shared Domain：15 文件 151/151。
- API 付款域：7 套 404/404，其中 capability、上传正例和落盘前拒绝定向 4/4。
- Web 付款域：6 文件 60/60，其中新结构门 12/12。
- 能力清单与矩阵分析器：5 文件 201/201；route usage 仓库锁定基线按新增 3 条真实页面路由更新后复验通过。
- API/Web typecheck、lint、production build 通过；Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；其中 Web/Page/整站矩阵按设计保留后续组 blocker，route usage 为 ready。

本组没有 Schema 或迁移变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重新运行数据库、四岗位浏览器、公安备案和运维安全总门；本地单元、结构和静态清单证据不能替代最终上线证据。

## 6. 下一步与授权边界

下一步严格执行 `C-P0-05`，从当前矩阵重新提取项目费用、项目资金/垫资、上游资金与挂靠事实的 18 个 uncovered pair 和 1 个 unresolved binding，再按子模块完整只读/完整可写边界清零。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

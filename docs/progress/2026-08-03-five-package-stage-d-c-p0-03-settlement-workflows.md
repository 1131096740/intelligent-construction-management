# 五包阶段 D：C-P0-03 结算全链路清零回执

## 1. 结论

`C-P0-03`“结算草稿、导入/预览、审批、归档与回收事实”已在唯一候选工作树本地确定性清零。阶段 C 登记的 29 个未覆盖生产 mutation pair 和 6 个 unresolved binding 当前均为 0；下一步严格进入 `C-P0-04` 付款申请、审批、实付、凭证、财务与 PDF 修复流。

整站能力矩阵仍为 `blocked`：411 条 Nest 路由中 0 条未分类，仍有 129 个未覆盖生产 mutation pair、3 个 unresolved binding 和 175 个整站 matrix blocker。因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署；远端候选仍为 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`，旧 CI 与旧浏览器证据不能作为本组新提交的发布回执。

## 2. 服务端能力与文件边界

- `GET /projects/:projectId/settlement-drafts/capability` 受 `settlement.create` 项目权限保护，返回草稿保存、复制、提交、预览、导入、冻结文件、对方签章文件、行附件和草稿文件上传的精确动作键。
- `GET /settlements/:settlementId/capability` 只对已认证且可见该项目的用户开放，动作仍由后端结算读模型结合当前状态、有效项目岗位和审批节点计算；响应只返回精确 `settlementId` 与 enabled 动作键，不把客户端角色或页面状态作为授权事实。
- `POST /projects/:projectId/settlement-drafts/files`、`POST /settlements/:settlementId/archive-file-uploads`、`POST /settlements/:settlementId/recovery-file-uploads` 分别绑定 `settlement.create`、`settlement.archive.upload` 和 `finance_staff`，不再让结算业务附件依赖通用 authenticated-only `/files` 上传。
- 两条结算实例上传路由在文件落盘前重新读取当前结算详情，复核项目可见性、状态和精确 `upload_archive` / `record_recovery|reverse_recovery` 动作；动作不可用时先拒绝且不调用文件服务，避免越权或孤立文件。
- 结算详情保留原 `availableActions` 对象数组用于 UI 展示，并新增由 enabled 动作确定性投影的 `availableActionKeys`；回收登记与冲销只在结算已生效且当前用户为财务人员时发布。
- 文件下载继续执行文件级 ACL capability、当前密码、下载原因、短时票据和后端审计，本组没有放宽文件读取权限。

## 3. Web 失败关闭链路

下列动作均在 mutation 前直接读取服务端 capability，校验响应坐标和唯一动作键；任一能力缺失、项目/结算漂移或文件 ACL 变化均在写请求前失败关闭：

1. 草稿创建、更新、复制已放弃草稿和提交；
2. Excel 私有上传与预检、明细预览、导入应用；
3. 冻结结算文件生成、对方签章原件上传与关联；
4. 结算行附件上传/关联和附件作废；
5. 审批、催办、转审、委托和最新审批 PDF 下载；
6. 归档私有上传、归档关联/确认、签章结算单重生成/失败重试和 PDF 归档；
7. 回收登记、回收冲销及其专用凭证上传；
8. 结算详情和工作台文件下载票据。

页面动作清单按分析器可证明的同函数结构登记为“透明 GET → 精确 includes gate → fail closed → mutation”。没有通过修改分析器、人工分类或隐藏调用来消除差额。

## 4. 矩阵对账

| 项目 | C-P0-02 后 | C-P0-03 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 406 | 411 | +5 capability/业务域上传路由 |
| Web wrappers / bindings | 396 / 416 | 401 / 421 | +5 / +5 |
| 注册动作 | 139 | 161 | +22 |
| accepted action bindings | 136 | 167 | +31 |
| unresolved action bindings | 9 | 3 | -6 |
| covered production mutation pairs | 119 | 148 | +29 |
| uncovered production mutation pairs | 158 | 129 | -29 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 0 | 0 | 0 |
| raw matrix blockers | 210 | 175 | -35 |

`SettlementDetailPage.vue`、`SettlementListPage.vue`、`SettlementWorkbenchPage.vue`、`SettlementLineAttachmentPanel.vue` 和 `SettlementRecoveryLedgerPanel.vue` 的本组目标 blocker 均为 0。剩余 175 个整站 blocker 属于后续付款、项目资金、员工费用、零星采购及已登记的 P1/P2 范围，不能据此把 Task 11 写为完成。

## 5. 验证回执

- TDD RED：新结算能力结构测试最初 22 项全部失败；结算实例 capability controller 测试先因方法不存在失败；`availableActionKeys` 测试先因读模型缺少字段失败。GREEN 后结构测试扩展为 23/23。
- Shared Domain：15 文件 151/151。
- API 结算域：31 套 599/599；最终新增回收动作投影定向复验 1/1，实例上传落盘前授权正反例 2/2。
- Web 结算域：12 文件 140/140。
- 能力清单与矩阵分析器：5 文件 201/201；route usage 仓库锁定基线按新增 5 条真实页面路由更新后复验通过。
- API/Web typecheck、lint、production build 通过；Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；其中 Web/Page/整站矩阵按设计保留后续组 blocker，route usage 为 ready。
- `git diff --check` 通过。

本组没有 Schema 或迁移变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重新运行数据库、四岗位浏览器、公安备案和运维安全总门；本地单元、结构和静态清单证据不能替代最终上线证据。

## 6. 下一步与授权边界

下一步严格执行 `C-P0-04`，从当前矩阵重新提取付款申请、审批、实付、凭证、财务与 PDF 的 12 个 uncovered pair 和 1 个 unresolved binding，再按依赖顺序清零。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

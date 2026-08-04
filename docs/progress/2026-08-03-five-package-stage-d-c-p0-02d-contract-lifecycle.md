# 五包阶段 D：C-P0-02d 合同审批、用印、归档与变更生命周期清零回执

## 1. 结论

`C-P0-02` 第 4 组“审批、用印、归档与合同变更生命周期”已本地确定性清零。阶段 C 登记的 16 个生产 mutation consumer pair 在当前生成矩阵中全部为 `covered`；为区分两条用印路径以及文件上传与业务关联，本组登记 17 个动作绑定，17/17 均为 `accepted=true`。本组没有新增未闭合动作绑定。

整站矩阵仍为 `blocked`，因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。下一步只能进入第 5 组“历史合同接管主流程”。

本轮没有连接生产、执行数据库或迁移、修改业务数据、推送、合并 PR 或部署。已推送远端仍是 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`；第 3 组本地提交为 `a0fd200a`，本组代码、证据和本文随同一新本地提交固化，不能复用旧 CI 或旧推送授权。

## 2. 子组进度

| 顺序 | 子组 | 基线 pair | 基线 unresolved | 当前状态 |
| --- | --- | ---: | ---: | --- |
| 1 | 草稿租约、聚合保存、预览与租约接管 | 6 | 6 | 已本地清零 |
| 2 | 草稿创建、提交、负责人转移与工作台治理 | 7 | 2 | 已本地清零 |
| 3 | 文件、清单、授权、洽商与正式文档 | 21 | 0 | 已本地清零 |
| 4 | 审批、用印、归档与合同变更生命周期 | 16 | 0 | **已本地清零** |
| 5 | 历史合同接管主流程 | 28 | 3 | 下一步 |
| 6 | 接管税务事实与双部门确认 | 7 | 0 | 待执行 |
| **合计** |  | **85** | **11** | **剩余 35 / 3** |

## 3. 实现事实

### 3.1 服务端发布精确动作权威

- 合同详情读模型新增 `availableActionKeys`，只发布当前服务端计算为 enabled 的动作键；Web 不再把页面状态或岗位推断当作写权限。
- 合同变更 eligibility 新增唯一动作 `create_contract_change_draft`。只有当前生效版本与请求版本一致、没有进行中的变更且不存在来源阻塞时才发布；Web 解析器要求 `eligible` 与动作列表严格一致，畸形或矛盾响应失败关闭。
- 私有文件下载 capability 同时发布 `create_private_file_download_ticket` 动作列表，继续复用生成票据时的同一文件 ACL，不改变密码、原因、短时票据和审计边界。

### 3.2 Web 写前失败关闭

- 审批单下载、催办、转审、委托、两条用印审批、用印完成、归档上传/关联/确认/PDF、最终版上传/关联/退回/确认等动作，均执行 `fresh GET -> 合同与版本坐标校验 -> 精确动作键校验 -> mutation`。
- 归档文件和最终版文件把“创建私有文件”与“关联业务事实”拆成两个独立动作证明；两者都由当前合同详情的服务端动作支配，不复用客户端角色判断。
- 合同变更创建在提交时重新读取 eligibility，并校验当前生效版本 ID、合同 ID 和返回草稿的基版坐标；任一漂移在写前或导航前失败关闭。
- 合同文件下载在打开二次确认前读取文件 ACL capability，并在最终创建票据时再次读取；跨文件迟到结果、动作消失或目标文件变化均不会签发票据。
- 既有合同审批通过/驳回、审批撤回和签署材料重大变化仍保留唯一 enabled 动作、完整审批坐标、重复提交共用 Promise 和 unknown-result 权威续读；本组新增动作键只作为额外服务端权威，没有放宽原有门禁。
- 敏感动作改为按业务类型分派确认处理器，避免通用 `switch` 在动作扩展时把错误确认路径落到其他 mutation。

## 4. 目标动作证据

以下 17 个动作绑定均为 `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`、`accepted=true`：

- 合同变更：`contract-change.create-draft`；
- 审批辅助：`contract-approval.download-form`、`contract-approval.remind`、`contract-approval.transfer`、`contract-approval.delegate`；
- 用印：`contract-seal.approve-legacy`、`contract-seal.approve-governed`、`contract-seal.complete`；
- 最终版：`contract-final.upload-file`、`contract-final.associate`、`contract-final.return`、`contract-final.confirm`；
- 归档：`contract-archive.upload-file`、`contract-archive.associate`、`contract-archive.confirm`、`contract-archive.generate-pdf`；
- 文件下载：`contract-file.download-ticket`。

两条用印审批对应两个独立 mutation wrapper；归档与最终版各自的上传、关联动作共享页面 consumer，因此 17 个 accepted binding 精确覆盖 16 个此前未覆盖的生产 consumer pair。当前矩阵中 `ContractDetailPage.vue` 已无未覆盖 mutation consumer。

## 5. 路由清单基线修复

扩展分析器回归发现，前三个本地子组已经把路由从 401 增至 404，但 `route-usage.registry.json` 和仓库级锁定测试仍保留更早的计数及摘要，导致 route usage 自身出现 4 个 expectation mismatch。该问题会污染整站矩阵的上游状态。

本组按实际 404 条 Nest 路由、296 条生产页面派生路由、299 条 page usage 和 346 条 Web API consumer surface 更新锁定值及摘要测试。重新生成后 route usage 为 `READY`、404 routes、0 unclassified、0 blocker；没有改变任何路由分类、退出候选语义或删除授权。

## 6. 矩阵对账

| 项目 | C-P0-02c 后 | C-P0-02d 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 404 | 404 | 0 |
| Web wrappers / bindings | 394 / 414 | 394 / 414 | 0 |
| 注册动作 | 90 | 107 | +17 |
| accepted action bindings | 84 | 101 | +17 |
| unresolved action bindings | 12 | 12 | 0 |
| covered production mutation pairs | 68 | 84 | +16 |
| uncovered production mutation pairs | 209 | 193 | -16 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 4 | 0 | -4 expectation mismatch |
| raw blockers | 265 | 248 | -17 |

当前 248 个 raw blocker 由 2 个上游清单问题、1 个 Web 主请求无 Nest 对应、37 个 orphan wrapper、3 组 duplicate mutation route、193 个未覆盖生产写 pair 和 12 个 unresolved action 组成。普通 `--check` 退出 0 只证明生成物与当前源码一致，不表示整站 ready。

## 7. 验证回执

- Web 相关回归：11 文件 221/221；其中新增合同生命周期结构测试覆盖 15 个写前 capability 门。
- API 聚焦：合同变更、合同详情读模型、文件 service/controller 共 4 套 315/315。
- 清单与矩阵分析器：6 个测试文件 204/204。
- API：typecheck、lint、build 通过。
- Web：typecheck、lint、`check:ui`、production build 通过。
- Nest route、Web API、页面动作、route usage、整站矩阵的生成与普通 check 通过；当前输出为 404 routes、394 wrappers/414 bindings、107 actions、101 accepted bindings、0 unclassified、193 uncovered pairs、12 unresolved bindings、248 raw blockers。
- `git diff --check` 通过。

本组没有 Schema 或迁移变化，也没有启动数据库、preview 或浏览器；冻结候选 SHA 后仍必须在阶段 E 对合同全生命周期重跑真实岗位浏览器链、数据库事务门和发布总门，本地结构与单元证据不能替代最终上线证据。

## 8. 下一步与边界

下一步严格执行 `C-P0-02` 第 5 组“历史合同接管主流程”，目标为 28 个未覆盖 pair 和 3 个 unresolved binding。继续采用服务端权限与状态不变量、精确 capability、Web 写前失败关闭、因果矩阵、聚焦回归和同一提交进度回执的顺序。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

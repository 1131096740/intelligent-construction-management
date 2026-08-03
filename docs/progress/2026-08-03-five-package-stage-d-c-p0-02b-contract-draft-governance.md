# 五包阶段 D：C-P0-02b 草稿创建、提交与工作台治理清零回执

## 1. 结论

`C-P0-02` 第 2 组“草稿创建、提交、负责人转移与工作台治理”已本地确定性清零。目标 7 个生产 mutation consumer pair 和 2 个未闭合动作绑定在当前生成矩阵中均为 0；整站矩阵仍为 `blocked`，因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。

本轮没有连接生产、执行数据库或迁移、修改业务数据、推送、合并 PR 或部署。已推送远端仍是 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`；第 1 组本地提交为 `6849f0860d00abfe85da63d18e7bcbe92606543c`，本轮变更不能复用旧 CI 回执或旧推送授权。

## 2. 子组进度

| 顺序 | 子组 | 基线 pair | 基线 unresolved | 当前状态 |
| --- | --- | ---: | ---: | --- |
| 1 | 草稿租约、聚合保存、预览与租约接管 | 6 | 6 | 已本地清零 |
| 2 | 草稿创建、提交、负责人转移与工作台治理 | 7 | 2 | **已本地清零** |
| 3 | 文件、清单、授权、洽商与正式文档 | 21 | 0 | 下一步 |
| 4 | 审批、用印、归档与合同变更生命周期 | 16 | 0 | 待执行 |
| 5 | 历史合同接管主流程 | 28 | 3 | 待执行 |
| 6 | 接管税务事实与双部门确认 | 7 | 0 | 待执行 |
| **合计** |  | **85** | **11** | **剩余 72 / 3** |

## 3. 实现事实

### 3.1 服务端权限与 capability

- 新建草稿增加项目坐标 capability GET，和创建 mutation 使用同一 `contract.create` 项目权限；Web 必须匹配所选项目及 `create_contract_draft` 后才可写入。
- 草稿工作台按当前经办人、合同主管、版本类型和状态发布提交、就绪检查、结算方式确认、合同类型预览/应用及负责人转移动作。
- 结算方式确认、类型预览、类型应用和负责人转移四条旧工作台 mutation 补齐 `contract.create` 项目权限；提交和就绪检查继续使用 `contract.submit`。
- 负责人转移使用合同坐标的专用 capability GET，只有全局合同主管且存在最新可编辑版本时发布动作。

### 3.2 写前失败关闭与版本 CAS

- 7 个目标写入口均在 mutation 前重新读取透明服务端 capability；项目、合同、版本或精确动作不匹配即停止写入。
- 提交按钮、转移入口和合同类型选择同时受缓存的服务端动作控制；执行时仍重新取证，避免只依赖页面初次加载状态。
- 转移请求新增可选 `expectedContractVersionId`。新 Web 必须提交页面版本；后端在事务锁定最新可编辑版本后比较，不一致返回 409，且不更新负责人、不写成功审计。
- 旧调用未携带期望版本时保持兼容，后续按 Release C1/C2 的独立授权和零调用证据退出。

## 4. 目标动作证据

以下 7 个动作均为 `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`，且生产 consumer 已接受覆盖：

- `contract-draft.create`
- `contract-workbench.submit`
- `contract-draft.transfer`
- `contract-workbench.check-submission-readiness`
- `contract-workbench.confirm-settlement-mode`
- `contract-workbench.preview-type-change`
- `contract-workbench.apply-type-change`

生成矩阵的 `uncoveredMutationConsumers` 与 `unresolvedActions` 中，上述 7 个 wrapper 均为 0。

## 5. 矩阵对账

| 项目 | C-P0-02a 后 | C-P0-02b 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 401 | 403 | +2 capability GET |
| Web wrappers / bindings | 391 / 411 | 393 / 413 | +2 只读 capability wrapper / GET binding |
| 注册动作 | 64 | 69 | +5；提交与转移由既有本地门升级 |
| accepted action bindings | 56 | 63 | +7 |
| unresolved action bindings | 14 | 12 | -2 |
| covered production mutation pairs | 40 | 47 | +7 |
| uncovered production mutation pairs | 237 | 230 | -7 |
| unclassified routes | 0 | 0 | 0 |
| raw blockers | 294 | 286 | -8 |

当前整站另有 37 个 orphan wrapper、3 组 duplicate mutation route、1 个 Web 主请求无 Nest 对应以及后续业务组 blocker。普通 `--check` 退出 0 只证明生成物确定且与源一致，不表示整站 ready。

## 6. 验证回执

- TDD RED：服务端动作缺失、旧工作台路由无项目权限、创建/提交权限撤销后仍写入、转移 capability/版本门缺失均被聚焦测试或严格矩阵精确复现。
- API 聚焦：4 套 312/312。
- Web 聚焦与结构：3 套 89/89，其中草稿 composable 76/76。
- 页面动作与综合矩阵检查器：116/116。
- API/Web typecheck、lint、build：通过。
- Web `check:ui`：通过。
- Nest route、Web API、页面动作、route usage、整站矩阵和合同专项矩阵写入/普通 check：通过。
- 当前生成事实：403 routes、393 wrappers/413 bindings、69 actions、0 unclassified、230 uncovered pairs、12 unresolved bindings、286 raw blockers。

## 7. 下一步与边界

下一步严格执行 `C-P0-02` 第 3 组“文件、清单、授权、洽商与正式文档”，目标为 21 个未覆盖 pair、0 个既有 unresolved binding。继续采用后端不变量与权限、服务端 capability、Web 写前失败关闭、清单因果证明和聚焦回归的顺序。

本轮不授权：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

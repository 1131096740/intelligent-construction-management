# 五包阶段 D：C-P0-02c 文件、清单、授权、洽商与正式文档清零回执

## 1. 结论

`C-P0-02` 第 3 组“文件、清单、授权、洽商与正式文档”已本地确定性清零。阶段 C 登记的 21 个生产 mutation consumer pair 在当前生成矩阵中全部为 `accepted=true`，本组没有新增未闭合动作绑定；整站矩阵仍为 `blocked`，因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。

本轮没有连接生产、执行数据库或迁移、修改业务数据、推送、合并 PR 或部署。已推送远端仍是 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`；第 2 组本地提交为 `acebe95aea21835ade8af5d056e747f3bcefdd8e`，本轮变更不能复用旧 CI 回执或旧推送授权。

## 2. 子组进度

| 顺序 | 子组 | 基线 pair | 基线 unresolved | 当前状态 |
| --- | --- | ---: | ---: | --- |
| 1 | 草稿租约、聚合保存、预览与租约接管 | 6 | 6 | 已本地清零 |
| 2 | 草稿创建、提交、负责人转移与工作台治理 | 7 | 2 | 已本地清零 |
| 3 | 文件、清单、授权、洽商与正式文档 | 21 | 0 | **已本地清零** |
| 4 | 审批、用印、归档与合同变更生命周期 | 16 | 0 | 下一步 |
| 5 | 历史合同接管主流程 | 28 | 3 | 待执行 |
| 6 | 接管税务事实与双部门确认 | 7 | 0 | 待执行 |
| **合计** |  | **85** | **11** | **剩余 51 / 3** |

## 3. 实现事实

### 3.1 服务端权限与版本边界

- 合同文档的排队、取消、重试、磋商轮次开关、线下修订上传/重试和差异处置等 8 条 mutation 补齐 `contract.create` 项目权限；清单过渡保存、放弃、确认和清单 Excel 预检同样使用精确项目权限。
- `PermissionGuard` 对 `toContractVersionId`、`roundId`、`differenceId`、工作台 `revisionId` 和 `documentId` 均先读取持久化资源并解析真实项目，拒绝用请求体伪造的项目越权；同时明确排除带 `takeoverId` 的税务事实修订路由，保持其显式 `projectId` 权限边界。
- 新增 `POST /contract-drafts/:contractVersionId/files` 专用上传契约。它先锁定精确合同草稿边界，校验当前经办人、可编辑状态、未作废且不存在正式业务事实，再创建未绑定的私有文件；后续关联仍沿用既有文件归属校验。
- 通用 `/files` 上传保留给其他业务面，合同工作台的 6 个上传 consumer 全部切换到版本专用路由，没有放宽通用文件路由或矩阵规则。
- 上传文件名沿用统一的中文文件名解码逻辑，文件大小限制、私有对象存储、上传审计和幂等语义继续由既有 `FileService` 承担。

### 3.2 Web 写前失败关闭与下载确认

- 文件、清单过渡、Excel 预检、授权、磋商、正式文档和主体附件等 21 个目标入口均在 mutation 前读取透明的服务端 capability，精确比较合同版本与动作字符串；版本漂移或动作缺失时停止写入。
- 合同文档下载复用既有文件级 ACL capability。点击文件先读取精确文件权限，只有 `create_private_file_download_ticket` 为 enabled 才打开 TDesign 二次确认；确认时要求当前密码和下载原因，再创建短时票据并由后端复核权限、记录审计。
- 下载 capability 使用 request id 隔离迟到响应；重复确认共享同一 Promise，避免重复签发票据。
- 清单过渡确认由合同主管动作支配，保存/放弃由当前经办人动作支配；同一组件不再用客户端角色或状态推断代替服务端权限。

## 4. 目标动作证据

以下 21 个动作绑定均为 `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`，且精确生产 consumer 已接受覆盖：

- 磋商与修订：开启/关闭磋商轮次、上传文件、上传修订、重试修订、处置差异、打开修订预览，共 7 个；
- 合同清单：过渡保存、放弃、确认、Excel 文件上传和预检，共 5 个；
- 合同文档：排队、文件上传、重试和下载票据，共 4 个；
- 授权与正式文件：授权文件上传、授权事实设置、正式文件上传和审批文件关联，共 4 个；
- 合同主体附件上传，共 1 个。

当前矩阵对这 21 个 action 的 `accepted` 为 21/21，目标 `uncoveredMutationConsumers` 和新增 `unresolvedActions` 均为 0。

## 5. 矩阵对账

| 项目 | C-P0-02b 后 | C-P0-02c 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 403 | 404 | +1 版本专用上传路由 |
| Web wrappers / bindings | 393 / 413 | 394 / 414 | +1 专用上传 wrapper / POST binding |
| 注册动作 | 69 | 90 | +21 |
| accepted action bindings | 63 | 84 | +21 |
| unresolved action bindings | 12 | 12 | 0 |
| covered production mutation pairs | 47 | 68 | +21 |
| uncovered production mutation pairs | 230 | 209 | -21 |
| unclassified routes | 0 | 0 | 0 |
| raw blockers | 286 | 265 | -21 |

当前整站另有 37 个 orphan wrapper、3 组 duplicate mutation route、1 个 Web 主请求无 Nest 对应以及后续业务组 blocker。普通 `--check` 退出 0 只证明生成物确定且与源一致，不表示整站 ready。

## 6. 验证回执

- TDD RED：服务端版本专用上传方法/路由缺失导致 API 编译失败；6 个 Web 上传 consumer 仍调用通用 `/files` 导致结构测试 6/6 失败；下载未形成显式能力确认门导致结构测试失败；新增项目权限后，5 种工作台资源参数最初均无法解析真实项目并被守卫拒绝。
- API 聚焦：6 套 120/120，其中 `PermissionGuard` 62/62，并覆盖历史接管 `takeoverId + revisionId` 参数冲突回归。
- Web API、聚焦与结构：7 文件 132/132。
- 页面动作与综合矩阵检查器：116/116。
- API/Web typecheck、lint、build：通过。
- Web `check:ui`：通过。
- Nest route、Web API、页面动作、route usage、整站矩阵和合同专项矩阵写入/普通 check：通过。
- 当前生成事实：404 routes、394 wrappers/414 bindings、90 actions、0 unclassified、209 uncovered pairs、12 unresolved bindings、265 raw blockers。

## 7. 下一步与边界

下一步严格执行 `C-P0-02` 第 4 组“审批、用印、归档与合同变更生命周期”，目标为 16 个未覆盖 pair、0 个既有 unresolved binding。继续采用服务端权限/状态不变量、透明 capability、Web 写前失败关闭、清单因果证明和聚焦回归的顺序。

本轮不授权：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

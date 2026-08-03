# 五包阶段 D：C-P0-02e/f 历史接管与税务事实清零回执

## 1. 结论

`C-P0-02` 第 5 组“历史合同接管主流程”和第 6 组“接管税务事实与双部门确认”已在唯一候选工作树本地确定性清零。阶段 C 为整个 `C-P0-02` 登记的 85 个未覆盖生产 mutation pair 和 11 个 unresolved binding 已全部关闭，六个子组均完成；下一步严格进入 `C-P0-03` 结算修复流。

整站能力矩阵仍为 `blocked`，当前还有其他 P0 修复流及 P1/P2 治理项，因此 Task 11、阶段 D、实施包 5 和五包整体仍未完成。本轮没有连接生产、执行数据库/迁移或浏览器门、修改业务数据、推送、合并 PR 或部署。远端候选仍是 `31ed0e89a03f9d2c38489426dfb50d0b99d604a2`，旧 CI 和旧浏览器证据不能作为本轮提交的发布回执。

## 2. 六个子组完成状态

| 顺序 | 子组 | 基线 pair | 基线 unresolved | 当前状态 |
| --- | --- | ---: | ---: | --- |
| 1 | 草稿租约、聚合保存、预览与租约接管 | 6 | 6 | 已本地清零 |
| 2 | 草稿创建、提交、负责人转移与工作台治理 | 7 | 2 | 已本地清零 |
| 3 | 文件、清单、授权、洽商与正式文档 | 21 | 0 | 已本地清零 |
| 4 | 审批、用印、归档与合同变更生命周期 | 16 | 0 | 已本地清零 |
| 5 | 历史合同接管主流程 | 28 | 3 | **已本地清零** |
| 6 | 接管税务事实与双部门确认 | 7 | 0 | **已本地清零** |
| **合计** |  | **85** | **11** | **剩余 0 / 0** |

## 3. 第 5 组实现事实

- `ContractTakeoverController` 新增项目级 capability GET，按当前用户在精确项目中的有效岗位计算接管动作；Web 的创建、导入、批次清理、修改、提交、确认、退回、双部门保存/确认/撤回、证据、付款凭证、更正和主体更正全部在 mutation 前重新读取该权威结果。
- 每条 Web 写路径显式校验 capability 返回的 `projectId` 与请求项目一致，并校验唯一动作键；项目漂移或动作缺失时在发出 mutation 前失败关闭。
- 历史接管文件改用项目级专用上传路由，保留私有对象、文件大小、中文文件名、上传审计和幂等处理；新增 `contract.takeover.file.upload`，不把通用 authenticated-only `/files` 当作业务授权。
- 历史付款凭证绑定使用专用 `contract.takeover.payment_evidence.upload`，不再复用宽泛的财务事实编辑权限。
- 两处接管文件下载在生成票据前重新读取文件 ACL capability，并要求精确 `create_private_file_download_ticket`；后端密码、原因、短时票据和下载审计保持不变。

## 4. 第 6 组实现事实

- 项目 capability 新增税务事实草稿创建、修改、提交财务复核、财务复核、合同部确认和放弃修订六个精确动作，继续映射既有 `contract.tax_fact.*` 后端岗位策略。
- `ContractTaxFactReviewPanel.vue` 的六条税务事实 mutation 均改为 fresh capability GET 后再写；合同员、财务主管、合同主管只会获得其后端岗位可执行的动作。
- 税务依据附件复用已受项目权限保护的历史接管私有文件上传路由，并在上传前校验 `upload_takeover_file`；附件上传与后续税务事实保存仍是两个独立受控步骤。

## 5. 矩阵对账

| 项目 | 第 4 组后 | 第 5/6 组后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 404 | 406 | +2 capability/专用上传路由 |
| Web wrappers / bindings | 394 / 414 | 396 / 416 | +2 |
| 注册动作 | 107 | 139 | +32 |
| accepted action bindings | 101 | 136 | +35 |
| unresolved action bindings | 12 | 9 | -3 |
| covered production mutation pairs | 84 | 119 | +35 |
| uncovered production mutation pairs | 193 | 158 | -35 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 0 | 0 | 0 |
| raw blockers | 248 | 210 | -38 |

第 5/6 组登记的 35 个动作绑定全部为 `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`、`accepted=true`。`ContractTakeoverPage.vue` 与 `ContractTaxFactReviewPanel.vue` 已无未覆盖 mutation consumer，也没有 unresolved capability。当前剩余 210 个整站 raw blocker 属于后续结算、付款、项目资金、员工费用、零星采购以及已分级的 P1/P2 范围，不能据此把 Task 11 写为完成。

## 6. 验证回执

- TDD RED：新增角色矩阵断言先暴露缺失动作；Web 结构门先以 26 个缺失 helper 失败；历史付款凭证原路由的权限断言暴露其仍使用宽泛财务编辑权限。
- Shared 权限策略：1 文件 44/44。
- API 历史接管、税务事实、Excel、双部门、余额、激活、更正和 DTO：8 套 353/353。
- Web 接管、税务事实、自动保存、配置和结构：6 文件 117/117。
- 能力清单与矩阵分析器：6 文件 204/204；其中路由基线测试发现新增两条接管路由后控制器计数仍锁在 40，已按实际 42 修复并转绿。
- API/Web typecheck、lint、API/Web production build、Web `check:ui` 和业务错误检查通过。
- Nest route、Web API、页面动作、route usage、整站矩阵和合同专项矩阵均已重生并通过普通 check；当前为 406 routes、396 wrappers/416 bindings、139 actions、136 accepted bindings、0 unclassified、158 uncovered pairs、9 unresolved bindings、210 raw blockers。
- `git diff --check` 通过。

本组没有 Schema 或迁移变化，也没有运行本地 PostgreSQL、恢复库或浏览器动态用例。阶段 E 仍须对最终冻结 SHA 运行数据库、四岗位浏览器和运维安全总门；本地单元/结构证据不能替代最终上线证据。

## 7. 下一步与授权边界

下一步严格执行 `C-P0-03`“结算草稿、导入/预览、审批、归档与回收事实”，先从当前矩阵重新提取阶段 C 登记的 29 个 pair / 6 个 unresolved binding，再按依赖拆组清零。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。

# 阶段 D C-P1-03/C-P1-04 只读隔离回执

日期：2026-08-03

候选工作树：`codex/five-package-go-live`
范围：首次上线前生产页面可达写入口隔离；不授权删除后端路由、wrapper、岗位鉴权、生产数据或旧代码。

## 结果

- C-P1-03 组织/岗位/审批委托：移除组织部门与用户维护、角色增删/预览、委托新建与撤销的生产页面触发器，保留目录、状态和委托台账只读查询。
- C-P1-04 已放弃合同草稿：保留列表和详情读取，移除“复制为新草稿”生产入口；复制 wrapper 和后端路由保留为历史/测试代码。
- 共隔离 12 个 production mutation pair：组织 9、审批委托 2、已放弃草稿复制 1。12 条路由登记为 `exit_candidate`，语义固定为 `candidate_only_no_deletion_authorization`，`deletionAuthorized=false`。

## 清单变化

阶段 D 四份 machine-readable manifest 已按当前源码重生成：

| 指标 | C-P1-02 后 | C-P1-03/C-P1-04 后 |
| --- | ---: | ---: |
| routes | 442 | 442 |
| unclassified routes | 0 | 0 |
| page routes | 290 | 278 |
| exit candidates | 88 | 100 |
| production mutation pairs | 243 | 231 |
| uncovered pairs | 12 | 0 |
| orphan wrappers | 81 | 93 |
| raw blockers | 99 | 99 |
| unresolved action bindings | 0 | 0 |

页面动作清单仍报告 3 个既有上游问题：Web wrapper 上游 blocked 2 项、`JgPageHeader.vue` 的组件 spread 透传 1 项；本次没有把它们伪装成已解决。

## 代码与验证

涉及页面/测试：

- `apps/web-admin/src/pages/organization/OrganizationManagementPage.vue`
- `apps/web-admin/src/pages/organization/organization-page.structure.test.ts`
- `apps/web-admin/src/pages/delegations/DelegationListPage.vue`
- `apps/web-admin/src/pages/delegations/delegation-list.config.ts`
- `apps/web-admin/src/pages/delegations/delegation-list.config.test.ts`
- `apps/web-admin/src/pages/delegations/delegation-list-readonly-isolation.structure.test.ts`
- `apps/web-admin/src/pages/contracts/ContractListPage.vue`
- `apps/web-admin/src/pages/contracts/contract-list.config.test.ts`
- `apps/web-admin/e2e/draft-lifecycle-governance.e2e.ts`

验证回执：Web 全量 Vitest 178 文件/1949 测试通过；API Jest 292/311 suites、5723/5787 tests 通过（19 suites、64 tests 因环境门跳过）；shared 15 文件/151 测试通过；聚焦结构测试、组织域 81/81、审批委托域 7/7、合同列表 19/19、路由清单分析器 37/37 均通过。子组同时通过 Web/API typecheck、lint、API/Web build、Web E2E typecheck、`check:ui`、业务错误、Prisma validate（占位本地 URL）和 `git diff --check`。为恢复整站 Web 绿灯，最小更新了 3 个既有结构测试的过时上传 helper/引号断言，没有放宽生产行为。本轮未执行浏览器动态长链、数据库/迁移、生产连接、推送、合并或部署。

## 后续

P1 生产页面写入口已清零，但 Task 11/实施包 5 尚未完成。下一步冻结候选并重跑整套发布门禁，再处理剩余上游清单、孤儿 wrapper、重复归一化路由、无 Nest 对应请求和组件透传等 P2 治理项；任何旧能力物理删除仍需独立授权。

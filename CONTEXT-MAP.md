# 建工智管 Context Map

本文件是代码与领域文档的导航入口，不重复业务规格。开始任务时先读 `PROGRESS.md` 和 `AGENTS.md`，再按任务范围读取下表对应区域。

| 范围 | 代码入口 | 主要职责 | 继续读取 |
| --- | --- | --- | --- |
| 全局业务与发布 | `AGENTS.md`、`PROGRESS.md`、`prd.md` | 阶段范围、业务红线、当前进度、发布边界 | `docs/README.md`、最新发布收据 |
| API | `services/api/src/`、`services/api/prisma/` | NestJS 业务服务、权限、事务、审计、迁移与运维验证 | 若存在则读 `services/api/CONTEXT.md` |
| Web Admin | `apps/web-admin/src/`、`apps/web-admin/e2e/` | 响应式业务工作台、TDesign UI、读模型、浏览器门禁 | 若存在则读 `apps/web-admin/CONTEXT.md` |
| Shared Domain | `packages/shared-domain/src/` | 角色、权限、状态、金额和跨端契约 | 若存在则读 `packages/shared-domain/CONTEXT.md` |
| 产品治理证据 | `docs/product/` | 路由、页面动作、API wrapper 与能力矩阵 | 对应 manifest 和生成说明 |
| 运维与发布 | `docs/runbooks/`、`scripts/ops/`、`.github/workflows/` | 部署、就绪、备份、恢复、停写与监控 | 最新发布收据和对应 runbook |

领域文档采用按需创建策略：没有真实术语或决策需要记录时，不创建空的 `CONTEXT.md`。新增或修改领域词汇、ADR 和上下文文件前，先遵守 `docs/agents/domain.md`。

当前默认开发流程为：一个 GitHub Issue 对应一个功能会话、一个分支/工作树和一条可验证交付链；多票任务按 blocking edges 执行，每票结束后代码审查、提交并回报主控会话。

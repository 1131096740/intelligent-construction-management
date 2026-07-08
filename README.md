# 建工智管

建工智管是企业级建筑项目经营管理系统。

Phase 1 MVP 聚焦审批、合同、结算、付款、用印、归档、PDF 与审计的核心闭环。当前试运行边界已收敛为“1 个真实项目 + 约 20 个已签在执行历史合同接管 + 3-5 个活跃合同跑后续结算/付款闭环”，并已补齐真实常用单据 P0-7（项目付款审批表 PDF、结算附件模板、差旅/招待/报销最小综合费用付款闭环）。详见 [历史合同接管与单项目试运行设计](docs/superpowers/specs/2026-07-03-historical-contract-takeover-trial-run-design.md)。

当前工程约束与业务边界以 [AGENTS.md](AGENTS.md) 和 [PROGRESS.md](PROGRESS.md) 为准，产品与架构设计以 Obsidian 文档 `obsidian-current/建工智管_第一阶段MVP_产品与架构设计.md` 为当前来源。

前端改造方向以 [企业流程系统前端改造方案](docs/design/建工智管_企业流程系统前端改造方案_20260707.md) 为准；Web 管理端继续使用 Vue 3、TypeScript、TDesign 和 Vite，不引入第二套 UI 组件库。Gitee 开源后台只作为权限治理、流程待办、表格/表单和工程纪律参考，不迁移底座。

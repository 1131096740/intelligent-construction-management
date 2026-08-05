# 建工智管文档导航

仓库文档分为“当前控制面、冻结规格、运行证据、历史资料”四类。文件数量不代表默认阅读数量；日常开发只需沿当前控制面进入。

## 默认阅读顺序

1. `PROGRESS.md`：当前状态、下一步和未完成门禁。
2. `AGENTS.md`：业务红线、工程约束和验证要求。
3. `CONTEXT-MAP.md`：定位 API、Web Admin、shared-domain 和运维区域。
4. `prd.md`：冻结的实施包 1–5 与上线范围基线。
5. `docs/progress/2026-08-05-go-live-conditional-go.md`：当前最新发布与残余风险收据。

## 目录职责

| 路径 | 分类 | 是否持续维护 | 用途 |
| --- | --- | --- | --- |
| `docs/agents/domain.md`、`issue-tracker.md`、`triage-labels.md` | 当前控制面 | 是 | Issue、分诊和领域文档规则 |
| `docs/agents/go-live-remediation-*.md` | 冻结执行记录 | 否 | 2026-08-04 上线修复的范围和 blocking tickets，不是长期 agent 规则 |
| `docs/specs/`、`docs/plans/` | 当前或冻结规格 | 按任务 | 经确认的规格与实施计划 |
| `docs/runbooks/` | 当前控制面 | 是 | 可执行运维步骤 |
| `docs/product/` | 当前/生成证据 | 是 | 能力矩阵、route 与页面治理 |
| `docs/progress/` | 运行证据与历史 | 追加为主 | 发布、审计、恢复、交接收据 |
| `docs/design/` | 设计基线 | 决策变化时 | 当前架构和 UI 方向 |
| `docs/superpowers/` | 历史资料 | 否 | 旧规格、计划和 runbook，仅作事实追溯，不是可调用工作流 |
| `obsidian-current/` | 知识库镜像 | 需要同步时 | 面向业务阅读的产品与架构资料，不替代代码和生产证据 |

## 新文档规则

- 普通测试通过不单独创建进度文档，直接更新对应 Issue/PR 和 `PROGRESS.md` 摘要。
- 只有发布、生产操作、恢复演练、事故、重要审计或跨会话交接才新增 `docs/progress/YYYY-MM-DD-*.md`。
- 规格写业务边界，票据写可执行工作，`PROGRESS.md` 写当前状态；三者不得重复堆叠完整历史。
- 历史文档不批量改写或删除。发现过期内容时，在索引中降级为历史，并链接新的当前事实。

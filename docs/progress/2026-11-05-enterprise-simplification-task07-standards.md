# Standards r4 独立复审

固定点 `a4b325df8f2565222f1e6a9671f3d7122ee96b84` → 候选 `2e5f1557a3e4018277f98b371a8f5ce51e8b0c62`。已核refs、祖先关系、非空全diff（58路径）、五提交链及clean；r3→r4准确仅一份公开测试变化。

**文档标准违反0项；smell judgement0项。**

适用标准仍为候选AGENTS.md、PROGRESS.md、CONTEXT-MAP.md、三包CONTEXT.md、docs/agents/{domain,issue-tracker,triage-labels}.md、prd.md及当前适用规格。完整候选的权限、事务、冻结历史、领域API、中文业务错误、UI组件/token及公开测试边界未见需报告违反。

原P3已修复：`services/api/src/payable-registry/payable-registry.service.spec.ts:799`矩阵改为显式samePayer、originalDebtorActive、approvedPayerActive、actualPayerActive；测试名直接说明三个主体状态，夹具按字段映射，无位索引/正则编码。独立只读核算70条等价记录的旧状态含义及预期结果，逐行一致；diff保留原17条非矩阵案例和零写断言，未弱化业务验证。

十二项启发式已检查：Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man、Refused Bequest。当前小型显式矩阵满足可读性，不需进一步抽象。

抽核原r4完整日志为4套361项通过。限制：只读静态审查、等价核算与既有日志抽核，未自行运行测试、重派生清单、PG、资源、迁移、浏览器持久业务链或生产；未改候选，未触原dirty根。结论只属于此准确候选Standards轴，不替代Spec或发布资格。

# 阶段 E：P0-5B 真实试运行与治理矩阵收口（2026-08-04）

## 候选绑定

- 分支：`codex/five-package-go-live`
- 候选 SHA：`070de5c8368093bc3da3daa1c8825677dcd0f6dd`
- 工作树：运行前洁净；脚本要求并验证当前 HEAD 与 UAT 证据 SHA 一致。

## 本轮实际验证

使用 `run-contract-settlement-governance-uat-local.cjs` 启动临时 PostgreSQL 16、构建 API、执行完整迁移、seed 脱敏测试数据并启动本地 API；随后运行两个写入型验证：

1. 合同结算治理矩阵：20/20 必选场景通过。
2. P0-5B 真实试运行：通过历史合同接管、证据上传与受控下载、税务事实复核、双部门确认、期初结算、未确认接管付款阻断、当期结算审批/签名合成/归档生效、重复期间与空格绕过阻断、付款审批、出纳实付、付款凭证、财务入账、付款 PDF 归档和关键审计日志闭环。

成功输出：

```text
通过 P0-5B UAT：HT-UAT-governance-1785778687503-7609 -> JS-UAT-governance-1785778687503-7609 -> FK-UAT-governance-1785778687503-7609
通过合同结算治理 UAT 矩阵：20 个必选场景，候选 070de5c8368093bc3da3daa1c8825677dcd0f6dd
```

证据清单：`/tmp/contract-settlement-governance-20260804-070de5c8.json`（本地临时脱敏数据，未连接生产、未访问真实 COS）。

## 本轮修复

- 历史接管激活时冻结我方公司主体及版本快照，确保后续付款终审具备完整付款主体。
- 结算归档生效时关闭对应 `ContractSettlementProcess`，允许下一结算期间按状态机继续创建。
- UAT 临时“未确认接管”负向检查使用合法的临时结算方式确认坐标，并在 finally 中完整恢复原字段，避免验证器自身触发 `ContractVersion_settlementModeConfirmation_check`。
- UAT Prisma 空消息异常保留错误类型、堆栈和完整诊断，避免真实业务断点被显示成“未知错误”。

## 结论

P0-5B 和治理矩阵已通过，但这只证明核心业务长链路在隔离环境可运行，不等于五个实施包或整站 Go-Live Ready。RC-06（真实岗位 API-backed 浏览器长链）与 RC-09（全模块停写、运行时监控、备份/恢复和上线运维证据）仍未通过；数据库剩余动态测试、自然备份/隔离恢复、迁移守恒/回滚、请求账本和阶段 F 仍需按 `prd.md` 关键路径清零。当前不推送、不合并、不部署。

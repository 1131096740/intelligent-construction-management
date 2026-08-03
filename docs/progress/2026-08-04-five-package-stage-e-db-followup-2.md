# 五包阶段 E：PG16 动态数据库门复验收据（第二轮）

日期：2026-08-04
工作树：`codex/five-package-go-live`
候选 SHA：`88126ade`
验证范围：本机 Docker Desktop `postgres:16`，一次性数据库、127.0.0.1 随机端口、自动清理；不连接生产。

## 本轮结果

| Runner | 结果 | 关键证据 |
| --- | --- | --- |
| 合同模板场景并发 | passed | 完整 116 迁移、二次 deploy 零待办、Jest 7/7 |
| 合同结算 V2（清单批量替换 + 状态确认） | passed | 完整 116 迁移、二次 deploy 零待办、Jest 2/2；批量替换审计失败回滚与并发一胜一负通过 |
| 项目垫资额度并发 | failed，6/14 passed | #115 四类存量冲突均能拒绝、回滚并修复重试；Jest 14 项中 6 通过、8 失败 |

融资额度剩余失败的精确现象：

- F1/F2/F3 多组 `pg_blocking_pids` 竞争证据在本地容器中等待超时；
- 文件反向绑定收到通用 P2002，而不是期望的 `exclusive_file_business_binding_guard`；
- F2 夹具出现重复 FileObject id；
- 自然 Serializable 冲突被包装为 P2010，未归一到 P2034；
- #116 终态冻结触发器有一条不完整事实写入意外成功。

这些是当前候选的真实动态发布阻断，不能用“#115 迁移段通过”替代。下一步应逐项定位服务/迁移/测试夹具差异，并在同一 SHA 上复跑全套。

## 本轮夹具与证据修复

- 融资额度 runner 的存量迁移失败断言同时读取 `_prisma_migrations.logs`、Prisma 错误和临时 PostgreSQL 容器日志，避免把 PostgreSQL `RAISE EXCEPTION` 丢失成笼统的 `current transaction is aborted`。
- 合同清单批量替换测试夹具补齐当前 `lockContractDraftMutationBoundary` 与 Prisma 返回值实际读取的 `ContractTakeover`、正式文件/签章/归档/结算/付款表，以及 `ContractBillRow.taxExclusiveUnitPrice`、`ContractVersion.estimatedAmountCents` 和其余当前版本字段。
- 改动只涉及本地验收脚本和测试夹具，未修改生产 API、Schema 或迁移。

## 发布结论

本轮新增两个 runner 全部通过，但融资额度专项仍失败；此外阶段 E 仍缺真实四岗位 API-backed 长链、400/403/409/503 请求账本、54/54 动态测试闭环、自然备份隔离恢复、迁移前后守恒、全模块停写和运行监控证据。因此候选仍为 **NO-GO**，没有 push、merge、deploy 或生产连接。

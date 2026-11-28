# 2026-11-24 #416 历史合同接管状态约束回执

精确本地应用候选 `a79a9859f9835dd863241b83263b54dfa3a5bd9d`。修复前，`53e03c51` 在完整 328 条隔离迁移安装后执行 `submitReview`，数据库以 SQLSTATE `23514` 拒绝写入 `pending_finance`。[原失败回执](/private/tmp/jg382-takeover-db-probe.PxiMwtSP/run.log)

新迁移 `20261127000000_contract_takeover_pending_finance` 允许合同部提交后进入待财务填写。它保留原六种状态、原验证模式和放弃记录约束。既有 328 条迁移保持原字节。当前留存测试仅更新该生命周期的状态预期。原测试运行器及 31 项清单仍受原摘要约束。

- PostgreSQL 16 虚构隔离运行通过完整 329 条 Prisma 迁移。295 条历史前缀之后顺序安装 34 条，核对同一 TLS 数据库身份和 B7 基线。完整账本 SHA-256 为 `3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2`。末端 SQL SHA-256 为 `0bfe144cae30a7a29973c06dfb51737965fb9709e408db412f8d137d0663db4e`。
- 定向生命周期 1 项通过。数据库读回七种状态和放弃检查。用例执行实际提交、放弃及 Nest HTTP 台账读取，并核对历史凭据和原合同数据。容器和临时 PostgreSQL 已清理。回执 SHA-256 为 `0838d42e9c81a1c66c984d230a5f719dc231c4636fb496529692696634ce4104`。[隔离安装与定向运行回执](/private/tmp/jg382-329-integrated.Jo9OwUoa/focus.log)
- 精确当前基线及 19 项迁移和 CI 门禁测试通过。完整发布清单确认 877 条路由和 485 个页面动作，阻塞为零。银行、综合采购、项目采购、入职、POL113/POL114 具名及任务 398 两个浏览器分片的材料准备通过。[发布清单回执](/private/tmp/jg382-329-integrated.Jo9OwUoa/release.log)

## 合入封存库附件兼容后的完整留存分片

精确本地候选 `f94e038f4635edbb686465e935d2be1d303a2e4f` 用正式留存清理入口完成隔离 PostgreSQL 的 329 条迁移和全部 6 套原始测试。21 项真库及 10 项模型测试全部通过。同一 PostgreSQL 实例内的 205 条迁移封存库保持独立数据库及受限访问，主库权限核对一致。临时 PostgreSQL 和容器已清理，回执 SHA-256 为 `c411f888fd53c33bdc97327c8cbae93a19ef20be970d62af62c1ae4acc6b65fc`。[完整留存分片回执](/private/tmp/jg382-329-retained.R26Wws3J/retained.log)

银行、综合与项目采购、入职及 POL113/POL114 具名备料通过。文件绑定定向检查 46 项通过，另一项依赖真库的用例按配置跳过。证据范围为本地虚构应用与数据库，后续远端 CI 和上线验收分别核验。

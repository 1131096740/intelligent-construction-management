# 阶段 B 发布前本地审计（2026-07-12）

## 结论

**Request changes：当前不允许合并或部署。**

本轮只做代码、迁移、依赖、部署与生产聚合事实审计；没有推送、合并、部署、执行迁移或修改生产数据。

## 发布范围

- 生产与远程 `main`：`915b86b33e3fc3f387338e440cd1aeb93eae1265`。
- 候选分支 HEAD：`6aee9a80b5cc270768b6206724ae4c4700a7269c`。
- 生产 SHA 是候选 HEAD 的祖先；候选分支线性领先 91 个提交，无 merge commit，工作区干净。
- 聚合差异：296 个文件，新增 50,938 行，删除 2,071 行。按阶段 B 组织权限、阶段 C 合同治理、阶段 D 结算工作台与数据库迁移分组审计，不把该聚合差异当作一个小变更。
- 依赖 manifest、`pnpm-lock.yaml`、GitHub Actions 和生产部署脚本相对生产基线无变更。

## 数据库迁移

待发布迁移共 9 个：

1. `20260711130000_organization_directory_foundation`
2. `20260712023000_global_role_assignment_uniqueness`
3. `20260712153000_settlement_line_canonical_snapshots`
4. `20260712170000_settlement_import`
5. `20260712170500_layout_template_revision_safety`
6. `20260712171000_settlement_template_governance`
7. `20260712183000_contract_negotiation_rounds`
8. `20260712193000_contract_business_scenarios`
9. `20260712210000_contract_change_versions`

静态 SQL 审计未发现删表、`TRUNCATE`、业务 seed 或静默删除历史数据。生产显式只读事务的兼容性预检结果：

- 合同版本 6 条，只有 `original` 4 条、`historical_takeover` 2 条；未知类型 0。
- 同一合同多个有效版本 0，多个在办变更 0。
- 线下修订 0，来源文档孤儿 0。
- 全局岗位重复组 0。
- 结算明细 0，负数普通行、零额调整行均为 0。
- 受影响表体量很小，最大的 `User` 表统计为 27 行、98 KB。

本地 Docker 守护进程不可用，本轮没有伪造“真实 PostgreSQL 全量迁移已跑通”证据。正式发布前必须先完成新备份及临时恢复库迁移演练。

## 部署与回滚

- 现有脚本会在数据库迁移前完成依赖安装、Prisma generate 和 API/Web 构建。
- 迁移前会停止 API；迁移或后续发布失败时保持失败关闭，不让旧 API 继续写新 schema。
- 部署脚本**不会自动创建数据库备份**。推送 `main` 会直接触发 CI/CD，因此必须在推送前人工完成新备份、`pg_restore --list` 与恢复演练证据。
- schema 迁移不可靠简单回退 Git 撤销；失败回滚必须同时恢复发布前数据库备份与旧代码 SHA。

## 质量与安全门禁

已通过：

- Shared Vitest：7 个文件，60/60。
- Web Vitest：67 个文件，536/536。
- 全仓 typecheck、lint、API build、Web build、Web `check:ui`、API `check:business-errors`。
- Prisma validate/generate、新迁移 SQL 静态审计、运维 shell `bash -n`、`git diff --check`。
- 变更文件中无私钥/`.env` 类型文件，新增行的常见密钥/Token/带密码数据库 URL 模式扫描命中 0。

未通过：

1. **Required - API 全量测试失败。** 103 个套件中 101 通过、2 失败；2,477 项中 2,442 通过、35 失败。其中 34 项是结算控制器测试夹具未补新必填 `settlementTemplateVersionId`，1 项是权限影响测试把当前已合法的 `budget_director` 误当作非 `contract.approve` 岗位。两者均是过时测试证据，但在修复并全量回归前 CI 不会通过。
2. **Required - 上传依赖存在已知高危漏洞。** `pnpm audit --prod` 报告 4 个 high、6 个 moderate；4 个 high 均来自 `multer@2.0.2` 的拒绝服务漏洞，最低完整修复版本为 `2.2.0`。API 确实使用 `FileInterceptor`，不能当作不可达依赖。生产基线使用同一 lockfile，该风险不是本轮新增，但必须在此次大版本发布前收口。
3. **Required - 备份/恢复/真实迁移证据缺失。** 9 个新迁移尚未在由最新生产备份恢复的临时 PostgreSQL 库中跑通。

## 下一小步（第 2A 步）

1. 将 `multer` 以最小兼容方式固定到 `2.2.0`，重装冻结依赖，运行文件上传目标测试、全量测试与 `pnpm audit --prod`。
2. 只修正两类过时测试证据：结算合法夹具增加结算模板版本；权限用例换成真实非法的合同审批岗位。不放宽生产 DTO 或权限影响算法。
3. 重跑与 CI 一致的全量门禁；全部通过后再请求用户授权生产备份、临时恢复库迁移演练、异常清理及发布。

## 第 2A 步修复结果

**本地代码与依赖门禁已通过；生产备份/恢复/迁移演练仍是发布前阻断。**

- 漏洞可达路径：受认证的私有文件和个人签名 multipart 上传使用 Nest `FileInterceptor`，修复前最终解析到 `multer@2.0.2`。
- 安全不变式：不信任 multipart 输入不得触发已知的 Multer 资源耗尽/清理缺陷；同时必须保持现有认证、文件大小限制、文件名归一化、私有存储和审计行为。
- 最小修复：根工作区使用 pnpm override 将 Nest 的间接 `multer` 精确固定为 `2.2.0`；不升级 Nest 主版本，不修改上传 controller 或业务 API。
- 测试证据修正：结算 controller 合法夹具增加已经是生产必填的 `settlementTemplateVersionId`；权限非法节点用例改用真实不在 `contract.approve` 白名单的 `material_director`。未放宽 DTO 或修改权限影响算法。
- 安全闭环：`pnpm list` 确认所有 Nest 路径均解析到 `multer@2.2.0`；`pnpm audit --prod --audit-level high` 从修复前 4 high 降为 0 high，原始 finding 不再复现。
- 合法行为证据：文件 controller、个人签名 controller/service、结算 controller 与权限新增影响 5 个专项套件 175/175 通过。
- 全量门禁：Shared 60/60、Web 536/536、API 2,477/2,477；冻结 lockfile 安装、全仓 typecheck/lint、API/Web build、Prisma validate/generate、Web `check:ui`、API `check:business-errors`、`git diff --check` 全部通过。
- 剩余风险：`pnpm audit --prod` 仍报告 5 个 moderate，分布在 Nest/file-type/qs/ExcelJS 间接依赖；其中 Nest 公告的修复版本需主版本升级。本轮不用多个跨主版本 override 冒充安全修复，将其作为后续专项升级风险登记。

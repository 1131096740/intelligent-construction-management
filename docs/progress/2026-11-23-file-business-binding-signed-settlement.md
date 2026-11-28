# 已签变更/已签结算附件文件绑定回执

- 日期：2026-11-23（本地，Asia/Shanghai）
- 工作树 `/tmp/jgH`，分支 `line-h-file-binding`，基线 `f28d3ebac`
- 目标：修复 `file-business-binding.spec.ts` 与 `unified-file-business-binding-guard.spec.ts` 的真回归：schema 新增的 `ContractSignedChange.appendixFormalFileId`、`SignedContractSettlementAttachment.fileId` 未登记进数据库文件业务绑定体系。

## 1. 缺口

基线 `f28d3ebac` 只把两条绑定加进 TypeScript 注册表 `NON_RECEIPT_FILE_BINDINGS`，并把 `file-business-binding.spec.ts` 的长度断言改为 103。数据库侧仍缺：

1. `jg_file_business_binding_columns()` 中没有这两条元组，迁移文本中也没有对应的 `('Table','column',TRUE|FALSE)`；
2. `unified-file-business-binding-guard.spec.ts` 的迁移集合未纳入新迁移；
3. 该 spec 的 schema 清单实际是 105 条（`file-business-binding.spec.ts` 排除收货照片，故为 103 条），补齐两条后长度断言必须为 105，而不是 103。

## 2. exclusive 判定与依据

两条均判定为 `exclusive = TRUE`，不是猜测：

### `SignedContractSettlementAttachment.fileId` = TRUE

- schema `@unique`（`fileId String @unique`），迁移 `20261119004100_signed_contract_settlement_registration` 建 `SignedContractSettlementAttachment_fileId_key` 唯一索引；同一文件不能挂到第二条结算附件。
- 同一迁移已安装 `SignedContractSettlementAttachment_legacy_collision BEFORE INSERT ... jg_enforce_exclusive_file_business_binding('fileId','true')`，注释明确写着“Reuse the established exclusive binding check against predecessor business records”。这是既有代码对该列独占语义的直接声明。
- `SignedContractSettlementAttachment_frozen` 拒绝更新，`FileObject_signed_settlement_retention` 阻止已绑定原件的存储标识/状态变化。

### `ContractSignedChange.appendixFormalFileId` = TRUE（保守判定）

- 该列是 `ContractFormalFile(id)` 的 `UNIQUE` 外键，指向 purpose 为 `signed_change_appendix` 的签署原件；`jg_contract_signed_change_history_guard` 使提交后的补充协议不可删除、不可覆写。
- `jg_submit_contract_signed_change_v1` 在提交时遍历 `jg_file_business_collision_columns()`，要求该文件当前未被任何业务绑定，也不得位于替换链中；同一补充协议原件不允许复用。
- 同类“签署原件/独占业务事实”均为 TRUE：`ContractArchiveEvidenceFile.fileId`、`WageApprovedSourceVersion.evidenceFileId`、`ContractTakeover{SettlementEvidence,HistoricalPaymentVoucher,ExcessEvidence}.fileId`、`InterEntityRelationshipEvidenceClaim.fileId`；共享附件才为 FALSE。
- 语义边界：该列存的是 `ContractFormalFile.id`，不是 `FileObject.id`。真正的 `FileObject` 归属由已登记的 `ContractFormalFile.fileId`（FALSE）与提交函数预检保护。把它登记为 TRUE 是保守处理（避免把签署附录原件当共享附件），独占文件 ID 竞争查询对该列实际是惰性的；但不会误伤合法流程（附录 ID 为 `gen_random_uuid()`，与 FileObject ID 空间无交集）。
- 若后续产品明确允许同一附录原件被多个签署变更复用，需要业务决策与单独迁移降级；本次不降级为共享。

## 3. 迁移内容

新增 `services/api/prisma/migrations/20261119007500_signed_change_and_settlement_attachment_file_binding/migration.sql`（未改任何既有迁移）：

1. `BEGIN;` + `pg_advisory_xact_lock(190731, 13)`。
2. ACL 保留式注册表换代（按 `20261118185000_project_owner_settlement_voucher_binding` 范式）：
   - `SET LOCAL ROLE` 到 registry owner，拒绝第三方 grantor；
   - 旧 `jg_file_business_binding_columns()` 重命名为 `jg_file_business_binding_columns_before_signed_settlement()`；
   - 新建 `STABLE PARALLEL SAFE ... SET search_path = pg_catalog, public` 的 registry，= 旧函数 `UNION ALL`
     `('ContractSignedChange','appendixFormalFileId',TRUE)`、
     `('SignedContractSettlementAttachment','fileId',TRUE)`；
   - 逐条 REVOKE/GRANT，原 owner、PUBLIC 与其它 grantee 的 EXECUTE ACL 完整保留。
3. `CREATE TRIGGER jg_efb_contract_signed_change_appendix BEFORE INSERT OR UPDATE OF "appendixFormalFileId" ON public."ContractSignedChange" ... jg_enforce_exclusive_file_business_binding('appendixFormalFileId','true')`。
4. `SignedContractSettlementAttachment` 已由 `20261119004100` 的 `SignedContractSettlementAttachment_legacy_collision` 以同一守卫 `('fileId','true')` 保护且该表禁止 UPDATE，因此只登记注册表，不重复安装第二个独占触发器（迁移内有注释）。
5. 未新增 `bound()`：两张表只由应用角色或 SECURITY DEFINER 写路径写入，没有像业主结算凭证那样需要“受限角色 yes/no 旁路读”的调用方；本迁移也不改 `jg_enforce_exclusive_file_business_binding()`（其 body hash 被 catalog/recipe 与 `20261118230000` 的 exact-preimage 钉住）。

配套 pin 更新（新 registry 生成的 body sha256 为 `2a2b941651afd8763a7932f8ea110e845eb0851783ea86726b1da78ed20ded85`）：

- `src/database/registered-payment-catalog.ts`：当前 registry 接受 owner-settlement 版 `6d15e2b7…` 与本迁移版 `2a2b9416…`；否则 catalog 判定 `unavailable`，全部文件绑定检查会 503。
- `src/contract/contract-direct-pending-registered-binding.ts`：settlement 代 registry 接受 `6d15e2b7…` 与 `2a2b9416…`；否则直签待登记资格判定 fail closed。
- `prisma/database-dynamic-gate-manifest.json`：同步 323 个迁移目录、终态 `20261119007500...`、校验和 `27683ee9…`。

## 4. 测试与 typecheck

| 检查 | 结果 |
| --- | --- |
| `pnpm exec jest file-business-binding unified-file-business-binding-guard` | 通过：2 套件 / 18 用例 |
| `pnpm exec jest spot-procurement-core-schema file-binding-manifest` | 通过：53 用例（1 个数据库集成用例按环境跳过） |
| `pnpm exec jest file.service.spec operating-ledger.service.spec necessary-expense-reserve-file-access project-fund-dispute-file-access personnel-private-file-access spot-procurement-receipt.service` | 通过：472 用例 |
| `pnpm --filter @jiangkong/api typecheck` | 通过（含 shared-domain build） |
| `pnpm check:migration-baseline` | clean（323 / `20261119007500...` / `27683ee9…`） |
| 一次性 PostgreSQL 16 容器实跑本迁移 | 通过：registry 返回两条 TRUE + 旧业主结算行；`prosrc` sha256 与 `2a2b9416…` 一致；`proconfig={search_path=pg_catalog, public}`、STABLE、PARALLEL SAFE；owner/PUBLIC/`app_runtime` 的 EXECUTE ACL 保留；`jg_efb_contract_signed_change_appendix` 触发器存在 |

说明：`task12-direct-pending.http.spec.ts` 在本工作树有 5 个失败，已用基线源码（临时还原本迁移涉及的 2 个源文件）复跑确认**修复前同样失败**，与本改动无关。

## 5. 未覆盖项 / 风险

1. **未跑完整 323 条 `prisma migrate deploy`**：只用一次性 PostgreSQL 16 容器对最小 registry/两表/守卫桩执行了本迁移，验证语法、ACL、函数属性、哈希与触发器；未在全新库上重放全量迁移链。
2. **受限角色 / 冻结安装链需重基线**：`.github/task12-install-295/.../stage-pol109.py` 等冻结链仍钉终态 322 / `20261119007000`；新增迁移后需要像 295 重基线那样单独更新这些 lane。另，中心守卫在独占插入时会遍历 collision columns，现在会 SELECT 这两张新表；若 owned-DB 受限运行角色没有这两表的 SELECT 授权，需要后续授权的 ACL/plan 更新或 guard 旁路；本次不能修改 `jg_enforce_exclusive_file_business_binding()`（body hash 被钉住）。
3. **`appendixFormalFileId` 是经 `ContractFormalFile` 的代理绑定**：独占登记对该列的文件 ID 竞争检查是惰性的；实际 FileObject 保护来自 `ContractFormalFile.fileId` 与提交函数预检。未在真实数据库上执行“同 FileObject 重复绑定”冲突用例。
4. 既有 `ContractSignedChange` / `SignedContractSettlementAttachment` 历史行未做迁移前冲突预检；本迁移只装触发器，不改写业务数据。按现有范式，新独占列不回溯校验存量。

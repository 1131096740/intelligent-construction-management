# 建工智管 - 当前进度看板

> 本文件是项目的唯一进度登记入口，只保留当前结论、正在推进的事项、门禁和下一步。
>
> `AGENTS.md` 负责业务与工程规则；详细规格、运行证据和历史记录分别进入 `docs/specs/`、`docs/progress/` 与 GitHub Issues。
>
> 接手开发时先读本文件，再读 `AGENTS.md` 和相关领域文档；任何状态结论仍须与代码、Schema、迁移、测试、Git/CI、部署和生产只读证据交叉核验。

图例：`[x]` 完成 · `[~]` 已完成当前范围但有残余风险/持续观察 · `[ ]` 未完成

---

## 当前结论（更新至 2026-08-05）

- [x] 上线修复候选：`733ddb8192b95d11043c67da8b6e3965ec784680`。
- [x] 业务发布合并提交：`308c47b51c368a4573c9857411e59a872e1e5062`。
- [x] 最终上线决策：**Conditional Go**。
- [x] 精确 SHA CI、PostgreSQL 16 动态门、四类 `--require-ready`、RC-06 隔离业务长链、真实岗位 Chromium/WebKit 浏览器门、生产健康/备份只读核验及同机隔离部署 -> 回滚 -> 再部署均已通过。
- [x] 同机回滚演练仅使用 `127.0.0.1` 临时槽位、隔离数据库和本地文件存储，未修改正式生产业务数据。
- [~] 当前仅证明同一主机上的版本回滚能力；整机故障、跨主机接管及 DNS/入口网络故障转移未演练，继续作为已知残余风险。
- [x] 完整发布收据：[`docs/progress/2026-08-05-go-live-conditional-go.md`](docs/progress/2026-08-05-go-live-conditional-go.md)。

## 当前正在推进

### P0：仓库与协作控制面收敛

- [x] 根工作区恢复为干净 `main`，历史偏离状态已保存在独立 archive/recovery 分支，没有覆盖用户改动。
- [x] 旧脏 worktree 已先建立可恢复快照，再移除物理目录；恢复分支不得直接合并。
- [x] 建立 `CONTEXT-MAP.md`、文档导航、Issue/分诊/领域文档规则，并明确 `docs/superpowers/` 仅为历史资料。
- [x] 仓库控制面 PR #21 已合并为 `fc855cfef0d2ad0629cc7cc7dc6b9253993e7332`，且未触发部署。
- [x] GitHub 使用五态标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。
- [~] 根 `PROGRESS.md` 已压缩为实时看板；完整旧内容原样保存在历史快照中。
- [x] Issue #27（`pdfjs-dist` / CVE-2026-16633）已合并关闭：PR #28 已 squash 合并至 main（SHA `55956d350979878bfc7d293e8f33f01ceda76625`），GitHub Issue #27 已 `CLOSED`（COMPLETED）。直接依赖从 `6.1.200` 升至厂商修复下限 `6.2.108`，满足 GHSA-hq66-cqwq-w95j / CVE-2026-16633 修复下限；本地与远端 `pnpm audit --prod --audit-level high` 均无 high（仍有 5 个既有 moderate）；Web 全量测试、类型检查、lint、生产构建、UI 规则及精确 SHA PostgreSQL 16 动态门全部通过；远端 CI 复跑确认唯一失败仍为既有 #23 manifests blocker（`CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT`，非本票引入），该债务已单独立项 Issue #29 并修复关闭，见下条。
- [x] Issue #29 已合并关闭：PR #30 已 squash 合并至 main（SHA `1a2f6d762ece1551fb2f0fc0ca7dfbc013c41ed8`，合并提交 `1a2f6d76`），GitHub Issue #29 已 `CLOSED`（COMPLETED）。修复内容：校正 `route-usage.registry.json`（移除 `GET /contracts/lifecycle-ledger` 的 `exit_candidate` override、新增 `GET /contracts/workbench` override 并同步 `classificationOverrideSha256`）、校正 `retired-web-api-wrappers.json`（core-flow-read `test_only` 登记由 `fetchContractLifecycleLedger` 改为 `fetchContractWorkbenchLedger`），并按序重生成 web-api/page-actions/route-usage/capability-matrix/contract-workbench-capabilities 五个派生 manifest（同时合法同步 #9 迁移以来一直未重生成的既有 drift：core-flow-read 各 export 的 sourceLine 偏移、ContractDocumentPage 页面动作 sourceLine/角色补全、capability-matrix 输入 SHA 等，均以 live 源码为准）。门禁证据：`inspect:contract-workbench-capabilities` `matched`（不再抛 `CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT`）、`inspect:whole-site-web-api:ready`（432 wrappers / 452 bindings）、`inspect:whole-site-page-actions:ready`（241 actions / 0 blockers）、`inspect:whole-site-route-usage:ready`（446 routes / 0 unclassified）、`inspect:whole-site-capability-matrix:ready`（446 routes / 0 blockers）全部通过；全量 API jest 5850 + web-admin vitest 1949 + typecheck + lint 全部保持通过；远端 PR #30 CI Release gates 全 job success（含 `Verify capability and usage manifests` 首次全绿）。仅校正 manifest/registry 描述层，未改业务代码、Schema、权限模型、生产数据与 COS。
- [x] Issue #31 已合并关闭：PR #32 已 squash 合并至 main（SHA `61675ec7f16fb20538e4c8a4e515d7f817dfbb7b`，合并提交 `61675ec7`），GitHub Issue #31 已 `CLOSED`（COMPLETED）。背景：GitHub 自 2025-09-19 弃用 runner 上的 Node.js 20，CI `release-gates` 日志出现 `actions/checkout`/`actions/setup-node` 被强制跑在 Node 24 的弃用警告。修复内容：升级三个第三方 action 至 node24 运行时（覆盖 `ci.yml` 与 `deploy-production.yml` 全部 5 处引用）——`actions/checkout` v4→v7.0.1（SHA `3d3c42e5`）、`actions/setup-node` v4→v7.0.0（SHA `82076278`）、`actions/upload-artifact` v4→v7.0.1（SHA `043fb46d`）；`node-version: 20`（构建用 Node）保持不变，仅 action 自身运行时升至 node24。验收证据：PR #32 Release gates 全 job success（19/19 步骤）；该 run 日志（12552 行）检索无 `Node.js 20 is deprecated` / `forced to run` 警告（此前 #30 日志存在该警告）。仅改 workflow 描述层，业务代码 / Schema / 依赖清单不受影响。
- [~] Issue #34（CI 编排提速）已在独立分支 `codex/ci-orchestration-acceleration` 实施待远端验收：静态/manifest 与精确 SHA PostgreSQL 16 动态门拆为两个无依赖并行 job，并保留 `always()` 的 `Release gates` 汇总 job；新增 `inspect:release-manifests` 聚合入口，API 仅构建一次后直接执行六项 manifest 校验（四项仍带 `--require-ready`），未降低 120 migrations / 55 tests / 29 files 动态门。目标测试 4/4、聚合真实执行、typecheck、lint、Web build/UI、`git diff --check` 已通过；远端首跑由 2026-08-07/08 新公开的 nanoid 高危 advisory 阻断，已补最小 pnpm override 至 `3.3.17`（保留审计门，当前仅 5 个既有 moderate）；待推送修补后重新取得远端收据，未改生产数据库、生产数据或 COS 生命周期规则。
- [ ] 文档收敛 PR 合并后，复核最终 worktree/分支拓扑并归档旧 Codex 会话。

### P0：已删除草稿生命周期

- [x] 合同草稿删除与签署生命周期规格已收敛至 `docs/specs/2026-08-05-contract-draft-deletion-and-signing-lifecycle.md`。
- [x] GitHub 父 Issue #7 与 13 张子票 #8–#20 已建立，实施顺序和 `Blocked by` 依赖已冻结；当前仅无 blocker 的 #8 标记为 `ready-for-agent`，#9–#20 已移除该标签并须在各自 blocker 关闭后再逐票启用。
- [x] 规格已区分即时清理、审批型记录保留、数据库聚合、COS 全版本/删除标记及共享文件解除关联等边界。
- [x] 规格与 Issues 先于代码冻结；本候选未修改生产数据库、COS 生命周期规则或生产业务数据。
- [x] Issue #8 实现完成并已独立双轴复审：最终驳回已归入已结束、旧 `abandoned` 仅凭可核验旧删除事实进入隐藏清理候选、作废根合同视图互斥，合同台账/工作台按生命周期选择正确版本并收紧未提交草稿读取。全量 jest 295 套件/5761 测试、typecheck、lint、business-errors、ops safety、api/web build、check:ui、`git diff --check` 与四类 `--require-ready` 全部通过；本地 PostgreSQL 16 动态门绑定最终代码 SHA `9042d62034ffe8a4bf8ec14ec704bfac71ac0c4c`（119 migrations、pending 55/55、remaining 31/31、29/29 files、9 groups）。业务轴逐项满足 Issue #8 四项验收标准；代码轴独立复审 APPROVE（0 CRITICAL / 0 HIGH）。已知项：retention worker 暂只匹配 `abandoned` 且处于 preview-only，旧 `deleting` 记录清理归属后续子票；`canReadContractVersionDraft` 未传 `actorUserId` 时默认放行，当前所有调用点均已传值，作防御性观察。
- [x] Issue #9 实现完成（生命周期化合同可见性与台账视图）：后端按角色强制读取可见性三层（10 个全局全貌角色 / 8 个项目全貌角色 / `employee` 仅 7 字段摘要，未配置角色拒绝全貌），合同部主管与 `super_admin` 可在「我的草稿」查看全部未提交草稿（owner 仍仅见自己），正式台账排除草稿与已结束、`ended` 视图收纳已结束历史；前端由 7 标签工作台切换为 4 标签生命周期台账（正式台账/我的草稿/退回待修改/已结束），无权限访问 `my_drafts` 时回退正式台账，正式台账与已结束为只读。门禁证据：contract-read 79 + contract-draft-lifecycle 38 + ledger-read-positions 3 测试通过、API 全量 jest 5793 通过、web-admin vitest 1948 通过、`pnpm typecheck`/`lint`、`check:ui`、`git diff --check`、PG16 动态门 9/9 全部通过。附加：顺带补齐 `system-governance-readonly.config.ts` 缺失的 `abandoned`/`deleting` 状态标签，解除 main 上预先存在的 typecheck 阻塞（纯 label 补全，不改变业务行为）。
- [x] Issue #9 独立双轴复审完成：Spec 轴逐条核对五条验收标准全部 PASS（含拒绝路径与员工 7 字段摘要证据）；Standards 轴独立复审 0 CRITICAL / 0 HIGH / 3 MEDIUM / 2 LOW，已全部闭环修复——① 遗留 `/contracts/workbench` 端点补上可见性拦截（employee/未配置角色不再能经此拿到全量行，新增测试锁定），② 移除 `canReadPrivateDrafts` 死字段并让可见性解析直接返回 `full/summary/none`，③ 角色解析不可用时回退 full 增加一次性警告日志便于观测，④ 员工摘要排除已作废根合同（`voidedAt`），⑤ 前端 `fetchContractWorkbenchLedger` 标记 `@deprecated`（新代码统一走 `fetchContractLifecycleLedger`）。修复后 contract-read 79 + API 全量 5793 + web-admin 1948 + typecheck/lint 全部保持通过。
- [x] Issue #9 已合并关闭：PR #23 已 squash 合并至 main（SHA `1a8fa1058b9d70ef8d072218dda713cd33288284`），GitHub Issue #9 已 `CLOSED`；实现、门禁与双轴复核记录随 PR 进入 main。下游子票 #10–#20 的 blocking edge 依序解锁。
- [x] Issue #10 实现完成（精确文件绑定与版本化 COS 清理接缝）：新增 `VersionedObjectStorage` 接口 + `CosVersionedObjectStorage` 适配器（COS `GET /?versions&prefix=<精确键>` 版本/删除标记枚举、`DELETE /{key}?versionId=` 逐版本永久删除、`isConverged` 新鲜枚举收敛证明；4xx 除 429 判定为确定性错误不重试、429/5xx 才指数退避重试；诊断日志仅暴露对象键指纹）与 `InMemoryVersionedObjectStorage` 测试伪实现；新增 `file-binding-manifest.ts`（基于中心注册表 `NON_RECEIPT_FILE_BINDINGS` 的**行级**引用扫描 + 收货照片 + 替换链两侧，`classifyFileBinding` 纯函数区分 exclusive/shared，共享文件永不进入对象清理候选；每行可追溯到业务记录/对象键/版本快照/绑定类型），`buildContractFileBindingManifest`/`buildFileBindingManifest` 固定 `preview_only`/`executionAllowed=false`；新增 `FileCleanupSeamService`（`previewManifest` RepeatableRead 只读事务、`assertExactObjectKeyScope` 拒绝 uploads/uploads/ 前缀/尾部斜杠/`..`/`\0`/空集、`deleteExactObjects` 精确键删除原语收敛失败抛 `PartialDeletionError` 仅暴露指纹与残留版本数，诊断重枚举失败用 -1 表示未知）；无 HTTP 删除路由、无桶级 lifecycle/versioning/deleteBucket API，生产 COS 生命周期规则与桶配置不变。门禁证据：file 三套件（versioned-object-storage 14 + file-binding-manifest 20 + file-cleanup-seam.service 12）46 测试 + 全量 API jest 5839 通过，typecheck/lint/build/check:business-errors（新增 1 条启动配置保护 allowlist）/git diff --check 全部通过；本地 PostgreSQL 16 动态门绑定最终代码 SHA `8c3a961bff19ed45e44dde0dfeb0e05b1dca6ea9`（119 migrations、9 groups 全部 passed，含新增 `file_binding_manifest` 组在隔离 schema 真实 PG 验证 11 exclusive / 2 shared / 13 对象与替换链分类）。四类 `--require-ready`：route-usage 本体 PASS；web-api/page-actions/capability-matrix 因全站既有 #23 遗留 blocker（`core-flow-read.api.ts` 两个 orphan wrappers `fetchContractWorkbenchLedger` test_only / `fetchContractLifecycleLedger` registry_invalid）按预期 exit 1，本票引入 0 个新 blocker；顺带同步 `nest-business-routes.json`/`route-usage.json` 中 #23 `LEDGER_READ_POSITION_KEYS` 角色变更的 6 条 ledger 路由角色元数据（合法同步，非本票业务改动）。
- [x] Issue #10 独立双轴复审完成：业务轴逐条核对 Issue #10 五项验收标准全部 PASS（每对象可追溯业务记录/对象键/版本/绑定类型、共享文件只解除业务关联而独占文件才进入对象清理候选、适配器测试覆盖当前/历史版本/删除标记/重试/幂等、默认只读且拒绝 uploads 整体前缀作为删除范围、生产 COS 生命周期规则与桶配置保持不变），七项安全边界（不连生产 COS、不删真实对象、无 HTTP 删除路由、preview-only 默认、禁 uploads 前缀删除范围、仅精确键删除、日志仅暴露指纹）全部符合；代码轴独立复审 APPROVE（0 CRITICAL / 0 HIGH / 2 MEDIUM / 1 LOW）且已全部闭环修复——① COS HTTP 4xx 除 429 判定为非确定性错误不再空转 3 次退避重试（新增测试锁定），② 不收敛诊断重枚举失败时残留版本数用 -1 表示未知而非误报 0（新增测试锁定），③ 重构 `withObjectStorageRetry` 消除不可达的兜底抛出并使末次重试不再执行无用退避（行为不变）。修复后 file 三套件 46 测试 + 全量 API jest 5839 + typecheck/lint/build 全部保持通过。
- [x] Issue #10 已合并关闭：PR #24 已 squash 合并至 main（SHA `91c9be5fa7f7589e98fe34e8581cbc885fa53f65`），GitHub Issue #10 已 `CLOSED`；实现、门禁与双轴复核记录随 PR 进入 main（含 file 三套件 46 测试、全量 API jest 5839、PG16 动态门 9 groups 全过、CI 仅 manifests 步骤因全站既有 #23 blocker 按预期失败）。下游子票 #11–#20 的 blocking edge 依序解锁。
- [x] Issue #11 实现完成（生成无水印外发合同文件并提前分配正式编号）：`ContractDocumentPurpose` 新增 `external`；首次 external 生成在 queue 事务内 `allocateDaily(tx, "HT")` 分配正式编号并永久锁定，重复生成复用编号（`updateMany({where:{code:null,voidedAt:null}})` count!==1 抛错，失败不产生半成品编号），提交审批路径复用已锁定编号；`renderValues` 对 external 输出空水印，renderer 新增 `allowBlankWatermark` 策略仅豁免 `document.watermark`（其余必填校验不变）；`processDocument` 按 purpose 传 `{ allowBlankWatermark: job.purpose === "external" }`，`failDocument` CAS 补上 `sourceRevision` 守卫与 success/stale 对称；前端移除用途分段选择，改为单一「生成合同文件」（purpose: external），`purposeLabelMap` 保留 legacy 读取展示。门禁证据：contract-document 六套件 + file.service 回归全绿、API 全量 jest 5850、web-admin vitest 1949、typecheck/lint/build/check:business-errors、`git diff --check` 全部通过；四类 `--require-ready`：route-usage 本体 READY（446 routes、0 unclassified），web-api/page-actions/capability-matrix 因全站既有 #23 blocker（`core-flow-read.api.ts` 两个 orphan wrappers）按预期 exit 1，本票引入 0 个新 blocker；CI manifests 步骤 `inspect:contract-workbench-capabilities` 抛 `CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT`（`GET /contracts/lifecycle-ledger` ← `fetchContractLifecycleLedger` ← `ContractListPage.vue`），经临时 worktree 在干净 main（`706c6e41`）复现同一失败，确认三者文件本票零改动，属 #23 既有失败、非本票引入（与 #23/#24 合并时 "Release gates FAILURE" 放行惯例一致）；本地 PostgreSQL 16 动态门绑定最终代码 SHA `e11a1ae503ff593b45ef461dbd14b151106e1fa2`（119 migrations、32 tests、9 groups 全部 passed）。
- [x] Issue #11 独立双轴复核完成：业务轴逐条核对五条验收标准全部 PASS（首次生成分配并锁定编号/重复生成复用、DOCX 与 PDF 均无水印、下载走实时权限校验 + 审计日志、失败不产生半成品编号或错误文件绑定、扩展期保留旧用途读取兼容且有测试保护）；代码轴独立复审 APPROVE（0 CRITICAL / 0 HIGH / 1 MEDIUM / 1 LOW）且已闭环——① MEDIUM：`failDocument` CAS 补上 `sourceRevision` 守卫，防止并发翻 stale 后误标 failed（新增测试锁定），② LOW：前端 `purposeLabelMap` 与后端 `PURPOSE_FILE_LABELS` 存在显示层重复，属既有模式且带回退保护，记录接受不做跨包重构。修复后 API 全量 5850 + typecheck/lint 保持通过。
- [x] Issue #11 已合并关闭：PR #25 已 squash 合并至 main（SHA `8045b42c3e455b0af1675e6dab98519ced51ee22`），GitHub Issue #11 已 `CLOSED`（COMPLETED）；实现、门禁与双轴复核记录随 PR 进入 main，CI 唯一失败为 manifests 步骤既有 #23 blocker（`inspect:contract-workbench-capabilities` 抛 `CAPABILITY_EXIT_CANDIDATE_CONSUMER_PRESENT`，已在干净 main `706c6e41` worktree 复现同一失败，本票零改动），重跑受 GitHub runner 基础设施抖动影响。下游子票 #12–#20 的 blocking edge 依序解锁。
- [x] Issue #12 实现完成（接收并冻结灵活格式的乙方签章文件）：复用 `ContractFormalFile` 表新增 `counterparty_signed`（每个原文件一行）与 `counterparty_signed_preview`（规范化预览）两种 purpose，**无 Schema 迁移**。规范化策略：单 PDF inline（preview fileId=原文件、不新建对象）、单 DOCX 用 libreoffice 转 PDF、多图用 pdf-lib 合并 A4 PDF（等比居中、按 magic bytes 识别 PNG/JPEG）；混合格式拒绝并提示分批上传。upload/confirm 在 Serializable 事务内执行：`lockEditableVersion` + `sourceRevision` 与 `draftRevision` 一致性检查 + 旧批次 superseded + 审计（`contract.formal_file.counterparty_upload` / `counterparty_confirm`）；确认记录操作者、时间与 `confirmedAtRevision`，list 实时计算 `confirmationValid`（草稿修订变更后自动失效）。文件访问复用 `governedContractFileAccess`（无 purpose 过滤，与既有 `approval_original` 同标准，实时权限校验 + 下载审计）；`governedSigningFacts` 过滤 counterparty purpose 防止泄漏到既有 formal-files 视图。前端新增 `ContractCounterpartySignedFilesPanel`（t-upload 多文件 auto-upload=false + 一次整体确认），三个新 wrapper 经 workbench capability action 门控（`upload_contract_counterparty_signed_files` / `confirm_contract_counterparty_signed_files`）。门禁证据：API 全量 jest 5864、web-admin vitest 1951、typecheck/lint/build、`git diff --check` 全部通过；CI manifests 步骤 6 项全绿（contract-workbench capability matrix `--check` matched、whole-site capabilities 449 routes OK、web-api 435 wrappers/455 bindings、page-actions 244 actions/0 blockers、route-usage 449 routes/0 unclassified、capability-matrix 449 routes/0 blockers）；本地 PostgreSQL 16 动态门绑定最终代码 SHA `cf72822d977a479c4f8b85f6d82743ad99f9246f`（119 migrations、32 tests、9 groups 全部 passed）。修复记录：CI 首跑在 manifests 步骤因 `inspect:contract-workbench-capabilities` 检出 `contract-workbench-capability-matrix.md` drift 失败（3 条 counterparty 路由未登记、面板未入调用方列表），以 `--write` 重新生成并提交 `c2bb6722` 修复，6 项校验全部复跑通过。
- [x] Issue #12 已合并关闭：PR #26 已 squash 合并至 main（SHA `75e8f4279f9325a24e903cec208e2e4307c38afe`），GitHub Issue #12 已 `CLOSED`（COMPLETED）；实现、门禁、独立审查与修复记录随 PR 进入 main，CI Release gates **success**（manifests 步骤 6 项校验全绿），下游子票 #13–#20 的 blocking edge 依序解锁。
- [ ] Issue #9–#20 在各自 blocking edge 解除前不得并行写共享 Schema 或权限模型；Issue #8 关闭后才重新启用直接下游票据。
- [ ] 未经单独授权，不修改生产业务数据、生产数据库记录或 COS 对象/生命周期规则。

### 上线后业务观察

- [ ] 合同部/法务对最新合同母版 DOCX 逐页人工签认，不以 PDF/PNG 自动检查代替。
- [ ] 按“发生后续结算/付款前先接管并确认余额”的原则继续完成历史合同接管，不把存量事实视为已全部初始化。
- [ ] 使用真实岗位验证首批合同、结算、付款、实付、凭证和归档闭环，并保留业务与财务签认。
- [ ] 继续抽查真实中文附件的移动端上传、受控下载、二次确认和审计记录。
- [ ] 在具备第二台生产等价主机后补做跨主机恢复与接管演练；完成前不得宣称完整灾备已验证。

## Go-Live 门禁状态

| 门禁 | 状态 | 当前证据口径 |
| --- | --- | --- |
| `POST /files` 权限旁路 | [x] | 岗位白名单、Guard -> ValidationPipe -> Service 顺序和拒绝路径已验证 |
| 结算审批过期状态 | [x] | 稳定 HTTP 409 / `SETTLEMENT_APPROVAL_REVIEW_CONFLICT`，并验证零写入 |
| 99 个治理 blocker | [x] | Web/page/route/capability manifests 均为 ready，无 blocker |
| 3 个重复 mutation route | [x] | 已收敛为领域唯一写入口，不以通配豁免隐藏 |
| CI 动态数据库门 | [x] | PostgreSQL 16：最终精确 HEAD 已通过 119 migrations、55/55 tests、29/29 files、9 groups；remaining-dynamic 31/31 tests |
| 四类 `--require-ready` | [x] | Web API、页面动作、route usage、capability matrix 全部硬门通过 |
| 最终 SHA 与差异证据 | [x] | CI/部署输入绑定候选 SHA；候选工作树和 `git diff --check` 已核验 |
| P0 与五包 Task 11 | [x] | 已纳入最终候选并通过候选级回归；详细过程见历史快照和发布收据 |
| RC-06 隔离业务长链 | [x] | 合同 -> 结算 -> 付款闭环与 20 个治理场景，`productionData=false` |
| RC-06 真实岗位浏览器 | [x] | Chromium 1366x768、WebKit 390x844；五类岗位及 400/403/409/503 |
| 503、双击幂等、移动文件链 | [x] | 写冻结 503、并发上传幂等、上传下载内容回读均有证据 |
| 备份隔离恢复与监控 | [x] | 自然异机备份、checksum、隔离恢复、健康/readiness 和监控证据通过 |
| RC-09 / 阶段 F | [~] | 同机隔离部署 -> 回滚 -> 再部署通过；跨主机与整机故障未演练 |

## 生产与运维边界

- 生产业务写入、账号/权限变更、数据库修复、COS 对象删除或生命周期变更必须获得单独明确授权。
- 日常备份巡检默认只读，只验证自然 Cron 产物、checksum、`pg_restore --list`、异机回执、日志/进程和公共健康状态。
- 发生发布异常时先停写、确认当前运行 SHA 与最新可恢复备份，再按 runbook 回滚；不得在证据不完整时继续迁移或写入。
- 精确候选 SHA 发生任何代码变化后，旧的 CI、数据库、浏览器和生产证据不再自动适用，须重新绑定并运行受影响门禁。
- 当前生产为单机部署；自然异机备份是数据恢复控制，不等于应用跨主机高可用。

## 模块状态

- [x] 核心业务闭环：合同草稿、审批、用章、归档、生效、结算、付款申请、实付、凭证、财务记录、PDF 与审计已具备。
- [~] 审批引擎：实例冻结、会签、或签、撤回、退回、转审、委托和催办覆盖核心链路；条件节点仍缺显式合同类型字段，后续变更继续以服务端状态机为准。
- [x] 认证与授权：手机号密码、强制改密、项目岗位权限、敏感动作校验和审计已覆盖当前生产范围。
- [~] 文件/PDF/审计：私有存储、短时效下载、二次确认和审计已覆盖主要链路；真实业务附件继续观察。
- [~] Web Admin：桌面与手机共用 Vue 3 + TDesign 响应式 Web；真实尺寸和业务长链持续验收。
- [~] 小程序退出：目标架构已决定，但 `apps/miniprogram`、微信登录入口和 `wxOpenid` 清理尚未按两阶段计划实施。

## 不在当前 P0 范围

- OCR/AI 批量识别、开票、考勤、人事、安全、完整物料领用和大型经营驾驶舱。
- 已签历史合同重走合同审批；历史合同继续按接管、余额确认和后续业务触发原则治理。
- 未经重新定界，不新增第二套 UI 库、低代码运行时、通用工作流引擎或全站重写。

## 历史与证据索引

- 本次压缩前的完整进度快照：[`docs/progress/full-history-snapshot-through-2026-08-05.md`](docs/progress/full-history-snapshot-through-2026-08-05.md)
- 2026-07-07 以前的早期历史：[`docs/progress/full-history-through-2026-07-07.md`](docs/progress/full-history-through-2026-07-07.md)
- 当前发布收据：[`docs/progress/2026-08-05-go-live-conditional-go.md`](docs/progress/2026-08-05-go-live-conditional-go.md)
- 文档导航：[`docs/README.md`](docs/README.md)
- 文档有效性索引：[`obsidian-current/建工智管_文档有效性索引.md`](obsidian-current/建工智管_文档有效性索引.md)

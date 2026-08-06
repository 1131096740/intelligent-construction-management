# Handoff：Issue #10 收尾 → Issue #11 启动

日期：2026-08-06 · 交接：Claude 会话（完成 Issue #10）→ 新会话（实施 Issue #11）

## 1. 仓库状态（已推 main）

- main 最新：`09c2a72a`（docs: record issue-10 merge closure）
- PR #24 已 squash 合并（`91c9be5f`），Issue #10 已 `CLOSED`（收尾凭证 comment：issuecomment-5206850969）
- 本交接文件已 commit 于 main

## 2. 票集状态（父 #7，子票 #8–#20 按 Blocked by 解锁）

- #8 CLOSED、#9 CLOSED、#10 CLOSED
- **#11 OPEN，已标 `ready-for-agent`（唯一 blocker #8 已关闭）** ← 新会话认领这张

## 3. Issue #11 内容：[合同生命周期 04/13] 生成无水印外发合同文件并提前分配正式编号

合同工作台一键生成无水印 DOCX 和 PDF，首次生成时分配并永久占用正式编号，通过短时下载地址直接下载。

验收标准：
1. 同一草稿首次生成分配正式编号，后续重复生成不更换编号
2. DOCX 和 PDF 均不含草稿状态水印或下载人水印
3. 下载前实时校验权限并记录审计日志
4. 生成失败不产生可复用的半成品编号或错误文件绑定
5. 扩展期保留旧生成读取兼容，切换策略有测试保护

Out of scope：不改收货照片等业务证据水印；不执行生产编号回填。

## 4. 关键代码坐标

- 文档生成模块：`services/api/src/contract-document/`
  - `contract-document.service.ts` — 主服务；`PURPOSES = new Set(["draft","negotiation","internal_review"])`（#11 大概率新增外发/正式用途）
  - `contract-document.processor.ts:954` — `values["document.watermark"] ??= "预览"`（草稿状态水印来源）
  - `contract-docx-renderer.ts` / `contract-docx-extractor.ts` / `libreoffice-converter.ts` / `pdf-normalizer.ts`
  - `contract-document.types.ts` / `contract-placeholder-registry.ts` / `contract-negotiation.service.ts`
- 正式编号：`services/api/prisma/schema.prisma`
  - `BusinessDailySequence`（prefix+businessDate 独立日递增，允许断号不回收）
  - `ContractNumberRule`（编号规则）
  - `ContractVersion.temporaryCode`（草稿临时码）、`formalCode`
- 生成文档绑定：`ContractGeneratedDocument`（docxFileId/pdfFileId/contractVersionId）；其行级绑定已注册在 `services/api/src/file/file-binding-manifest.ts` 的 `CONTRACT_VERSION_FILE_BINDINGS`（#10 建立，供后续清理编排）
- 核心不变量：正式编号分配必须「先占号、失败回滚、不产生半成品编号」（对应验收 1+4）；已有测试模式见 `contract-document*.spec.ts`、`database/contract-draft-lifecycle-core-schema-verification.spec.ts`

## 5. 实施纪律（沿用 #8/#9/#10 流程）

1. 先读根 `PROGRESS.md`（唯一登记入口）与 `docs/specs/2026-08-05-contract-draft-deletion-and-signing-lifecycle.md`
2. 认领：`gh issue comment 11 --body "claimed..."`；branch `codex/contract-draft-lifecycle-issue-11` 从 main 切出
3. TDD：RED → GREEN；资金/状态迁移/权限/版本追溯相关必须加测试
4. 门禁（全绿）：
   - API 全量 jest、typecheck、lint、build、check:business-errors、git diff --check
   - 四类 `--require-ready`：route-usage 应 PASS；web-api/page-actions/capability-matrix 因全站既有 #23 blocker（`core-flow-read.api.ts` 两个 orphan wrappers）按预期 exit 1，**不要修复**（属 #23 清理范围），PR 记录即可
   - 本地 PG16 动态门：先 commit（要求 clean worktree + candidate SHA）→ 设 `LOCAL_PG16_DYNAMIC_GATE=LOCAL_PG16_DYNAMIC_GATE`、`DATABASE_DYNAMIC_GATE_CANDIDATE_SHA=<sha>`、`DOCKER_HOST=unix:///Users/leoyang/.docker/run/docker.sock` → `pnpm --filter @jiangkong/api verify:database-dynamic-remaining:local`；如需新增 gated DB spec，加到 `services/api/prisma/run-database-dynamic-remaining-local.cjs`（full gate 走 `database-dynamic-gate-manifest.json`，不由此 runner 管理）
5. 双轴复核：业务轴对照 Issue #11 五条验收标准；代码轴用 code-reviewer agent；findings 全部闭环后再 commit
6. PROGRESS.md 更新 + commit；PR → squash 合并 → `gh issue close 11 --comment` 带最终 SHA
7. 已知：CI "Release gates" 会在 manifests 步骤失败（既有 #23 blocker），与 #23/#24 同模式；其余步骤应全绿

## 6. 环境备注

- pnpm workspace；node_modules 曾损坏，修复命令 `CI=true pnpm install --frozen-lockfile --config.confirmModulesPurge=false` + `prisma generate`
- Docker postgres:16 镜像已缓存（imageId `33f923b0...`）

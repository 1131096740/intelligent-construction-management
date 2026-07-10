# Phase 0A Release Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除当前唯一已知测试失败，证明当前 246 个提交的聚合分支可发布，并在备份和健康门槛通过后把它快进为唯一 `main` 生产基线。

**Architecture:** 不改业务规则、不重写 Git 历史。修正陈旧测试断言，执行仓库全量自动验证，推送当前实施分支作为远端备份，再以 `HEAD:main` 快进触发现有 GitHub Actions；用正式域名和运行检查确认部署结果。

**Tech Stack:** Git, pnpm, Jest, Vitest, Vue TSC, ESLint, Vite, Nest CLI, GitHub Actions, curl.

---

## 现状约束

- 2026-07-10 检查结果：`git rev-list --left-right --count main...HEAD` 为 `0 246`。
- 当前只有两处失败，均是测试仍期待旧英文错误，实际共享实现已正确返回中文错误。
- `.github/workflows/deploy-production.yml` 只监听 `main`，并依次执行 install、Prisma generate、typecheck、lint、test、API/Web build、远端 fast-forward 和 `deploy.sh`。
- 执行时若 `main...HEAD` 左侧不再为 0，立即停止发布并重新审计分支；不得强推。

### Task 1: 修正陈旧错误断言

**Files:**

- Modify: `services/api/src/contract-bill/contract-bill.service.spec.ts`
- Modify: `services/api/src/business-party/business-party.service.spec.ts`
- Verify unchanged behavior: `services/api/src/contract-workbench/contract-render-input-revision.ts`

- [ ] **Step 1: 先重现两处失败**

Run:

```bash
pnpm --filter @jiangkong/api test -- \
  src/contract-bill/contract-bill.service.spec.ts \
  src/business-party/business-party.service.spec.ts \
  --runInBand
```

Expected: 两处用例因期望 `Contract draft revision/status conflict`、实际为 `合同草稿已变化，请刷新后重试` 而失败。

- [ ] **Step 2: 只更新测试断言**

将两处 `rejects.toThrow("Contract draft revision/status conflict")` 改为：

```ts
rejects.toThrow("合同草稿已变化，请刷新后重试")
```

不得修改 `bumpContractRenderInputRevision` 或状态迁移行为。

- [ ] **Step 3: 跑针对性测试**

Run 同 Step 1。

Expected: 两个测试文件全部通过。

- [ ] **Step 4: 更新进度并提交**

在 `PROGRESS.md` 最近摘要记录“阶段 0A 修正两处陈旧英文断言，业务实现未变”。

```bash
git add \
  services/api/src/contract-bill/contract-bill.service.spec.ts \
  services/api/src/business-party/business-party.service.spec.ts \
  PROGRESS.md
git commit -m "test: 对齐合同草稿冲突中文提示"
```

### Task 2: 建立全量可发布证据

**Files:**

- Create: `docs/progress/2026-07-10-release-baseline.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 重新确认工作树与分支拓扑**

```bash
git status --short --branch
git fetch --all --prune
git rev-list --left-right --count main...HEAD
git merge-base --is-ancestor main HEAD
```

Expected:

- 工作树无未提交业务文件。
- `main...HEAD` 左侧计数为 0。
- `merge-base --is-ancestor` 退出 0。

- [ ] **Step 2: 执行全量仓库验证**

```bash
pnpm --filter @jiangkong/api exec prisma generate
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
git diff --check
```

Expected: 全部退出 0；API 为 62/62 测试套件通过，Web 为 39/39 测试文件通过或更多。

- [ ] **Step 3: 记录发布基线**

`docs/progress/2026-07-10-release-baseline.md` 必须记录：

- `git rev-parse HEAD` 完整 commit。
- `main...HEAD` 左右计数。
- 上述每条验证命令、执行时间和结果。
- 已知未完成范围：金额 BigInt、COS 正式接入、组织权限 UI、办公化工作台。
- 明确“代码可发布”不等于“第一版全部完成”。

- [ ] **Step 4: 更新进度并提交**

```bash
git add docs/progress/2026-07-10-release-baseline.md PROGRESS.md
git commit -m "docs: 记录阶段零发布基线"
```

### Task 3: 远端备份与生产前检查

**Files:**

- Read: `.github/workflows/deploy-production.yml`
- Read: `docs/superpowers/runbooks/2026-07-03-production-acceptance-runbook.md`
- Read: `scripts/ops/db-backup.sh`
- Read: `scripts/ops/check-runtime-health.sh`

- [ ] **Step 1: 推送实施分支作为发布前备份**

```bash
git push origin HEAD:codex/office-workbench-plan-20260709
```

Expected: 远端分支指向本地 `HEAD`，无 force push。

- [ ] **Step 2: 检查当前线上仍可用**

```bash
curl -fsS https://jgzg.site/api/health
curl -fsSI https://jgzg.site/
```

Expected: API 返回健康响应，首页返回 2xx/3xx，TLS 校验通过。

- [ ] **Step 3: 执行发布前数据库备份**

按生产服务器现有 `/etc/jiangkong/api.env` 加载环境变量，运行：

```bash
BACKUP_DIR=/srv/jiangkong-backups/db /opt/jiangkong/scripts/ops/db-backup.sh
```

Expected: 生成新的非空 PostgreSQL custom-format 备份；记录文件名和时间，不把连接串或密码写入仓库。

- [ ] **Step 4: 确认迁移和生产就绪预检**

在服务器部署目录加载生产环境后运行：

```bash
pnpm --filter @jiangkong/api exec prisma migrate status
CHECK_DATABASE_STATE=true pnpm --filter @jiangkong/api verify:production-readiness
```

Expected: 已有迁移状态正常；生产密钥、数据库、COS、转换器和 seed 账号检查无阻断错误。

### Task 4: 快进 main 并验证部署

**Files:**

- Modify: `PROGRESS.md`
- Append: `docs/progress/2026-07-10-release-baseline.md`

- [ ] **Step 1: 发布前最后一次祖先检查**

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git merge-base --is-ancestor origin/main HEAD
```

Expected: 左侧计数为 0，祖先检查退出 0。否则停止，不推送 main。

- [ ] **Step 2: 非强制快进生产主线**

```bash
git push origin HEAD:main
```

Expected: Git 输出 fast-forward 更新；GitHub Actions 启动 `Deploy Production`。

- [ ] **Step 3: 等待工作流完成**

若已登录 GitHub CLI：

```bash
RUN_ID="$(gh run list --workflow deploy-production.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status
```

Expected: verify 和 deploy job 均成功。若没有 GitHub CLI，则在 GitHub Actions 页面确认同一 `HEAD` 的工作流成功后再继续。

- [ ] **Step 4: 验证正式环境**

```bash
curl -fsS https://jgzg.site/api/health
curl -fsSI https://jgzg.site/
```

服务器运行：

```bash
cd /opt/jiangkong
git rev-parse HEAD
scripts/ops/check-runtime-health.sh
```

Expected:

- 服务器 commit 等于发布的 `HEAD`。
- 正式域名 TLS、Web、API 均可用。
- `check-runtime-health.sh` 输出 `runtime health ok`。

- [ ] **Step 5: 记录结果并提交**

在发布基线记录补充工作流 URL/编号、生产 commit、健康检查结果和回滚备份文件名；在 `PROGRESS.md` 标记阶段 0A 完成。

```bash
git add docs/progress/2026-07-10-release-baseline.md PROGRESS.md
git commit -m "docs: 记录生产发布验证结果"
git push origin HEAD:main
```

Expected: 文档提交通过同一工作流发布，生产仍健康。

## 回滚条件

出现以下任一情况立即停止后续阶段：

- GitHub verify 或 deploy 失败。
- 服务器无法 fast-forward、工作树脏或 commit 不一致。
- 正式域名/API 健康失败。
- 数据库迁移状态异常。

回滚只使用发布前备份和已确认的上一生产 commit；禁止 `git reset --hard` 或未经确认覆盖数据库。先恢复服务，再单独诊断失败层。

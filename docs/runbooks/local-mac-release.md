# 本机完整门禁 + 低分钟手动部署

日常开发验证和完整发布门禁都在 operator 的 Mac 执行。Pull Request 和普通
`main` push 不会运行 GitHub Actions；只有一次已经通过本机完整门禁、并获得
单独生产授权的发布，才会手动启动一个 deploy-only workflow。

生产机仍只接受 `origin/main` 的精确提交，并在服务器端自行构建、备份、迁移、
重启、健康检查和失败恢复。

这不授权自动发布。每一次生产部署仍需要单独的业务/生产授权。

## 一次性本机准备

1. 使用 Node.js 20。项目最低支持版本是 Node 20，但本机发布门禁固定
   Node 20 以匹配现有生产验证环境；不要用全局 Node 22 替代它。
2. 使用 pnpm 9，并在项目根目录完成依赖安装。
3. 启动 Docker Desktop，并预拉一次本地数据库镜像：

   ```bash
   docker pull postgres:16
   ```

4. 在 Mac 上以有仓库写权限的账号完成 `gh auth login`。它只用于手动发起
   deploy-only workflow，日常 `check:fast` 和 `release:local` 不会调用它。
5. 在 GitHub 仓库 Settings → Secrets and variables → Actions 配置五个
   repository secrets：`DEPLOY_HOST`、`DEPLOY_USER`（必须为 `ubuntu`）、
   `DEPLOY_PORT`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`。只填值，不把
   私钥、主机名或 known-hosts 写进仓库、shell history 或 `.env`。
6. 在 GitHub Billing 中将 Actions overage budget 设为 `$0` 并启用停止使用。
   这不会扣除超额费用，但仍允许使用套餐内的月度分钟；用完后手动部署会被阻止，
   而不会产生收费。

## 日常快速检查（不生成发布收据）

开发过程中直接运行：

```bash
pnpm check:fast
```

它以本机已有的 `origin/main` 与当前 `HEAD` 的共同基线为起点，同时检查已提交、
已暂存、未暂存和未跟踪文件，再自动选择最小安全检查：

- 纯文档：只做 Git diff 格式检查。
- Web：typecheck、lint、UI 规则和关联 Vitest；找不到关联测试时改跑 Web 全量测试。
- API：typecheck、lint、业务错误检查和串行关联 Jest；找不到关联测试时改跑 API
  全量测试。
- shared-domain 测试：检查 shared-domain，并检查 API/Web 两个使用方的类型。
- Web + API 等组合：显示为 `mixed`，分别执行受影响范围的检查。

依赖/lockfile、Prisma Schema 或迁移、shared-domain 生产契约、发布/运维脚本、
GitHub 配置、治理清单以及任何不能可靠分类的变更，快速检查会以退出码 `2` 停止，
并明确要求运行 `pnpm release:local`。它不会调用 `gh`、SSH、生产地址或 GitHub
Actions，也不会生成可用于部署的收据。

因此，`check:fast` 适合开发中的高频反馈，但**不能代替完整发布门禁**。

## 本地候选门禁

日常可在功能分支运行它做本地验证。**用于生产的收据**必须在功能已合并后，
从一个指向精确 `origin/main` 提交的干净 worktree 重新运行；squash merge 会产生
新的 SHA，功能分支收据不能拿去部署。门禁拒绝未跟踪文件、远程 Docker endpoint、
任何 `DATABASE_URL` 变量和非精确 SHA；PG16 测试只创建并清理本机 `127.0.0.1`
隔离容器。

```bash
pnpm release:local --preflight
pnpm release:local
```

成功后命令会写入一个 `schemaVersion=2`、`status=passed`、绑定候选 SHA 的本机
收据，默认位置为：

```text
$XDG_STATE_HOME/jiangkong/local-release-<sha>.json
# 如果未设置 XDG_STATE_HOME：$HOME/.local/state/jiangkong/local-release-<sha>.json
```

完整门禁包含：冻结依赖安装、Prisma Client 生成、依赖审计、typecheck、lint、业务
错误与运维安全自测、全量测试、API/Web build、UI 规则、release manifests、精确 SHA
PostgreSQL 16 动态门，以及
Chromium/WebKit 的 P0 和 RC-06 mocked browser checks。

收据中的 `durationsMs` 会按上述 15 个固定阶段记录毫秒耗时，命令行也会在每个
阶段结束时显示耗时。它既用于部署前的严格收据校验，也用于判断下一轮应优先优化
哪一个慢阶段；阶段缺失、重复、负数或不是整数时，部署器会拒绝收据。

## 通过 GitHub 手动发起生产部署

只在候选已经合并至 `main`、对这个精确 `main` SHA 重跑本机完整门禁，并获得本次
生产授权后，才从**同一个干净 checkout**运行。先做不触发 GitHub 的 dry-run：

```bash
pnpm deploy:local \
  --target-sha '<40-character-main-sha>' \
  --receipt '<absolute-path-to-local-receipt>' \
  --confirm 'DEPLOY JGZG PRODUCTION' \
  --dry-run
```

dry-run 通过后，去掉 `--dry-run` 才会手动发起 GitHub 的 Deploy Production workflow：

```bash
pnpm deploy:local \
  --target-sha '<40-character-main-sha>' \
  --receipt '<absolute-path-to-local-receipt>' \
  --confirm 'DEPLOY JGZG PRODUCTION'
```

这个命令先在 Mac 验证收据、当前 HEAD、干净工作区和刚刷新过的 `origin/main` 都精确
等于目标 SHA；只有通过后，才把经过清洗的非敏感收据摘要发送给 GitHub。它不会从 Mac
打开 SSH 连接。

GitHub workflow 只接受手动触发，会串行排队且不会取消进行中的发布。它会再次校验确认
短语、当前远端 `main`、收据的 15 个固定阶段和逐阶段耗时，然后才用 GitHub Secrets
经固定 known-hosts SSH 到服务器。runner 不安装项目依赖、不跑测试/数据库动态门、
不安装浏览器，也不构建应用；服务器端原有构建、迁移前备份、运行时快照、迁移、健康
检查和恢复链保持不变。workflow 最长 90 分钟，且不创建 Actions cache 或 artifact。

默认 `full` 发布保持 `manual` 确认模式与 1800 秒健康检查后窗口，不能改为
`immediate`。确认窗口仍由服务器脚本控制：按
[Release B 延迟确认部署](contract-workbench-release-a-b-cutover.md#4-release-b-延迟确认部署)
在第二终端针对该精确 SHA 写入 `CONFIRM` 或 `ROLLBACK`；超时、错误确认或健康失败会
触发现有运行时恢复。等待确认的时间也会占用本次 Actions 分钟，所以完成冒烟检查后应
立即确认或回滚。API-only 仅在已有单独批准时可显式传入 `--scope api-only
--confirmation-mode immediate`。

本机收据防止未完整验证或错误 SHA 误部署，但不是针对恶意本机 operator 的密码学证明。

## 直连 Mac 部署备用路径

`pnpm deploy:mac-direct` 仍保留原有严格 SSH 直连能力，作为 GitHub 无法使用时的备用
路径。它需要单独的生产授权以及本机 `JGZG_DEPLOY_*` 配置；不要把它当作日常默认入口。

## 不可用时

- Node 不是 20、Docker 不是本机 socket 或未缓存 `postgres:16`：停止并修复本机
  环境，不要跳过门禁。
- 收据 SHA、当前 HEAD 或 `origin/main` 不一致：停止；重新从精确、干净候选运行
  本地门禁。
- SSH、生产备份、迁移、健康检查任一失败：不要重试发布；按现有生产 runbook 做
  只读诊断并获得新的生产授权。

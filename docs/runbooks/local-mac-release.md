# 本机零 GitHub Actions 分钟发布

本仓库不再运行 GitHub-hosted Actions。开发验证和发布控制面均由
operator 的 Mac 执行；生产机仍只接受 `origin/main` 的精确提交，并在
服务器端自行构建、备份、迁移、重启和健康检查。

这不授权自动发布。每一次生产部署仍需要单独的业务/生产授权。

## 一次性本机准备

1. 使用 Node.js 20。项目最低支持版本是 Node 20，但本机发布门禁固定
   Node 20 以匹配现有生产验证环境；不要用全局 Node 22 替代它。
2. 使用 pnpm 9，并在项目根目录完成依赖安装。
3. 启动 Docker Desktop，并预拉一次本地数据库镜像：

   ```bash
   docker pull postgres:16
   ```

4. 准备一个专用部署 SSH 私钥与固定的 known-hosts 文件。密钥、主机名和
   known-hosts 不得写入仓库、shell history、`.env` 或 GitHub Secrets。
5. 在 GitHub Billing 中将 Actions 预算设为 `$0` 且启用停止使用，并在
   Actions 页面手动禁用默认分支上此前存在的 `CI` 与 `Deploy Production`
   工作流。合并本变更后仓库也不会再有 workflow YAML 定义。

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

成功后命令会写入一个 `status=passed`、绑定候选 SHA 的本机收据，默认位置为：

```text
$XDG_STATE_HOME/jiangkong/local-release-<sha>.json
# 如果未设置 XDG_STATE_HOME：$HOME/.local/state/jiangkong/local-release-<sha>.json
```

完整门禁包含：冻结依赖安装、Prisma Client 生成、依赖审计、typecheck、lint、业务
错误与运维安全自测、全量测试、API/Web build、UI 规则、release manifests、精确 SHA
PostgreSQL 16 动态门，以及
Chromium/WebKit 的 P0 和 RC-06 mocked browser checks。

## 从 Mac 发起生产部署

只在候选已经推送、合并至 `main`、对该精确 `main` SHA 重跑本地完整门禁，且获得
本次生产授权后，才从**同一个干净 checkout**运行。把本机部署配置放在用户自己的
shell 配置或受限文件中：

```bash
export JGZG_DEPLOY_HOST='<production-host>'
export JGZG_DEPLOY_USER='ubuntu'
export JGZG_DEPLOY_PORT='22'
export JGZG_DEPLOY_IDENTITY_FILE="$HOME/.ssh/jiangkong_deploy"
export JGZG_DEPLOY_KNOWN_HOSTS="$HOME/.ssh/jiangkong_known_hosts"
```

先运行不连接生产的 dry-run：

```bash
pnpm deploy:local \
  --target-sha '<40-character-main-sha>' \
  --receipt '<absolute-path-to-local-receipt>' \
  --confirm 'DEPLOY JGZG PRODUCTION' \
  --dry-run
```

dry-run 通过后，由人工再次确认后去掉 `--dry-run`。部署器会再次验证本地
checkout、收据和拉取后的 `origin/main` **都精确等于**目标 SHA，SSH 使用
`StrictHostKeyChecking=yes` 和指定 known-hosts；远端仍会再次验证目标 SHA、工作树、
依赖目录和生产脚本的备份/迁移/健康检查门禁。

`full` 发布默认使用 `manual` 确认模式和 1800 秒窗口，不能改成 `immediate`。
健康检查后，仍须按 [Release B 延迟确认部署](contract-workbench-release-a-b-cutover.md#4-release-b-延迟确认部署)
在第二终端针对该精确 SHA 写入 `CONFIRM` 或 `ROLLBACK`。API-only 若已有单独批准，
才可显式传入 `--confirmation-mode immediate`。

本机收据用于防止把未完整验证或错误 SHA 误部署；拥有本机写权限和部署 SSH 私钥的
operator 仍可伪造本地文件，因此它不是对恶意本机 operator 的密码学证明。

默认是 `full` 发布；确有批准的 API-only 发布时，额外传入 `--scope api-only`。

## 不可用时

- Node 不是 20、Docker 不是本机 socket 或未缓存 `postgres:16`：停止并修复本机
  环境，不要跳过门禁。
- 收据 SHA、当前 HEAD 或 `origin/main` 不一致：停止；重新从精确、干净候选运行
  本地门禁。
- SSH、生产备份、迁移、健康检查任一失败：不要重试发布；按现有生产 runbook 做
  只读诊断并获得新的生产授权。

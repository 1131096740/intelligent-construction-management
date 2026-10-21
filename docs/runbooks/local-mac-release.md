# 本机完整门禁 + 低分钟手动部署

日常开发验证和完整发布门禁都在 operator 的 Mac 执行。Pull Request 和普通
`main` push 会运行非生产 CI；`Release gates` 汇总全部检查结果。生产部署只在
通过本机完整门禁、并获得单独生产授权后手动启动 deploy-only workflow。

生产机仍只接受 `origin/main` 的精确提交，并在服务器端自行构建、备份、迁移、
重启、健康检查和失败恢复。

这不授权自动发布。每一次生产部署仍需要单独的业务/生产授权。

本文的通用部署入口包含迁移和旧运行时恢复，只适用于未冻结且 API 正在运行的
常规兼容发布。冻结、停机或 POL-25B 激活均不得使用此入口；POL-25B 的零迁移、
维护态激活路径见 [专用 runbook](pol25b-maintenance-activation.md)。

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
5. 在 GitHub 仓库 Settings → Secrets and variables → Actions 配置四个
   repository secrets：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_SSH_KEY`、
   `DEPLOY_KNOWN_HOSTS`。workflow 固定以最小权限的 `ubuntu` 用户连接。只填值，不把
   私钥、主机名或 known-hosts 写进仓库、shell history 或 `.env`。
6. 在 GitHub Billing 中将 Actions overage budget 设为 `$0` 并启用停止使用。
   这不会扣除超额费用，但仍允许使用套餐内的月度分钟；用完后手动部署会被阻止，
   而不会产生收费。

真实 DOCX/PDF 验收还要求本机转换器能读取模板声明的中文字体（当前初始化样张为
`Noto Sans CJK SC`）。部分打包的 macOS headless 转换器不读取系统字体配置；可为
本次验证设置 `FONTCONFIG_FILE`，值必须为本机字体配置文件的绝对路径，配置指向
实际已准备的字体目录。动态门仅传递这一配置路径，仍拒绝相对路径，不继承
`FONTCONFIG_PATH`、转换器替换命令、数据库目标或其他未登记变量。
先核验真实门禁子进程中的 PDF 中文、逐页画面和文字；直接单跑时的环境不能代替
完整动态门环境。缺字或错误替代字体应修复本机依赖后从第一阶段重跑完整门，
不得降低画面/文字断言。此配置仅作用于本地验证，不改变生产转换服务。

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
PostgreSQL 16 动态门、POL-22 隔离只读预检，以及
Chromium/WebKit 的 P0 和 RC-06 mocked browser checks。

收据中的 `durationsMs` 会按上述 17 个固定阶段记录毫秒耗时，命令行也会在每个
阶段结束时显示耗时。它既用于部署前的严格收据校验，也用于判断下一轮应优先优化
哪一个慢阶段；阶段缺失、重复、负数或不是整数时，部署器会拒绝收据。

## 通过 GitHub 手动发起生产部署

### 运行目录与回退证据

Web 构建目录为`apps/web-admin/dist`，发布暂存及生产目录保留`dist`层，
Nginx 使用`/srv/jiangkong/apps/web-admin/dist`。比较构建内容时必须对到这个
`dist`目录；比较完整候选包时则使用暂存`web-admin`与生产`web-admin`，不能混用层级。

发布器使用`runtime-manifest.py`记录构建、暂存、安装、旧包、快照及回退的文件清单。
清单包含相对路径、类型、SHA256、大小、权限、UID/GID及链接目标，不读取链接指向的
外部依赖闭包，不输出文件内容。旧依赖完整闭包仍须按当次方案在构建前封存并真实恢复验证。
任何缺失、新增、内容或元数据差异都会先保存实际清单和`*.diff.json`再失败关闭，
不能忽略`dist/`前缀、只看文件数或用新的健康成功覆盖差异。

会话证据固定保留在准确会话的`evidence/`目录；直接运行的证据目录会在日志中给出。
暂存和旧运行包移入其中保留，退出时不再删除唯一失败现场。它们可能包含私有运行资料，
目录保持0700、清单0600，禁止直接上传到公开CI日志；后续清理须先核验备份及恢复位置。
旧包快照与恢复使用有权限保存原属主的`sudo --non-interactive rsync -ac`，随后逐项比较，
包括原`node_modules`符号链接的UID/GID和目标；不能以目标相同代替元数据一致。

发布确认前，应只读核对同一个准确目标SHA/会话的全部差异收据，验证API进程及Nginx的
实际目录，再按当次方案执行完整双路径健康和合成业务验收。任何断言失败仍按原路径回退，
不得现场换目录试到通过。若旧失败清单缺失，应保留证据限制，不反推当时所有文件一致。

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
短语、当前远端 `main`、收据的 17 个固定阶段和逐阶段耗时，然后才用 GitHub Secrets
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

两条SSH入口都使用15秒保活、4次无响应断开，并在服务器fetch/checkout前取得同一
非阻塞部署锁。服务器原部署脚本在独立会话中运行，SSH断连不会取消确认窗口、收尾或
超时恢复。不要因为SSH退出255就重新发起部署；新任务也会被仍持有的部署锁拒绝。

启动日志打印 `Deployment session: session.<ID>` 与私有日志路径。若SSH断连，重新
连接服务器后以部署用户只读查询原会话（不要运行启动命令）：

```bash
bash /opt/jiangkong/scripts/ops/deploy-production-session.sh --status 'session.<ID>'
tail -n 80 '/srv/jiangkong/.deploy-sessions/session.<ID>/deploy.log'
```

目录仅部署用户可读，日志不得整体公开。若启动输出也丢失，先只读列出
`/srv/jiangkong/.deploy-sessions/`，核对会话的 `target-sha` 和时间，不能猜测“最新”即本次。
查询退出0只表示读到终态，必须同时核对 `targetSha` 和 `exitCode`；只有退出码0才是原
部署脚本完成。无结果时返回3，表示仍在执行或异常终止，须结合日志和进程只读诊断。
仍在确认窗口可按原规则写入精确CONFIRM/ROLLBACK；若超时已恢复，不能补写确认或重试。
SSH失联的GitHub运行仍保留失败，不用服务器结果伪造CI成功。主机重启、SIGKILL、磁盘
故障或系统清理用户进程不属于该保护的保证范围。

本机收据防止未完整验证或错误 SHA 误部署，但不是针对恶意本机 operator 的密码学证明。

## 直连 Mac 部署备用路径

`pnpm deploy:mac-direct` 仍保留原有严格 SSH 直连能力，作为 GitHub 无法使用时的备用
路径。它需要单独的生产授权以及本机 `JGZG_DEPLOY_*` 配置；不要把它当作日常默认入口。

## 不可用时

- Node 不是 20、Docker 不是本机 socket 或未缓存 `postgres:16`：停止并修复本机
  环境，不要跳过门禁。
- 收据 SHA、当前 HEAD 或 `origin/main` 不一致：停止；重新从精确、干净候选运行
  本地门禁。
- SSH失败：先按上文查看原会话，绝不自动重启部署。生产备份、迁移、健康检查失败
  或原会话无终态：按现有生产runbook只读诊断，修复或重新发布须另获生产授权。

### 本机动态门失败附件

`run-database-dynamic-gate-local.cjs` 成功时仍清理自己的临时根目录；失败时保留由mkdtemp创建的
0700私有根目录，并输出 `[database-dynamic-gate] failure artifacts retained:` 及准确路径。
此路径可能包含浏览器trace、错误页面和合成会话认证信息，不应整体提交Git或公开贴出。
将本轮日志与所需附件保存到私有证据目录，复制后核对摘要；未经批准不要删除旧失败目录。
组runner仍清理自身容器，附件保留不产生成功收据，也不授权重试或执行后续门。
该行为只保证本机失败目录不被本runner删除，不等于CI附件已经上传或操作系统会永久保留临时文件。

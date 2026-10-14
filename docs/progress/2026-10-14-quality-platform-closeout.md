# 2026-10-14：一次性收敛Linux质量门临时路径

## 冻结基线及失败

父候选`da91f7d426958f8c1853ec92b3b3f82c1988d5dc`本地原完整17/17和收据复核通过，获准快进草稿PR #313。CI38521923760首次Quality gates失败后停止，原日志保存于`/private/tmp/jgzg-ci-platform-final-acceptance-20261014/github-ci`，不重跑或修复原head。完整日志显示14项Node用例因Linux无/private/tmp而失败；它们也在更早CI原日志中，前批诊断遗漏该组Node同类问题，不能声称整组质量门已修复。

用户批准在新独立工作区一次性修复原Quality范围内同类临时路径，先真实Linux完整质量门，再macOS检查、本地提交和双审；不跑新17门、不推送、合并或访问生产。

## 最小实现及边界

- 三个Node测试文件使用系统临时目录并规范化路径；原14项安全断言、补充组恢复用例及测试数量不删减。
- 本机只读取证函数自身也限定macOS路径。仅将本机证据目录按OS固定为macOS `/private/tmp/jgzg-controlled-preflight-[a-z0-9-]+` 或Linux `/tmp/jgzg-controlled-preflight-[a-z0-9-]+`；其他OS拒绝，不接受任意TMPDIR或任意目录。MAC范围不扩大，Linux同样只有固定本机临时命名空间。
- 四项新增公开入口反例拒绝其他目录、错误前缀、路径穿越和其他OS目录，必须在读取来源/调用传输前失败。文件模式、所有权、inode/时间/摘要、防替换、准确退出、传输身份、时限及显式生产确认不变。只读传输在测试中注入模拟execute，不连接服务器。
- 不修改业务、Schema、业务权限、CI workflow、skip/retries/超时或生产配置。其他固定Mac路径CLI不在该组失败调用范围，未泛化修改。

## 验证

- 官方Node20.20.2/Debian本机Linux容器，不创建/private/tmp、不挂宿主或生产目录；Git克隆包含准确原提交/历史，本机测试用户非root并有补充组，真实文件系统组恢复断言保留。
- 原三文件入口20项中14项稳定RED；仅可移植夹具后剩余目录契约3项RED；固定OS目录后24/24 GREEN，无跳过。macOS同入口24/24通过。
- Linux原Quality整组：冻结依赖/Prisma生成、迁移基线、293项编排、生产依赖审计、全仓及Web E2E类型、lint、业务中文/错误和运维安全全部通过，原20分钟命令边界保留。macOS独立冻结离线安装、293编排、类型/lint通过；lint0 errors/570既有warnings。
- 环境设置失败分开保存：容器root准备Corepack未作用于nonroot用户而选择pnpm12，冻结安装拒绝；仅容器内安装官方pnpm9.15.9后冻结锁文件成功。Docker默认V8约2GB堆使类型检查OOM，仅该容器NODE_OPTIONS=--max-old-space-size=4096后原命令通过；缺rsync使原自测过早停止，仅从Debian官方源在容器内补齐。未改宿主设置、CI文件、业务断言或超时，也不拼接失败轮次。
- Linux资源/发行版与GitHub Ubuntu runner有差异，明确为isolated-local-linux，不代替真实CI或生产。最终固定SHA对应完整Linux质量门、源文件摘要及双审结果见独立收尾收据，证据目录`/private/tmp/jgzg-quality-platform-closeout-evidence-20261014`。

## 后续

新SHA完整17门和PR更新仍需集中批准；旧da91或44628收据不继承。本批无完整17门、远端更新或生产访问。生产首发备份恢复、停写、维护迁移/发布及业务开放继续分别批准，旧02:30任务保留，生产自动入口禁用。

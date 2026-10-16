# 2026-10-16 部署 SSH 断连修复与生产验收

## 当前验收结论

已于2026-10-16完成授权的联合发布。生产准确版本为 `685daba763182b64cff18ac8e565a868816d1ebf`；本次文档归档不重新部署或改变该验收版本。后面的“本地候选”等内容是历史检查点。

- [PR #328](https://github.com/1131096740/intelligent-construction-management/pull/328) 引入断连保护；[PR #330](https://github.com/1131096740/intelligent-construction-management/pull/330) 修复外层077下自测夹具。两个固定头双轴审查均0未决。
- 准确生产SHA原完整17门通过，收据时间13:10:26 UTC；[主线CI38900901670](https://github.com/1131096740/intelligent-construction-management/actions/runs/38900901670) 自然完成23/23成功。
- 唯一[正式部署38905897724](https://github.com/1131096740/intelligent-construction-management/actions/runs/38905897724) 于13:11:01 UTC启动、13:19:56 UTC成功结束。健康观察超过5分钟后写入一次准确CONFIRM；`session.4rrBA0ed`终态绑定该SHA且exitCode0。
- 发布负责人验收后，SSH任务再次只读核对：生产源码干净且SHA一致；API/Web运行文件与构建无差异，三路健康、网页及静态资产均200；锁释放、决定文件已消费，会话0700及文件0600正确。
- 四份后置systemd文件已安装且匹配源码，原启停状态保持；运行目录0775保持。本轮stage/rollback目录已清理，四个发布前遗留目录原样保留，未清理他人历史资源。
- 本次迁移前备份的摘要、恢复目录列表和异地回执通过。正式发布没有触发回滚，健康不能单独代替终态、备份和收尾证据。

## 断连与回滚验收边界

生产主机独立/tmp探针复制已发布会话入口并使用无业务动作的载荷：真正断开SSH客户端后，锁仍持有，重连确认成功，终态exitCode0并释放锁。探针未运行真实部署载荷，创建的临时目录由探针清理。

生产主机隔离安全自测使用真实server脚本及测试适配器，在022/002两种掩码下分别验证CONFIRM、ROLLBACK、TIMEOUT、WRONG_SHA，8场景全部通过；包含运行文件恢复、私有收据、锁和清理断言。这是生产主机上的隔离恢复验证，不是实际回滚线上业务。

## 失败记录与证据位置

- 5f83c9d5完整门第9项失败，修复自测环境后在最终SHA从头通过17门，没有拼接前8门结果。
- 43e54031首轮CI38896329316的手机合作单位创建用例等待POST响应45秒超时。当前代码已含此前的可见弹窗定位修复，未确认本轮唯一根因；原日志保留，GitHub未上传该失败trace。同头本机PG16 30/30、浏览器21通过/1既有条件跳过，原失败手机用例实际通过；仅原失败分片及汇总重跑一次，attempt2为23/23成功。没有修改断言、超时、重试或跳过配置；最终主线CI另行自然全绿。
- 最终只读核验器首次以ubuntu检查root保护的决定目录时遇到权限错误。私有核验副本仅改用`sudo -n test ! -e`读取存在性，未改生产权限；重新核验通过，原失败保留。
- 发布原件：`/private/tmp/jgzg-accounting-setup-20261016/`，包括最终17门收据、CI/部署终态、生产前后快照、确认与会话、备份、SSH探针和8场景隔离日志。
- SSH独立复核：`/private/tmp/jgzg-ssh-release-20261016/`，包括`combined-prerelease-independent-review.json`、`production-final-session-independent.json`、`production-runtime-independent.json`、`production-after-independent.json`及发布交接。原始私有证据不上传公开仓库。

## 历史执行记录

## 范围与现场证据

用户要求修复本次部署 SSH 断连，避免以后卡在最后确认。本轮范围为本地修复和验证，尚未提交、推送或部署。基线为 `1d415dd5c662d548b0de88618ff0d00d15f5491c`，工作分支 `codex/deploy-ssh-recovery`；保留原工作区修改。

前次 GitHub [部署运行 38881641814](https://github.com/1131096740/intelligent-construction-management/actions/runs/38881641814) 在等待人工确认时 SSH Broken pipe、退出255；服务器运行时已更新但最后收尾未完成。该次失败记录保持失败，后续人工完成单独记录。网络连接被中断的底层原因未唯一确认。

本轮通过原 `deploy-production-server.sh` 的完整安全自测夹具复现：关闭等待确认时的输出管道，随后写入精确 `CONFIRM`，脚本收到 SIGPIPE、退出 `-13`，没有完成 systemd 安装。原始红灯日志 `/private/tmp/jgzg-ssh-red.log`；不使用真实生产业务数据。

## 修复契约

- GitHub 与 Mac 备用入口均启用 SSH 15秒保活、4次无响应断开，并保留固定 known-hosts。传输失败仍返回失败；不自动重新部署、迁移或确认。
- 两入口在 fetch/checkout 前取得同一非阻塞服务器锁，独立部署进程继承该锁直到退出。断连不允许下一任务覆盖仍在使用的部署源码。
- 新会话入口将原服务器脚本以 nohup、关闭标准输入、私有文件日志运行，SSH仅观察日志。原服务器的构建、备份、迁移、健康检查、确认窗口及恢复逻辑不改。
- 会话目录0700、文件0600；原服务器脚本（含EXIT清理）结束后才原子写入精确SHA和退出码。无结果表示未终结或异常，不能解释为成功。状态查询只读，不重新启动任务；查询命令退出0表示读到终态，部署成败看 `exitCode`。
- 正确确认完成最后四个systemd文件安装；ROLLBACK、超时、错误SHA均沿用原恢复。不会自动确认、开启定时器、扩大业务权限。
- 这是SSH传输中断保护，不承诺抵抗主机重启、磁盘故障、SIGKILL或系统强制清理用户会话；这些情况依然需要只读诊断，不能根据健康接口单独宣布发布成功。

## 验证与剩余事项

- macOS原运维安全自测通过，新增断连后CONFIRM / ROLLBACK / TIMEOUT / WRONG_SHA四场景通过。验证实际API/Web文件内容、四个systemd安装文件、清理目录、结果文件权限、锁的持有和释放及只读查询。
- 两入口的可执行传输测试检查保活/主机验证选项，模拟SSH255并确认只调用一次；原发布收据等检查保持。
- 双轴复核均发现并关闭同一P1：私有会话umask077污染原构建/运行目录权限。新增断言先红（`/private/tmp/jgzg-ssh-umask-red.log`），再修复为两入口开锁后恢复原掩码、worker仅在原server子shell恢复调用方掩码。运行目录755、新静态文件644、收据600均验证；夹具静态文件路径遗漏dist的中间失败也保留。
- macOS最终完整安全自测 `/private/tmp/jgzg-ssh-mac-final.log` 与Linux最终完整安全自测 `/private/tmp/jgzg-ssh-linux-verified.log` 均exit0；Linux为一次性容器、非root测试用户、只读代码挂载。首次镜像缺rsync、首次容器安装身份非root均为环境失败，补齐容器依赖后完整重跑；未改宿主或生产。
- `pnpm test:ci-orchestration` 最终296/296通过，日志 `/private/tmp/jgzg-ssh-orchestration-final.log`。首次新工作树未安装/生成Prisma Client的失败保留，冻结离线安装与生成后完整重跑通过，不拼接结果。
- 全仓类型检查通过；lint 0 errors（Web现有798 warnings）；Shell/Node/Python语法与diff空白检查通过。最终Standards未决0项，Spec未决0项；均绑定本地未提交差异，不是远端固定SHA审查。
- 本轮未调用生产SSH、未写真实数据、未提交/推送/创建PR/部署。所有证据均为本地候选，不是GitHub CI或生产发布资格。上线需要新提交、准确SHA门禁和明确的发布授权；旧17门收据不适用于本次变更。

## 后续发布授权

用户已明确授权继续提交、推送、上线及生产验收；专项Issue #326。上述本地范围是初次修复检查点；本轮继续固定提交双审、CI、准确合并main完整17门及生产确认/收尾验证，生产回滚与隔离恢复证据分别报告。

## 联合发布第9门失败与测试环境修复

#328已合并为dfd034c4，固定d497438e的CI23/23通过。用户批准与#329一次检查和发布；最终5f83c9d5的原完整17门前8门通过，第9门实际失败 `session changed API runtime traversal permissions`，失败候选保留干净且未生成发布收据、未部署。

新的独立候选基于5f83c9d5。以 `umask 077; bash scripts/ops/go-live-safety-self-test.sh` 稳定复现：发布门为证据文件设置077，自测继承后却仍硬编码期待755/644。真实session按契约保留调用方掩码，生产脚本没有新的权限回归。

修复仅涉及自测：在独立子shell中显式构造022和002两组部署调用环境，分别严格检查755/644与775/664；每组运行CONFIRM、ROLLBACK、TIMEOUT、WRONG_SHA四场景，原内容、私有收据、锁、清理和四个systemd文件断言全部保留。子shell不改变发布门及其他夹具的私有掩码。

在外层077下，Mac和Linux完整运维安全自测均通过八场景；日志分别为 `/private/tmp/jgzg-ssh-release-20261016/umask077-green.log` 和 `umask077-linux-green.log`，红灯为 `umask077-red.log`。生产脚本、workflow、权限、业务与Schema均未改。补丁仍需固定SHA双审、CI及合并；唯一完整17门与正式部署继续由联合发布任务负责，旧部分检查不拼接为通过。

补丁候选296项编排测试通过，外层077下原第9门四条命令整组通过（`patch-original-phase9.log` / `ORIGINAL_PHASE_9_PASSED`）；不代表完整17门成功。

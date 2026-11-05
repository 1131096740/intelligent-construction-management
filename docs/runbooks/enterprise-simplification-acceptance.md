# 业务简化：源码封包与受控验收准备

适用[任务01 #383](https://github.com/1131096740/intelligent-construction-management/issues/383)。本入口只固定、核对源码；任务01仍进行中，其他任务按[阻塞图](../plans/2026-11-05-enterprise-simplification-tasks/README.md)等待。当前证据及未通过事项见[集成交接](../progress/2026-11-05-enterprise-simplification-integration-start.md)。

## 已授权的公开入口

用户已确认 `--prepare` / `--verify` 与输出manifest边界。迁移、受控资源/故障实验、部署和生产变更另行具体授权；本命令不启动这些操作。

在准确候选的**干净、已提交工作树根目录**执行。选择 `/private/tmp` 下尚不存在的新普通文件；父目录须已存在，文件路径不得位于仓库内，不复用旧packet，不通过符号链接目录写入。

```bash
node scripts/prepare-enterprise-acceptance.cjs --prepare --output /private/tmp/jg-enterprise-source-packet-20261105-01.json
node scripts/prepare-enterprise-acceptance.cjs --verify /private/tmp/jg-enterprise-source-packet-20261105-01.json
```

首次命令成功输出 `source-sealed`，核对成功输出 `source-verified`；stdout包括 `candidateSha`、`fileCount`、`migrationCount`、`sealSha256`。保存实际stdout及packet SHA-256作为该次收据，不预写未来提交SHA。命令失败返回非零和 `rejected`、稳定错误代码与泛化中文说明；保留失败原因，先查清漂移或路径问题，不能忽略退出码继续后续验收。

## 封包证明什么

packet `schemaVersion=1`、`purpose=source-seal-only`，固定准确Git HEAD全部已跟踪文件的SHA-256、`pnpm-lock.yaml`、Prisma Schema、`migration_lock.toml`、递归全部 `migration.sql` 及CLI本身。必须从干净且完整的已提交候选采集；不是把旧混合根或未知文件复制成可执行候选。

`--verify` 从当前准确HEAD独立导出并核对，不仅检查packet声称包含的子集；缺少/增加迁移、篡改源码或packet、候选SHA变化、非法路径、符号链接或树内输出均须拒绝。任何后续源码、迁移、锁文件、脚本或配置提交都需要新packet，旧包不能作为新SHA证据。

SHA-256是公开内容校验，**不是批准、签名或执行凭证**。`source-sealed` / `source-verified`不表示入口可运行、依赖安装完成或运行时安全。忽略的构建产物未封存（`ignoredArtifacts=not-sealed`），已安装依赖未验证（`installedDependencies=not-verified`），HTTP/PostgreSQL验收未执行（`httpPostgresAcceptance=not-executed`）。冻结锁文件不等于已安装依赖与锁一致；实际执行前仍需独立依赖、引擎、构建与浏览器产物证据。

该CLI没有数据库URL、执行、迁移、任意SQL或shell命令入口。不要把不存在的 `--execute` 或旧实验runner接在本入口后当成已授权运行步骤。

## 受控运行入口仍缺什么

任务01需要独立的可运行基础：准确源码与依赖→本票新一次性PG→owner合成夹具→受限AppModule公开HTTP/独立observer→Web回读→可核对的按身份清理。当前封包工具只完成其中的源码输入准备。

- 固定唯一daemon/container/匿名卷、PG16镜像digest、loopback端口、TLS材料与总/阶段超时；不拉镜像，不接管旧资源。
- owner/runtime/observer分离；当前有效ACL、PUBLIC/函数传递与全部连接池/重连身份有证据，不从配置角色属性推定实际运行池或完整最小权限。
- 任务专属fixture、真实公开HTTP案件回读与Web显示；实际响应/持久事实/审计一致。现有 `fund-execution-entry.http.pg.spec.ts` 测试资金**案件**创建、分类、提交、冻结快照，并继续审批/PDF；它不证明最终 `FundExecution` 实付提交，不能原样充当本票最小入口或实付成功证据。
- TLS正负控及健康正控、故障适配器与未知失败关闭、独立观察，以及成功/失败/中断后的按身份清理和不存在确认；未经明确识别不清理。

本票提供受控基础和停止条件；完整资金提交安全由任务16交付，真实副本恢复/迁移由任务42交付，最终候选全链由任务44交付。它们的通过结论不能由源码校验或案件冒烟替代。

上述执行入口实现后，才形成含实际候选SHA、packet哈希、镜像/SQL/迁移/依赖/构建摘要、资源上限、停止条件和清理范围的具体执行材料，按正式授权通道运行。当前不提供可直接执行的资源/迁移命令。

## 响应丢失代理准备构件

任务专用构件 `services/api/prisma/enterprise-task01-response-loss-proxy.cjs` 已完成合成loopback HTTP协议验证。`startResponseLossProxy({ upstreamUrl, drop: { method, path, requestId }, ... })` 返回 `url/getStatus()/close()`；合成标记头为 `x-jg-task01-synthetic-request-id`。仅在精确method/path/标记匹配时完整读取上游响应，再一次性销毁下游连接；错误不重新武装、不自动重试。后续同键请求须由调用者显式发起并正常转发。默认请求/响应上限各1MiB，从连接建立起的总截止为2秒，覆盖未完成请求头、请求体、上游响应及下游交付，不在收到请求头后重新计时；上限16MiB/30秒、16连接。每个连接只办理一个请求，响应显式 `Connection: close`，不复用keep-alive连接或转发后续流水线请求；调用者的显式重放使用新连接。只用literal loopback随机端口，`close()`幂等终止自有活动socket及监听。

12项真实合成HTTP协议测试通过，只证明网络时序与边界，不能证明真实资金已提交、回执唯一或数据库失败无半笔；后续受控真实HTTP/PG仍需单独验收。精确代码及测试证据见集成交接。

## 当前只读基线边界

主线 `2f474055bd018b3e454b458038d91080203ad5dc` 的197份迁移与生产197项已完成登记逐名称/校验一致，只证明登记差额为0。准确运行源码SHA、完整Schema、业务数据/文件和有效权限仍有未证明项；三个磁盘代码样本与保留release相同、配置角色非高权标志或health正常，都不能解除这些门禁。详情见[集成交接](../progress/2026-11-05-enterprise-simplification-integration-start.md)及其脱敏收据。

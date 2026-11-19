# 单事务安装阶段源码（尚未连接执行）

公开函数 `installTask16RegisteredSql(options)` 位于 `services/api/prisma/task16-registered-sql-installer.cjs`。导入没有副作用，没有CLI/main入口，也不连接数据库或创建资源。它是未来专用受控执行器的一段，尚不是完整执行器。

用户本轮明确确认“确认，仅源码与模拟测试”。新增测试边界为该公开函数及现有资源适配器 `execOwnerSql(sql, label)`；合成Git源与202份迁移经真实离线prepare/verify CLI封包，只有owner SQL适配器返回合成回执。所有测试均未执行SQL。

调用参数包括：外部固定 `expectedPacketSha256`、`packetFile`、`ownerRole`、`runtimeRole`、用于审计的 `authorizationReference`、资源适配器及其固定 `expectedResource`（runId/sourceSha/containerId/networkId/daemonId/endpoint/imageId/databaseName/port）。实际资源/SQL授权必须由未来受控driver先取得并核实；字符串reference、源码包 `executionAllowed:false`、测试通过均不授予执行资格。原离线CLI的状态与行为未改变。

函数先调用仓库唯一 `scripts/prepare-task16-registered-pg.cjs --verify --packet ... --expected-sha256 ...`，核Git/AST/202迁移/七片SQL及候选；随后捕获并核七片原始UTF-8字节，不从输入源码加载模块。先经资源自有owner入口只读核数据库、数据库owner、集群system identifier、PG16、TLS、复制角色、runtime资格和完整迁移登记，再在安装事务内DDL之前复核身份/角色/迁移。迁移登记表按SHARE模式锁定，锁等待限5秒；七片只按固定顺序一次提交，提交后才读取本次随机nonce的完成回执。

现有 `enterprise-task01-resources.cjs:384–389` 的 `execOwnerSql` 合同实际为：核准确daemon/container/network归属，容器内psql以固定owner/自有数据库/127.0.0.1:5432、verify-full/rootCA、ON_ERROR_STOP=1执行，受原120秒命令预算约束；非零退出拒绝。这里是源码复用依据，不能当任务16实际TLS或资源验收。新模块不接受任意数据库URL或shell命令。

调用结果只表示安装COMMIT回执被观察到。金融业务、有效ACL、TLS负控、HTTP、fixture、并发/断连/响应丢失、资源清理都不因此通过。任何开始安装后的错误（含COMMIT丢回执、后验身份漂移）标 `UNKNOWN_DO_NOT_RETRY`，不假称回滚、不自动重试。资源生命周期与finally清理仍归未来driver；本函数不关闭调用者的资源，不实现授权通道或资源启动。

当前尚未验证SQL语法、触发器执行顺序、实际DDL、安装权限、catalog锁或COMMIT。模拟适配器对收到的SQL文本检查仅证明编排协议，不能证明PG实际拒绝。现有fixture仍是旧无TLS/observer=runtime协议，尚未接本安装阶段，真实资源执行器、独立observer权限及全链运行仍待实现。#398保持OPEN，17/24以及16/42/44硬门不解除。

# 任务16 B1：专用正常case生命周期源码（真实能力未完）

用户对A+B明确确认“确认全部，仅源码与模拟测试”。本片仅交B1，不称完整真实driver。新树 `/private/tmp/jg-382-task16-driver-lifecycle-20261107`，分支 `codex/enterprise-task16-driver-lifecycle-20261107`，从实际Amerge `2815a78a6a6bbba5850af5d88fb2cef50a0fb729` 新建，之后fast-forward最终纯文档头 `723f0cdb380578feaaf0d9426356b8229be3ef0e`；旧A/installer/中央树均未写，未提交或推送。

## 实现和边界

新增唯一未来CLI及公开 `runTask16RegisteredPg`，固定11阶段、首败停后续、App→clients→resource清理、partial创建失败回执保留、清理缺席证明与未知安装不重试。实际resourcehelper和七片installer已有默认实接片段；source片段复用唯一CLI并要求当前driver根及adapter源码属于同候选，但runtime输入/依赖归属准入未实现，仍明确失败。

默认缺少的原生阶段在source或资源之前直接拒绝，没有noop成功或CLI模拟绕过。注入模拟adapter永远标SIMULATED/nativeExecution=false。完整说明与后续原生缺口见[生命周期源码](../../services/api/prisma/prepared/task16/DRIVER-LIFECYCLE-SOURCE.md)。本片不是把旧task01 ACL/driver改名便计16通过，也未写或执行新的ACL。

## 本地检查

- 公开函数首条缺模块RED→实现后GREEN。首次CLI拒绝用例因测试临时目录落在private/var而非当前明确private/tmp范围，准确失败为PATH；仅修正本次测试目录，不放宽产品路径。
- 外部AbortSignal接力先RED（未传递中断），补后GREEN。其余既定首败/清理/未知/partial回执协议逐项验证。
- 最终Node20.20.2新20项一次20/20、0fail/0skip，109.8ms。原始TAP `/private/tmp/jg-382-task16-driver-lifecycle-evidence-20261107/final20.tap`。其中只有CLI缺能力/非法参数路径创建本机子进程；资源/SQL/App/client均为协议适配器，无真实连接或端口。
- 两CJS语法、CJS模式定向lint、API类型和全src lint均退出0；日志在同证据目录`cjs-lint.log`、`typecheck.log`、`api-lint.log`。`git diff --check`通过。只读取本树ignored的central既有依赖链接，无安装或共享依赖写入，无根依赖链接。

冻结源码SHA256：driver `e1c77d5f4cb7d58d668d7388e9d4c472b0cca9b9ade4ce318d590f1cd0279c33`；测试 `f4f857592b6a2556177ef25cd586adf94089fc9c0a4d7a12bfcf5ec6ad545170`。这是未提交源码，不是723f已包含B1或最终SHA验收。

独立两轴/整合尚待主控。后续仍须实现并审查runtime输入/完整依赖封存、真实迁移、registered来源清单/有效ACL、TLS与三角色连接、App/fixture/case真实adapter、总预算/信号和清理闭环。没有实际SQL/PG/Docker/证书/端口/资源/真实业务/通知/部署或生产操作；#398 OPEN、17/24阻塞、13/45与16/42/44门均不变。

## 独立Standards P2修复：最终stage取消（当前冻结后继）

原完整Standards审查建立1项P2，Spec0：最终`runNormalCase`内触发caller取消但仍返回passed时，已没有下一stage复核signal，旧driver会错误返回SIMULATED完成。原准确driver/test分别为上文e1c77d5f/f4f85759，旧20/20仅其阶段证据，不能说明本反例已覆盖。

在同一已确认公开函数/adapter seam新增反例：最终case内abort再返回passed；首次实际RED为SIMULATED_CASE_PROTOCOL_COMPLETED而期望FAILED_CLOSED，0pass/1fail/20未跑。仅在最终await之后、正常完成标志之前加1行signal复核；没有改通用stage或在resource/client/App handle归属登记前抛错。原三项close顺序与无cleanup失败断言保留。窄1GREEN/20未跑，随后完整21/21、0fail/0skip（84.6ms）。原始三TAP分别为证据目录`final-stage-cancel-first-red.tap`、`final-stage-cancel-first-green.tap`、`final-stage-cancel-full21.tap`。

当前新freeze：driver `d17eec25aec54366132b1d8fa53da047f5b8e5874819c1554ee4ab9b7ce67aaf`；test `11e07e56d97bfcf878e3e1cf0f28816cb2c214f09cfdfd97216123246a6381f6`。两CJS语法及CJS定向lint、API类型与全src lint均退出0；对应后继日志以`final-stage-cancel-`为前缀。原两轴增量复核待主控，不预称已关闭P2；没有commit/push或真实资源/SQL操作，B2仍未实施。

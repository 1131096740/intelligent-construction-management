# 任务16安装阶段：源码及模拟协议验证

用户本轮明确回复“确认，仅源码与模拟测试”。按该边界在新隔离树 `/private/tmp/jg-382-task16-executor-source-20261107`、分支 `codex/enterprise-task16-executor-source-20261107` 实现。先从中央95a新建，再fast-forward至 `fc2dcadab81d17e37e6d1df68a75fd4eac5b65d1`；未reset、提交、推送或改动原task16/offline/中央源码。原工作树全部保留。

新公开安装函数与适配器边界见 [安装说明](../../services/api/prisma/prepared/task16/INSTALLER-SOURCE.md)。调用唯一离线CLI核完整封包后，先owner身份/迁移preflight，再单事务七片原字节安装及提交回执。源码包不授实际资源/SQL执行资格。失败未知不重试；没有完整driver或真实PG验收。

## 本地结果

- 初次公开函数测试缺模块RED；实现后曾因测试临时目录含系统符号别名被canonical guard拒绝，修正本次合成临时目录的真实路径后1GREEN。原失败在本会话工具输出中保留，不冒独立持久原始日志。
- 接入唯一CLI后，旧packetBytes测试入口在新packetFile边界首败，再完成真实合成Git源prepare/verify后GREEN。
- 原17项协议检查17/17；追加实际交给adapter的DDL前runtime/迁移guard检查先RED后GREEN（窄跑1通过/17未跑）。该文本检查不是SQL parser或真实PG反例。
- 最终Node20.20.2新18项一次全跑18/18，0失败/0skip，20.53秒。原始TAP `/private/tmp/jg-382-task16-installer-evidence-20261107/final-tests.tap`。
- 两CJS Node20语法检查通过。首次额外CJS lint被TS专用no-var-requires规则拒绝，按CJS模式仅关闭该不适用规则后两个文件通过；未改仓库lint配置。API原src全量lint通过。
- API类型检查通过（Node20.20.2调用既有TypeScript5.9.3，`--noEmit -p services/api/tsconfig.json`）。首次命令误指根目录无tsc二进制，未开始编译；该预置失败保留。

冻结源码SHA256：installer `d950a86f44c8a4ab6e35589649d6352e6aa655b1df52e8a601b7838ce43a844c`；测试 `3ba2a37c59716f831e2c70609d3c8ced8c0162edafba0d466b2ad05c5035a3d0`。依赖仅为本树本地链接的既有central依赖读取，无安装或共享依赖写入。

本轮没有真实PG/SQL/Docker/资源/交易/银行/短信/COS/部署或生产操作；未修改七片SQL、Schema、业务服务、离线CLI或CI。#398不关闭，17/24仍阻塞，13/45状态不变。独立两轴复核与整合由主控接续，不能以本收据提前宣称其通过。

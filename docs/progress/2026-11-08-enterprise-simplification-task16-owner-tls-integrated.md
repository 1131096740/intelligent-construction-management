# 任务16 B4 owner TLS源码：独立整合

作者精确12路径提交`1cb6d9d78d6d46bb2b26302db24e1cd15ef130d7`已合原integration为`1446e9de0c7179be42703eae4a44ce0f41b237b6`，基线`4d07c5c1dbc0b5324a48adb8819fc4bd00314ab6`。作者/merge消息均含`[skip ci]`；未改SQL、Schema、CI workflow、真实resource helper或Task10。原作者树及历史证据保留。

最终复审manifest SHA256 `9fb68ebad1533fc415e24863158e2d11c35becdbb022383f7b045f0b85bb4e1a`，取代原1855冻结；Spec增量0，Standards原P2已关闭/当前0。报告为`/private/tmp/jg-382-task16-owner-tls-{spec,standards}-review-20261108.md`。原P2是总目录清理成功错误覆盖私有输入擦除UNKNOWN；修复仅使UNKNOWN单调保留，不扩大搜索/删除外层文件。原公开rename-away RED、首败保留/擦除unknown GREEN和旧107证据完整保留，不称首跑无缺陷。

中央十CJS与最终审查源前后逐项一致，完整hash在外部`integration-checks-receipt.json`。主要指纹：owner stage `1d0ffea0b416e1ab552cf59eda11026ca218073b7390d57a51a3c932e533cde8`；新26测试 `530c211a0ad509bf8f1550d7019f049357e4904c28b362f9f02702f6f685da6f`；probe `737d0733e7b7d0074b544973f59f4834462cd1d7c340668de1b156513e6c3ccf`；共享controller `12c78a7b153cd2a8645205bf2210e9f4e701a8e2e9f657767424bf0ba3af4de2`。B3共用controller正文机械抽出，旧进程组/缺stdio与原82反例均保留。

独立中央Node20.20.2原82＋新26共108/108、原source CLI25/25各新跑一次，零失败/跳过；十CJS语法、CJS模式定向lint（沿用no-var-requires override）及diff check通过。fresh环境只设HOME/PATH/NODE_ENV=test/TZ/LANG/LC_ALL。没有API TS改动，作者API类型/src lint是其准确源证据，不冒本轮中央重跑。外部目录`/private/tmp/jg-382-task16-B4-merger-20261108/`保留完整argv/日志/前后hash。merger旧预检曾将porcelain输出strip而错读首路径，离线定位并修正raw解析；旧失败未归于作者或删除，新freeze预检全部通过。

准确干净代码merge1446的source-only prepare/verify均退出0：3285源码/202迁移/七SQL/一静态case，packet `cf3f599df617e5ba1c0c2e3bfa929c900dc1ece34e0441daf4af70ca41e4dbe7`，seal `3f5a522638d87a4b30beee831b12224ceccfccb0f549b13430ea30db38ef040c`。本收据/PROGRESS会产生后继文档提交，不能用1446封包覆盖最终头。最终准确干净头fresh prepare/verify、外部expected packet摘要见同目录`final-head-seal-receipt.json`；远端回读另存`final-github-receipt.json`，不在文档自引用其提交SHA。

本片只运行public run显式command模拟，未实际启动专用probe/Prisma/TLS连接/SQL/PG/资源或物理进程清理；source CLI只证明源码封包。错误CA/SAN/明文具体拒绝、恢复/擦除首败与身份绑定仅源码和协议证据，不能升级为真实证书、HBA、连接、文件物理擦除或完整driver通过。所有注入仍SIMULATED/nativeExecution=false；default尚缺六原生能力，仍在资源前闭门。

推送前必须重新读取PR428正文及B3事故runbook，并核最终HEAD完整提交消息含`[skip ci]`，按正式授权只推原integration/Draft428。推后按准确新SHA核Actions runs为0及PR head/Draft/checks；跳过或空检查不计CI通过。[fe70误触发事故](2026-11-08-enterprise-simplification-b3-auto-ci-boundary.md)的25取消/1失败、17 PG job准备及未排除的远端副作用永久保留，不改写原历史或workflow。

#398仍OPEN；17/24及16/42/44真实PG/TLS/有效ACL/COMMIT/故障/响应丢失/竞争/清理门保持，13/45不变。未合main、部署或写生产。Task10与12不由本片推进。

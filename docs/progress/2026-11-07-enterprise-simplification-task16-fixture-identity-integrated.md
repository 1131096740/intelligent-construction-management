# 任务16 A片fixture身份源码：独立整合

作者六文件提交`f4aa8c8f`由独立merger合入准确中央`2815a78a6a6bbba5850af5d88fb2cef50a0fb729`，基线`080d30d7e48080ce99a2096a5e125843b27d24be`。仅fixture/cases/新公开模拟测试、源码说明、本地收据及PROGRESS；不改SQL、Schema、业务服务、资源helper、权限安装或CI。旧作者未提交记录保留其历史，不代表本次未整合。

Standards和Spec各0建立发现，独立报告分别为`/private/tmp/jg-382-task16-fixture-identity-standards-review-20261107.md`与`...-spec-review-20261107.md`。中央三源码hash与作者准确相同：fixture `c3254c1bbbe2c6a689ea35ad003f70b02efa8a16ce3023b223e1e844b67ebb77`，case `49a80afb9b8739c8648096ee221ddcfc5031e8addc32c924993085bd47d37ad2`，test `735270e6fe066107066890b4b6dc40801e911d5c95465dc31b6d932f41748718`。

中央新跑Node20原19项A模拟19/19及原CLI25/25，均0失败/0skip；API全类型、三受影响TS定向lint、差异检查通过，不冒中央全API或全lint重跑。测试环境清空后只设置HOME/PATH/NODE_ENV=test/TZ/LANG/LC_ALL，未传数据库或外部网关凭据。完整argv/退出码与原始日志在`/private/tmp/jg-382-task16-A-merger-20261107/`，`merge-receipt.json`独立记录。

准确干净2815源码prepare/verify各退出0：3262源码、202迁移、七SQL、一静态case，case源码指纹绑定本次新49a80afb；packet SHA256 `ee41c96201871bc7e09ffce5fa3b878eb77498c7969cd3ec1d446b13e57a0fae`，seal `972c42da7732e53c0937436179b5559114cc9248870e598f7b2acf6c3a4d9a19`。本收据与PROGRESS后继仅文档，不将2815封包冒后继准确头；最终文档头的独立prepare/verify及远端回读另见同外部目录`final-head-receipt.json`。

本片只交A：会话/资源声明身份协议和原case十一表select；没有启动B总driver或连接资源。tls=true和transport声明不证明客户端CA/SAN；当前资格查询也不等于完整有效ACL或所有连接池身份验收。SQL解析/安装、权限、真实COMMIT/故障/丢响应/并发与清理未验；#398保持OPEN，17/24与16/42/44门保持，13/45阶段关闭不变。原树及失败保留；没有真实SQL/PG/Docker/资源/交易、main合并、部署或生产操作。

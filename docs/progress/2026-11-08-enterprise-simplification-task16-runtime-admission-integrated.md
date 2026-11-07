# 任务16 B2运行时准入源码：独立整合

作者八文件提交`260dfeff`已独立合中央`3efe47653006e71edae8b6caac070ab437466e25`，基线`ea663079eb9408fd6de882ab8dad05fd75017f7d`。只含四CJS、B1说明维护、新runtime说明/本地收据及PROGRESS。未改真实资源helper、installer、fixture、SQL/Schema、业务、权限安装或CI；Task10独立候选未被本片改写。

原Standards两P2及后验残留已分别实证并修复：manifest及inputs/witness/tool后验统一有界qualified FD读取；父模块路径缓存改为fresh resolve→父封存目标核验→fresh metadata。原窄RED/GREEN、父超时SIGKILL和各阶段旧38/40证据保留，最终Standards/Spec增量均0未关闭。报告`/private/tmp/jg-382-task16-runtime-admission-{standards,spec}-review-20261107.md`。最终作者证据manifest为`37caf66b8b9723559ec1d4df30df55085b93c579dfcb6d0fe533a950bf48f306`，不将初版0发现冒成无缺陷证明。

中央四源码与已审作者逐项相同：driver `a6c868de307ed457db2c978cc9522029d7e492f41a44c701f2d9ed9ebdf69db1`；原21测试 `840205f6d76a0057fed662d7db7b7fbbc57a31dd9c67e162b8adea6fc32bd728`；helper `8fe990b457b7273101624fe7c72b161f10889d35ad5c0022cda483f7b5a5ce3d`；新22测试 `0c57ddce3585688864f06b2f7fc617c54e2987cdbf7c6e455e5cf86f4ed3e418`。

独立中央Node20新43/43（原21＋新22）、原source CLI25/25，各一次0失败/0skip；四CJS语法、CJS模式定向lint及差异检查通过。Node环境清空后仅设HOME/PATH/NODE_ENV=test/TZ/LANG/LC_ALL，日志/结果在`/private/tmp/jg-382-task16-B2-merger-20261108/`。无API TS修改，不把作者类型/全src lint冒中央本次全跑。

准确干净3efe源码prepare/verify各退出0：3272源码、202迁移、七SQL、一静态case。packet SHA256 `2f61d5fa39e62f362d0633902cedfda003eea656838238589fe479b2dee5ce04`，seal `a3c3ce30a9005b1692cee478433e2b174d7b0ead02f9f48fbddd63e8697e0e3e`。本整合文档/PROGRESS后继只为文档，不冒旧封包覆盖最终头；最终准确头prepare/verify及PR回读见同外部目录`final-head-receipt.json`。

本片source CLI封包是真实Git核验，但43项B2协议测试的source CLI回执模拟、Python合成五树及Node合成metadata实际执行；不是当前真实候选的完整工具/依赖准入或真实fresh-build证明。所有注入仍SIMULATED/nativeExecution=false，不从默认补齐资源/SQL/App阶段；default八未完stage在source/资源前拒绝。资源/SQL授权、owner TLS正负控、迁移、baseline/registered有效ACL、clients/App/fixture/case实接及COMMIT/故障/响应丢失/并发/清理均未验。

用户本轮对指定GitHub仓库/分支新授权“授权本次及后续范围内推送”，完整指针`/private/tmp/jg-382-push-authorization-20261107.md`；这不授权实际PG/SQL/资源或部署。#398保持OPEN，17/24及16/42/44门保持，13/45阶段关闭不变；没有main合并、部署、生产或真实业务操作。原作者树及失败证据全部保留。

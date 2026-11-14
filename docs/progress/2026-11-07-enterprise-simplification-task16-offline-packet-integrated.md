# 任务16离线准备工具独立整合（2026-11-07）

## 准确候选与范围

作者提交 `88b4304f` 已独立合入中央 integration，业务/工具合并头为 `b36e3e530b41af66b1be0972bc652be6d0230331`。相对原 `95a256148cff9ca2b48b51e6b1b5c48dc5923aa8` 仅五文件、494新增行：CLI、原公开CLI测试、OFFLINE-PACKET说明、本地历史收据和PROGRESS。未改七片SQL、Schema、正式迁移、业务服务、CI、旧runner；未推送或合main、关票。

三文件准确摘要与原两轴R2审查逐项一致：CLI `bf1aa6936f184db6598f0f99834adbd11f4e441042dcf2257b28e52601ff4279`、测试 `e0bcee08c8bc8ee8aa620f5a634872a87115a72a823021e83da98a580f3e1a1d`、说明 `d670f5e51429b8317f668b305bf4dc4d9ec9a988bcafa8e76e5f0dd00b194662`。原Standards与Spec报告位于 `/private/tmp/jg-382-task16-offline-packet-standards-review-20261107.md` 和 `/private/tmp/jg-382-task16-offline-packet-spec-review-20261107.md`，R2各0未关闭发现；本次独立复核未新增发现。

## 独立运行与来源绑定

先在作者树使用 Node20.20.2 新跑两个CJS语法与原25项公开CLI，25/25、0失败/0skip。合入后在中央准确b36再次独立新跑同两语法及原25项CLI，25/25、0失败/0skip。测试仅创建自有临时合成Git源码与文件包，并按原t.after清理，没有新增测试边界。

中央b36干净源码实际prepare及verify各退出0；verify使用prepare标准输出的调用方固定包摘要。3253份tracked源码、202份迁移、七片SQL、唯一静态案件；seal `172535dc605f42759421bee76c678e2d42b5ea9eba7c67b934bbd50e608c177a`，packet SHA256 `77ed9a23fed11c88417c72a80929eeb2284351773051adc5cded462fe624dc75`。完整argv、退出码、指纹、clean状态见 `/private/tmp/jg-382-task16-offline-merger-20261107/receipt.json`，测试日志及实际输入包同目录保留。

本收据及PROGRESS只增加整合文档，不把b36源码封包冒成后继文档提交封包。文档提交后的准确HEAD准备/校验结果由同外部目录 `final-document-head-receipt.json` 记录，不自引用未来SHA；其CLI字节须仍与上列相同。

## 边界与未完成

包仍为 `SOURCE_ONLY_NOT_EXECUTED` / `SOURCE_ONLY_VERIFIED_NOT_EXECUTED`，`executionAllowed:false`、`resourceExecutorImplemented:false`；静态库存不是可运行PG组。SQL安装/语法、角色ACL/TLS、资源身份、COMMIT/异常/断连/响应丢失/并发和清理仍未验。#398保持OPEN、17/24阻塞、16/42/44硬门保持；13/45按各自阶段边界关闭不变。任务10仍独立实施，12等待10。

历史本地收据和下方旧“未提交”状态原样保留，仅描述其当时状态。本次只完成本地范围内commit与integration merge，无远端写、真实PG/SQL/Docker/资源/交易、部署或生产操作。

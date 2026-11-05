# 任务07中央私有整合与本地验证

下列本地收据记录独立合并代理交回时点；GitHub后续状态见末节。

准确中央合并SHA：`ecbed5a4538d7e218e456b7ae55c3a1a4020f78e`；候选：`2e5f1557a3e4018277f98b371a8f5ce51e8b0c62`；合前中央：`a4b325df8f2565222f1e6a9671f3d7122ee96b84`。

独立Standards/Spec均0项绑定准确候选后，以`--no-ff`及`[skip ci]`消息合入私有集成分支，无冲突；最终clean。合并树与候选树严格相同：`1a4034118e91e3d03e190140f36d4b47039bcebe`。没有修改业务源或生成物。

## 本地结果

- shared-domain build通过，先于后续测试/构建。
- API明确28个非PG文件：28套1151项通过；测试未设置SKIP_DATABASE_CONNECT。
- Web明确3文件：5项通过。
- API类型/lint/build，Web类型/lint/check:ui均退出0；Web lint 0错误760warning。
- fresh APIbuild后原7项metadata检查链通过：702路由、656wrapper/695绑定、397动作、0阻塞，86退役写入口；无生成器豁免，无改写清单。
- 原静态编排369通过、0失败、0跳过。
- PG manifest仅静态validate：executed=false，23组78文件523逻辑场景，其中CI22组77文件522、人工1；198迁移仅源码库存，未应用。
- 新准确merge源码prepare/verify均退出0：3098文件、198迁移；seal `b101a8954657c30b485716106928bb1f9a1f6e7d88e9ebdc1f52113fa13faf4b`。
- 独有封包：`/private/tmp/jg-enterprise-task07-integrated-ecbed5a4-source-20261106.json`，文件SHA-256 `145039014f3f70a57d3806b4d7272ca1e5d90a0bff0b3bb52593b95c398f0caf`。

每一验证命令的准确args、退出码、计数、外部日志路径与SHA-256在同名JSON的commands内。所有写操作均显式中央private cwd，并在构建/日志/报告前断言resolved cwd。检查顺序执行，无失败重试，无在途自有命令。

## 边界

仅本地私有集成与已确认合成HTTP/服务/UI、静态准备边界；未执行PG/SQL/迁移/真实账户、短信、存储或Docker资源。未push、GitHub写、main合并、关票、部署或生产操作；#387/#389保持OPEN、PR保持Draft。原dirty根与06/11私有树未触碰。源码封存不证明依赖闭包、实时银行或完整发布/真实业务验收。

## 主控GitHub收口

中央ecbed已推送；05[重新关闭](https://github.com/1131096740/intelligent-construction-management/issues/387#issuecomment-6664056124)、07[关闭](https://github.com/1131096740/intelligent-construction-management/issues/389#issuecomment-6664057327)。实际closedAt分别为2026-11-05T17:01:10Z与17:01:13Z（北京时间2026-11-06）；当前7/45按不同边界关闭。PR428仍OPEN/Draft、head ecbed、远程checks为空，不计CI通过；未合main或部署。逐命令JSON收据SHA256为827331549c6e2177b3291b81a3fd9b5518c7833108d6e16a1af944373955fd03，保留在/private/tmp/jg-enterprise-task07-integrated-merge-20261106.json。本文后续文档提交不替换ecbed的业务验证来源。

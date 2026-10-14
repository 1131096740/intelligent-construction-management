# 2026-10-14：CI平台路径与发票PG16就绪最小修复

## 原冻结候选与停止证据

原候选 `44628cac5ac6b1bf3133e253e7925757936e2352` 本地完整17/17及原收据验证器exit0；用户批准推送后建立草稿PR #313。固定head CI38515969555首次出现Quality gates和invoice_ledger_pol260失败，按原阶段规则停止，不重跑或修复原分支。失败原日志保存在 `/private/tmp/jgzg-page-action-manifest-final-acceptance-20261014-r2/github-ci`。

## 获准范围与最小差异

用户单独批准独立诊断、最小修复、受影响验证、本地提交固定新SHA与双审；不推送或访问生产，新SHA完整17门及PR更新另行报批。

1. `controlled-task-wiring.test.py`的三处真实文件测试使用系统临时目录并规范化路径。Linux不存在macOS `/private/tmp`，不能创建该目录掩盖测试；macOS系统临时路径有别名，测试先取得规范路径，生产目录/所有权/替换拒绝校验不变。
2. 发票原runner的`pg_isready`增加`-h 127.0.0.1`，保持原60次/500ms及宿主TCP检查。官方PG16初始化临时服务器仅监听socket；旧探针成功且宿主映射端口可接受连接不能证明PG协议可用。
3. 在原runner公开等待函数测试新增socket-only阶段拒绝回归，不修改业务断言、Schema、权限、skip、retries或超时。

## 反例及验证

- 原Python入口真实官方Linux Python3.12容器（无网络/只读根目录、临时目录内存盘、无宿主挂载）稳定复现三例FileNotFoundError；修复后原7/7通过。官方镜像固定digest `sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1`。macOS首次系统临时路径别名设置失败独立保留；规范化后7/7通过，不放宽生产路径校验。
- 真实官方PG16初始化窗口：旧等待函数在socket ready/TCP unavailable时提前返回，真实SQL连接失败；修复后等待至最终TCP服务器，`SELECT 1`成功，两轮临时容器分别准确清理。证明启动弱点及修复，不声称唯一还原原CI现场，原CI无初始化完整trace。
- 新公开等待函数回归RED→GREEN；受影响Node测试及编排通过。原发票PG16窄门10/10、全仓类型检查和lint（0 errors/570既有warnings）通过。
- 详细执行与摘要：`/private/tmp/jgzg-ci-platform-readiness-evidence-20261014`。最终SHA与双审由独立本机收尾收据绑定；这些窄门不构成新SHA完整17门，旧收据不继承。

## 剩余条件

草稿PR #313仍固定原head，本批未更新；原CI自动继续的其他任务不作为新候选验证。最终新候选完整17门、正常更新草稿PR及固定head CI需集中批准。生产备份恢复、维护迁移/部署和业务开放继续分别批准，生产自动入口禁用和旧02:30任务保留。

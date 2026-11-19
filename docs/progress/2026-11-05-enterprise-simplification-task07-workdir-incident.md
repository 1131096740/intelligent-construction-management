# 任务07工作目录事故与独立复核

任务07一次源码替换命令遗漏工具workdir，落到原工作区；两份payment-request源文件各经过read_text/write_text，第三份Web路径不存在后停止。此操作违背隔离执行要求。没有据此reset、stash、clean、逆向删改或采纳原根差异；事故原命令及后态计数保留。

## 已独立核实

原根两文件当前SHA-256与早先采集的captured_sha256逐项相同：

| 原根相对路径 | 当前及早先采集SHA-256 |
| --- | --- |
| services/api/src/payment/payment-request.service.ts | 8c16491e3bc336b8a50d5f86dbbc7e470273d7177c73820fa4c761c5b0fa5953 |
| services/api/src/payment/payment-request.service.spec.ts | ccd5b48bed1a54aeaaa76f6fdc9552ba3925c4c2a8ec1fa860adb1145145364b |

其Git blob亦与已提交集成起步材料绑定的baseline-vs-main附件一致（附件SHA-256 b8297011bf90af281ac9546ea39ae06e050771a387c9f9a3a981b40fb7949ba5）。原根旧差异未吸收进本轮源码。拟执行的七项API替换结果均未在后态检出。

## 证明限度

两次写回确已触碰文件mtime/ctime；没有即时调用前快照和原mtime，不能声称调用前后所有字节及元数据逐项完全未变。现有证据证明的是当前内容与早先采集指纹一致；未猜测或恢复时间戳，没有回退原有用户差异。

独立复核JSON `/private/tmp/jg-task07-workdir-incident-root-verification.json`，SHA-256 `6127833b16e68712db0aa85ac94b693521c572c3dc2947775834e1b3c60723c7`。原命令和逐项计数在同前缀事故材料中保留；未将原根未提交源码或diff上传。

## 执行处置

07暂停后在其独立工作树核对状态并恢复；所有源码、生成物、日志写入前均须明确私有workdir并断言resolved cwd，文件以私有绝对路径定位，Git显式私有-C路径。06/11已确认同一防护。该护栏属于执行过程，没有写进产品权限逻辑。

[工单事故记录](https://github.com/1131096740/intelligent-construction-management/issues/389#issuecomment-6661452570)。此次未执行PG、SQL、迁移、真实网关或部署。业务实现及后续验收仍按本票确认边界进行，此复核不算业务通过。

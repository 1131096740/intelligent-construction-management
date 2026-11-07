# 任务16离线准备工具：本地实现与源码校验（2026-11-07）

本片仅实现用户已确认的离线CLI测试边界，任务16/#398仍OPEN，17/24不解锁。源码位于`/private/tmp/jg-382-task16-offline-packet-20261107`，分支`codex/enterprise-task16-offline-packet-20261107`，基线`95a256148cff9ca2b48b51e6b1b5c48dc5923aa8`。未提交、推送、合并或修改CI；中央集成树仍是干净95a。工具源码未包含在该Git提交中，其指纹与准备输入的candidate SHA分开记录，不冒已提交候选或发布资格。

## 交付与边界

新工具`scripts/prepare-task16-registered-pg.cjs`提供`--prepare --repo --candidate-sha --output`及`--verify --packet --expected-sha256`。只读Git plumbing禁replacement objects/fsmonitor及全局配置，检查准确HEAD、index、tracked字节/属主执行位及未跟踪文件；固定202迁移、Schema、七片SQL顺序/内容指纹、fixture和唯一静态案件声明。输出新目录、不覆盖既有文件，不接受SQL/资源执行参数。

静态案件由本工具workspace的锁定TypeScript5.9.3解析，加载前后核typescript.js SHA256 `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`。不从输入repo加载模块，不import业务代码；只接受顶层具名FunctionDeclaration及字面清单，拒模板/正则字符串、嵌套、default、转义名称伪造导出。工作树仅有供读取的ignored TypeScript依赖链接，没有安装或写共享依赖。

校验必须接收调用方固定的完整包SHA-256，不能只信包内自报seal；随后与准确Git源码导出重建比对。状态始终`SOURCE_ONLY_NOT_EXECUTED`/`SOURCE_ONLY_VERIFIED_NOT_EXECUTED`、`executionAllowed:false`、`resourceExecutorImplemented:false`。七片SQL、Schema、资金服务、旧runner及CI均未修改。详见[工具说明](../../services/api/prisma/prepared/task16/OFFLINE-PACKET.md)。

## 红绿与最终准确结果

正常准备/校验、篡改/重算内部hash、缺迁移/SQL、dirty/SHA/index、路径/符号链接/不覆盖及静态伪导出逐片公开CLI反例先RED再GREEN；测试只用本次拥有的临时合成Git源码目录和包。旧局部lexer及default-only反例与23项旧阶段结果保留。

父复核另发现执行位错误：旧`0o111`把group/other执行位当成Git属主执行位。两向公开反例实证：Git100755→chmod0641时真实Git mode dirty而旧CLI误接受；Git100644→chmod0641时Git clean而旧CLI误拒。仅改`0o100`（S_IXUSR）后原两例GREEN；没有对真实仓库chmod或commit。原RED、最窄2GREEN/23未跑、最终25全跑分开保存，不混计。

最终候选清单`/private/tmp/jg-382-task16-offline-packet-evidence-20261107/owner-exec-bit-r2/candidate-manifest.json` SHA256 `10d7e472865fc03c69b546ff9cf78b66338746527dbf60611b049640db31b862`：

| 文件 | SHA256 |
| --- | --- |
| CLI | `bf1aa6936f184db6598f0f99834adbd11f4e441042dcf2257b28e52601ff4279` |
| CLI测试 | `e0bcee08c8bc8ee8aa620f5a634872a87115a72a823021e83da98a580f3e1a1d` |
| OFFLINE-PACKET.md | `d670f5e51429b8317f668b305bf4dc4d9ec9a988bcafa8e76e5f0dd00b194662` |

Node20.20.2两个CJS语法检查及25/25公开CLI测试通过，0失败/0skip；前后候选字节同。最终收据`owner-exec-bit-r2/final-node20-receipt.json` SHA256 `0ccc543c94b006755b7fa8191871c92900f23d773fb1a5852ce06b7c9812a1aa`。Standards/Spec原完整审查及本次增量当前均0未关闭发现，报告在`/private/tmp/jg-382-task16-offline-packet-standards-review-20261107.md`、`...-spec-review-20261107.md`。

最终CLI对仍干净的中央95a源码实际prepare/verify各退出0：3249份tracked源码、202份迁移、七片SQL、一个静态案件`registered.null-cross-company.commit`。包`owner-exec-bit-r2/actual-source-95a/packet.json` SHA256 `feb2778c072cd65521afe8fd66e4a4bbad87f5bcc5883bd76de3cfba743dce99`，seal `cefa0819e97392a324dbc08736b98c0fc1b39a130b21bb3316ca42c57378a384`；实际收据`owner-exec-bit-r2/final-actual-source-receipt.json` SHA256 `138783047473c420ac6afa46c6715ab0e157ae2a9c4e1be4954e67f1d7a851dd`。完整argv、Node环境、精确输入及前后CLI字节见该收据。根目录旧1ef/c7/23项/2391包保持历史，未冒当前结果。

## 没有证明或执行

仅一个静态案件库存，不是runnable PG组或已通过真实案件，不加入旧540等PG总数。SQL语法/安装、owner/runtime/observer实际角色与ACL、TLS、资源身份、正常COMMIT、提交异常、断连、丢响应、并发及清理均未验证。当前fixture的observer连接不能冒称独立最小权限角色；旧task01 TLS证据不能借给本票。没有SQL/PG/Docker/真实交易/银行/短信/COS/部署或生产操作。

下一步是专用真实资源执行器及角色/传输/安装/身份/清理闭环的源码准备与审查，实际资源/SQL/PG仍须具体授权。任务10局部修复在原隔离树保留，任务12仍等10。整套#382仍13/45按各自边界关闭，PR428仍Draft，不能据本离线工具收口整票或宣布可上线。

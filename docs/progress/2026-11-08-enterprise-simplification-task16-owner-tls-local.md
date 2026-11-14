# Task16 B4 owner TLS 本地源码准备（2026-11-08）

独立树`/private/tmp/jg-382-task16-owner-tls-20261108`，分支`codex/enterprise-task16-owner-tls-20261108`，准确基线`4d07c5c1dbc0b5324a48adb8819fc4bd00314ab6`。已读当前账本/事故记录，保留此前fe70取消CI历史；所有后续提交和最终推送HEAD必须[skip ci]，本作者未提交推送。

用户原有角色隔离、TLS/集群身份变化、顺序/首败/清理“确认全部，仅源码与模拟测试”映射到原public run的owner command接线，主控明确属于已确认TLS边界的实现形式，不再重复询问；没有新增物理或私有函数测试边界。详见[合同](../../services/api/prisma/prepared/task16/OWNER-TLS-SOURCE.md)，外部授权映射`/private/tmp/jg-382-task16-owner-tls-evidence-20261108/seam-authorization.md`。

本片完成专用owner阶段及三模式probe源码；单独owner TLS前提替代原缺项，不扩旧Task01接口/ACL。B2返回唯一已验packet里的executionFiles成员供stage跨await重核；native controller由B3机械抽取生产共用模块。原B3测试文件39条未改；原21仅更新默认missing cap预期，原22仅增加准确源码成员copy，拒绝/清理断言保留。

本地首个public run正控`first-red.tap`为缺owner command接线拒绝，随后`first-green-attempt.tap`通过。先完成1个正控再补具体反例，首轮23/23；SAN期间resource+receipt同时换ID的公开反例`restore-identity-red.tap`失败（旧恢复会调用换身份资源），GREEN补恢复前最初身份guard；主命令失败同时私有输入替换的`first-failure-erasure-red.tap`失败（旧finally覆盖首败），GREEN保首败并另记擦除unknown。均保存原红日志，非物理进程/TLS实证。

本轮owner健康/错误CA/SAN/plain/HBA、SQL、runtime树compare及子进程结果均由public run显式command/resource协议模拟。测试只读本树源码、工具字节，写自有临时合成JSON/CA文字；没有运行专用probe、PrismaClient、真实SQL、网络、证书/Docker/端口资源。类型/lint采用本树ignored service依赖链接只读既有中央依赖，没有install或共享修改，不冒隔离runtime闭包证明。

实际PG语法/TLS/证书切换、资金COMMIT/故障/响应丢失/竞争/物理cleanup未验；默认六stage仍资源前闭门。#398与17/24、16/42/44门及13/45不变。独立双轴/整合尚待主控。

## 最终冻结检查

Node20.20.2原82＋B4新25＝107/107，0fail/skip/cancel，30.08秒；原source CLI25/25，19.86秒；十CJS syntax、定向CJS lint、API typecheck/全src lint及diff check通过。首轮CJS lint因try块function declaration失败，改为const函数表达式后lint通过并重跑最终107，不隐藏首次失败。B3 nativeProcess+nativeCommand抽取正文与基线逐字相同，见mechanical-controller-extraction.json；没有物理事件新增测试。

新25覆盖：完整控制顺序/敏感输入擦除正控；三种一般CA错误拒绝；SAN失败恢复；恢复失败停止；SAN首败加恢复失败；三种精确HBA条件缺失；四种宿主/SQL身份不一致；nonce/disconnect缺失；四种未settled/超输出/非零/丢回执；SAN取消；receipt+资源同时换ID；command对象不完整闭门；SAN期间换资源不得恢复到替换资源；主命令首败加私有擦除拒绝。上述只是协议，不证明实际客户端TLS/SQL/物理清理。

证据目录`/private/tmp/jg-382-task16-owner-tls-evidence-20261108`：final107-after-lint.tap、cli25.tap、syntax.log、cjs-lint-final.log、typecheck.log、api-lint.log、seam-authorization.md及原RED/GREEN日志；fingerprints见freeze-manifest.json。以下为本次未提交源码，不冒4d07已包含的代码或最终SHA验收。独立双轴仍待主控。

| 初版107冻结文件（历史） | SHA256 |
| --- | --- |
| run-task16-registered-pg-local.cjs | 7d4afd87b37669e0147584871274c0278f79ccfe7a58fd2788ea51f92d5aa916 |
| run-task16-registered-pg-local.test.cjs | 613f5fc930eb969ca042009e30e6703a56a0a7afd1a885b7c251eba74a0a3783 |
| task16-baseline-migrations.cjs | 27fea1bdbba2c62a9767d10188fccdfa54b549f5398c607f355cbaea8880ebcf |
| task16-baseline-migrations.test.cjs | d1a702d35fca2e80b96408630c349a9c2dcc0742b1eb5d9bd8fec11c8116e285 |
| task16-runtime-inputs.cjs | e894650c0028a34be0abcb262147d4452d70672d948911a8fe63b13ba634508c |
| task16-runtime-inputs.test.cjs | 6f4061b280d3aacc9fe8e2a1a6d9faa2bbb649cdfb538a37551bbf5e542fe69a |
| task16-bounded-command.cjs | 12c78a7b153cd2a8645205bf2210e9f4e701a8e2e9f657767424bf0ba3af4de2 |
| task16-owner-probe.cjs | 737d0733e7b7d0074b544973f59f4834462cd1d7c340668de1b156513e6c3ccf |
| task16-owner-tls.cjs | 4ac4c2946fd14013f5008230d5f41fd9c850ae6d7ad33f71be0adc780d25b844 |
| task16-owner-tls.test.cjs | ee9165fdbac21135338871c518bf51406c60f6abfd9ca3fc06090fba893c518f |


## Standards P2补修冻结（108模拟，替代初版当前指针）

正式原报告`/private/tmp/jg-382-task16-owner-tls-standards-review-20261108.md`仅1项P2：probe私有输入已无法确认擦除时先记unknown，但删空metadata目录成功覆盖为ERASED。原同路径改内容用例不能覆盖输入被移走后目录可删的分支。

保持已确认public run/command边界，新增第26条TLS模拟：将本次自有合成probe输入rename至本次artifacts外层自有私有文件，再返回code1；不运行真实进程/证书/SQL。`review-moved-input-red.tap`明确实际ERASED≠期望UNKNOWN_DO_NOT_CONTINUE；最小GREEN只使目录成功清理不得覆盖已有unknown。保留原TASK16_OWNER_COMMAND_FAILED首败，原metadata目录确实删除、外层文件仍在，并未扩大产品扫描/删除范围；该合成文件最终仅由本测试自有临时夹具清理。`review-moved-input-green.tap`含新增及原同路径擦除反例均通过。

新完整原107＋新增1＝108/108，0fail/skip/cancel，35.98秒；原CLI25/25，23.55秒；受影响两CJS syntax/定向lint及diff check通过。未改TS或其他源码，不重跑不冒新API类型/src lint证据；初版相关静态日志保留为历史。

新证据`review-final108.tap`、`review-cli25.tap`、`review-syntax.log`、`review-cjs-lint.log`及上述红绿。新`review-freeze-manifest.json` **supersedes** 当前源码指针；旧freeze-manifest.json SHA256 `1855d44f153ce19083235f51070ae6a28db0cec530d7e0fa04fd4313195efed9`保持原样，仅属初版107历史，不复用其当前通过断言。其余源码hash不变。P2修复后独立两轴增量复审仍待主控；无提交推送或真实资源/SQL操作。

| 补修源码 | SHA256 |
| --- | --- |
| task16-owner-tls.cjs | 1d0ffea0b416e1ab552cf59eda11026ca218073b7390d57a51a3c932e533cde8 |
| task16-owner-tls.test.cjs | 530c211a0ad509bf8f1550d7019f049357e4904c28b362f9f02702f6f685da6f |

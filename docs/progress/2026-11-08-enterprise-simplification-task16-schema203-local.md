# Task16 Schema203源码与模拟协议本地收据

## v2 首审两项P2修复（待增量复核）

原冻结bafc708ca3fcd99186579a0d4767f56e653871ee8d5d0ba2759e19164939dae4及27前像、318证据清单、两轴首报全文完整保留在外部 `review-fix-v2`。本次只改原27内7路径：SDK inspector/原runtime-input tests/原baseline tests/两profile（含必要sourcepins）/两MD。没有新入口、DI、flag或物理边界。

1. SDK嵌套赋值、别名读后写、Object.defineProperty反射修改：旧publicrun三例均错误允许（RED0/3），新有限AST+完整literal正控GREEN4/4。完整已审generated index只按固定proof的完整源码SHA承接已知形状，仍核完整Schema/inline/model及初FD；其它index仅允许单一const config纯literal、唯一runtimeDataModel=JSON.parse字符串、可选纯Error字串终止（仅静态测试数据）。任何其它语句、嵌套写、alias/解构/参数逃逸、计算统一拒；不是以包版本/目录/标记自授，也不是一般JS解释器。已审11成员expected来源/全部内容门及no-engine native=false不变。
2. PG16单OUT列的prorettype为该列type；V2 Impact RETURNS TABLE(id TEXT)三处profile改为text，同时retset与IN/OUT名/型/序不变，Fact多列仍record。原公开resource metadata协议对text正态旧拒、record漂移旧放行，两条实际RED0/2；修后GREEN2/2。该mock只有限模拟catalog比较与向owner适配器发出的profile数据，未SQL解析/执行或连接PG，不以模拟当真实catalog证明。B5/B6/B7仍同一checker。

受影响完整B2/B5/B6/B7四组 `review-fix-v2/affected-regression.tap` **142/142**、CLI27/27、全API私有203 tsc0、3个受影响CJS syntax/lint0。旧原362是302+60不同分组历史，不挪作新freeze全量；这次新增5个实际case（3 SDK+2catalog），未重跑9min三组。准确组合门/最终全量计数留merger实际执行，fixture20及业务1148未在此重跑。原dirty实际prepare SOURCE_NOT_CLEAN拒绝仍正确，最终clean候选203封包未做。


2026-11-08，HOLD待双轴。唯一作者树 `/private/tmp/jg-382-task16-schema203-20261108`，分支 `codex/enterprise-task16-schema203-20261108`。准确基底fe8ff2fdb684ea36fc1209e62f5e3d4f3a3dc413，parent c4d1a1fbf947ebc60fa5be19fa424d394d365011，tree6570c6810855a11f0077526deb2aa95efadf869c。中央仍另树d78/202；当前不提交、不推送、不合中央。适用implement-spec/TDD，沿已确认原public prepare/run、resource metadata、显式command/createClient及自有fake CJS，无新增公开DI或CLI旗标。

## 范围与证明

- 精确库存202→203，不允许任意数量；CLI旧202/额外204与ledger错误仍拒。baseline/registered profile新48=原44+4，旧42完整不变、两个validator按有序202→203 Fact精确6/Impact1→原七片文本重演。没有SQL parser/执行，不能把源正文SHA当PG prosrc实证。42旧routine/原V1SD/companyhelper、七prepared SQL、四guard与原runtime/observer矩阵保持。
- 两V2 composite全部46/23属性名/顺序/类型/typmod、固定owner/ACL/第三方见证；四新routine全body/IN/OUT/返回/属性，parent INSERT trigger绑定/条件/列过滤，PUBLIC/runtime/observer EXECUTE否定矩阵。未授新V2 EXECUTE/TYPE USAGE。TYPE USAGE控制创建依赖对象，不声称撤销它即可禁止query的ROW cast。
- 新Review helper caller：四旧/新SD append实际owner固定，effective EXECUTE与两关系真实owner、每个有效列SELECT及至少一列UPDATE锁资格。owner本有权限就不加grant；不足或漂移拒。runtime/observer不因该证明获得Review/Fact直权。B5初份typeACL经事务/提交后、B6、B7同一checker贯通，保旧other-grantee/OID/14表来源，不用后观测替初份。
- B2仅静态AST读取SDK源码，不require/eval输入SDK：完整sourceSchema/生成Schema/inlineSchema/runtimeDataModel，已审11成员hash证明expected来源。原source630401ec...与generated5dba68a9... raw不等；只接受完整35390 tokens中同ExpenseClaim唯一index位移精确pair，不允许任意formatter/删字段。固定proof来自8aced预检；测试metadata仅1,688,685 bytes/SHA351be38e...纯Schema/model数据，无SDK可执行代码。
- B2缺Schema/inline/model全拒，无legacy label旁路。B7消费driver首次捕获的serialized sdkSchemaWitness、源metadata与全部初FD，加载前和跨await拒换文件/丢proof/模型漂移；捕获disconnect仍清理。原整体verifySource替换+显式两函数的自有fake类可继续原SIMULATED边界；资格依据driver不可写simulation和固定两函数boundary，不是目录/5.22/caller新bool。simulation缺boundary在任何live check/默认command前拒；native缺content/engine资格在SDK require前拒。已审no-engine即使11成员全吻合仍nativeRuntimeQualification=false。
- driver整文件SHA384cc5b8e8a5eb8bce4d95f729a8dfc97c7815ed7ce17ba0fed382000faf33ce与SOURCE_ONLY不变；源adapter齐全不等实际运行许可。

## 实际验证与精确承接

外部证据目录：`/private/tmp/jg-382-task16-schema203-evidence-20261108`；最终manifest逐项SHA/mode与完整前像另封。

| 门 | 实际结果/范围 |
| --- | --- |
| 核心CJS（排除下行三文件） | core-final-regression.tap 302/302，52.275s；不是旧344结果换名 |
| App/seed/case原公开fake协议 | schema203-app-seed-case-maintenance.tap 60/60，537.766s自然结束；原19 App、21 seed、20 normal，完整mock/no real IO；长耗时只读ps/sample原件保，无kill/预算修改 |
| prepare CLI | cli27-final.tap 27/27（原25+202/204两个库存反例） |
| 最后桥 | final-source-pin-bridge.tap 12实际cases+1无匹配文件TAP项，不冒13业务case；final-b5-b6-positive-bridge.tap另3/3 |
| 类型 | typecheck-private203.log：准确私有203 SDK，全API tsc --noEmit --incremental false，0；无build prehook/generate/SDK构造 |
| 静态 | 19 CJS syntax；cjs-lint-escape-green.log 19 CJS recommended lint0；JSON/sourcepins/diff另封；作者dirty实际prepare按设计SOURCE_NOT_CLEAN拒绝，最终203 prepare/verify须merger准确clean commit后执行 |

核心302与长三组60按分组准确来源承接，不宣称最终27路径freeze完整362独立重跑。最后只有fixed-signature冗余quote escape和provenance/sourcepins桥：原lint28FAIL保，完整AST kinds及literal值相同；provenance仅明确旧pre203与新final hash。新增缺boundary门对这60显式完整boundary路径不触发，qualified SDK新门在原整体fake source未携B2 witness时仍只SIMULATED。最终准确整候选全362/CLI/类型等须独立merger按最终SHA执行。

## 失败与红绿原件

inventory/203 ledger、48 gate、B5 proof/typeACL与B6/B7初份typeACL漂移均有首RED/GREEN。严格profile首次发现203旧4锚点实际应6，原32d200fc...与失败原件保，money原作者另A4双轴0后新followup fe8修；本作者不改203。安全FF先存own24+TS132，三上游路径与own无交，合后全部own/依赖、A4上游48及driver守恒。

SDK原标签读取RED包括自有throw SDK不可导入；新静态31/31。原30中25pass/5fail原日志保：五个旧SDK执行副作用控制按批准边界移至readOnlyCommand静态工具返回后，准确证明工具/FD/tree前后漂移，不能继续称SDK JS已执行。完整Schema/model/未知计算四负控4/4；compound mutation实际RED→GREEN；B2→实际B7 loader五模式（正常、模型、firstFD、丢proof、connect-await FD）均到新门/清理。旧loader对模型/firstFD错误成功真实RED另保。generated harness引号换行、source pin漏项是测试适配失败，不冒产品缺陷。

省略显式client boundary的旧RED只用当前自有signal.aborted throwing getter作最后tripwire：旧首次live check触1、0 command/SDK，不声称旧已spawn；最小前置拒后tripwire0，原完整fake正控保持。恢复signal descriptor只针对测试所有权对象，不改全局或driver。

## 私有依赖与边界

经root明确批准COPY原02自有依赖，无安装/新generate。56358普通文件/2467链接，原/中央full manifest前后守恒、原287成员逐SHA/mode且新inode、四bindings均解析到本树；shared68 dist与源137按原预检字节承接。sourceSchema630401ec/generated5dba68a9 pair及无引擎状态不变。依赖忽略目录不提交，不引入共享写穿；TS工具原132独立复制前像另留。

fixture TS/原4000分=40元、B100→60、未启用经营与合法16UUID/assignment/日期均未改；App/seed/case三个test仅203库存及同新metadata receipt/ownerReply机械供齐，不弱化原控制点。真实PG权限/锁/overload/语法、COMMIT/响应丢失/竞争/资金/物理清理、#398与14阶段及生产门全部未验/不关闭。历史fixture20是另一namespace模拟证据，当前TS未改与纯类型承接，不能冒新完整SHA20重跑。最终实际prepare在当前dirty候选返回SOURCE_NOT_CLEAN，保拒绝原件，不削clean门或临时伪Git；CLI27合成协议结果与clean候选实际封包分开。无真实SDK/Nest实例化、监听/HTTP/fetch/SQL/容器/数据库/生产。

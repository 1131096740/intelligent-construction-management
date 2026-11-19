# Task16 B9 native seed wrapper：source/mock本地收据

准确基线`563ffd54caa007b89ac52575e3facbfe32c5afce`；独立树`/private/tmp/jg-382-task16-native-seed-20261108`，分支`codex/enterprise-task16-native-seed-20261108`，按正式metadata审批创建。主控已全文读计划`/private/tmp/jg-382-task16-B9-native-seed-implementation-plan-20261108.md` SHA`13a647143d062297c93e12d3ffa1e7e756e11c87243ce2d08e1a420dbe76f003`并发实施GO。授权只源码与已确认模拟：原publicrun、B7 command/createClient、自有fake CJS、原B9a test-owned global.fetch和fake delegates；无新seed对象DI/CLI旗标/context.fetch/OS或物理接缝。中央、旧B8、Task12、产品Auth/Schema/202迁移/七SQL及权限值均未改。未commit/push；future所有commit/finalHEAD含[skip ci]。

## v3 最小native seed源码注册（待增量双轴）

v2两轴source/执行桥均0后，主控准许独立最小注册。`nativeAdapters`仅直接赋值`seedFixture: NATIVE_SEED_STAGE`，与driver私有初捕获函数同一identity，无wrapper/noop；初份dates/FD/build/source与fake transport等资源前validator仍原路执行。默认入口现在**只缺runNormalCase一项**，仍在verifySource输入读取、resource及SDK/HTTP阶段之前拒绝。

先把原默认CLI和原publicrun两处cap期望2→1，`seed-registration-red.tap`实际因多seedFixture失败；一行map后`seed-registration-green.tap`3/3，原stages空/无resource/artifacts/不存在输入包不读/financial与native验收false及无mock flag断言均保。没有新测试输入或接口，只纳入原driver.test既有文件，因此candidate12→13路径、source10→11；其余v2十source中仅driver map变化。

`source-freeze-v3.json` SHA`0e2d18cf889af67e503787493757d1eb0976eb0456c5d452229c3d688c157405`绑定此次source注册；`registration-bridge.json`严格核对唯一map变化及两处旧期望维护。必要`seed21-registration.tap`21/21、`b2-witness-registration.tap`1/1与八CJS语法/lint/19+42pins/diff均0，准确最终结果封`verification-v3.json`/`freeze-manifest-v3.json`。v2及所有更旧freeze/RED/执行桥不覆盖，不宣新全321独立重跑；完整整候选由独立merger另跑。

**源码seed已注册≠实际seed/PG或真实HTTP/资金证明。**只是在原source-only入口闭门下具备可审查adapter代码；case仍缺，#398/真实门/14阶段不变，无commit/push/整合/生产动作。

## v2 首审P2：模拟遗漏fake fetch资源前闭门

原bac3候选首审Spec0、Standards1 P2：simulation直接判qualified，实际source seed漏装fake fetch会把内建函数当模拟传输。`missing-fake-fetch-red.tap`保留内建函数身份、只让显式假startResource计数后抛哨兵，旧代码resourceCalls=1（应0）；SDK/owner/HTTP始终不可达，**没有调用builtin或发真实HTTP探针**。

最小修只在injected模式从run初次捕获函数，利用cold EARLY_FETCH已qualify身份及固定Node bootstrap源码中完整函数正文排除builtin；native仍原EARLY_FETCH_QUALIFIED分支，不加flag/dispatcher/Agent/通用转发语义检查、不晚取新基线。`source-freeze-v2.json` SHA`b3aa7f77839c280edc02876417e284d08991f6ce87997d3df5a1d8942885adb3`的十source仅driver与seed.test变化，其余八路径byte同原bac3。

既有负控维护精确三处：日期/FD/七片八例loop、自报App、旧validator例显式安装原ownedFetch；日期八例新增原failureCode断言、自报App须确达seedFixture失败、旧validator须missing-date code，防止新传输门遮原检查点。正常explicit fake正控仍实际执行fixture/三假HTTP；native default必须仍missing2/无artifacts/source/resource。新测试仍原run/既有global.fetch边界，非新接缝。

原bac3/7dd/939c、319/25/fixture20/type/TS lint及comment/validator前像/所有失败原样保留。v2实际`seed21-v2.tap`21/21、`b2-witness-v2.tap`1/1、`default-native-v2.tap`3/3、七CJS语法/lint与19+42pins/diff均0；其余未改源码闭包按旧收据继承，不宣最终完整321独立重跑。准确v2结果与十二路径以`verification-v2.json`/`freeze-manifest-v2.json`为准。native seed仍未注册，cap两缺/14阶段/#398边界不变。

## 实质实现与当前缺门

- 新真实source wrapper调用同registry中实际编译fixture的builder/seed，不是stub seedCompleted。B2从第一次qualified private inputs FD同bytes核digest/parse可选fixtureDates；提供首inputs identity/hash、固定fixture dist入口/build、七fragment及七source FD。原source-only旧包可缺dates/output，存在dates必须真日历/两字段/付款不早于期初。无host now/Settlement/mtime推导，无新argv。
- driver首次同时私有捕获实际seed函数与admission validator，初份deep-freeze seedAdmission/transport、实际App handle和inspect/runtime/origin/sourceHeader见证；真实seed函数identity被选择时，在startResource前核日期/初inputsFD/固定entry/build/七片及sourceFD。测试提供所有fake后继能力，缺项仍零resource，不借default case缺失掩晚拒。source/日期后验不得重baseline。
- 同B7 one-shot registry加固定无path的fixture加载，复用已记录actual module/exports对象与三client；拒foreign preload、export/helper hash方法漂移，动态bcrypt/信用码依赖必须同sealed五树、实际children、FD和原方法identity。无第二loadClient、删cache、通用loader/VM或第二Prisma。
- 消费原App source-bound私有句柄和真实inspect闭包，核同runtime/provider/server/address/env/storage/source。不能靠nativeProof=true或caller origin自报替代。B7 full验证只在wrapper事务外前后；fixture内部每await轻核FD/source/env/module/方法/首resource/App状态，无事务内owner catalog SQL或外部tree命令；未新增HTTP前中点full。
- 实际fixture保16UUID、单独合法无信用代码BusinessParty/version/唯一assignment、openingDate UTC明确ContractVersion.effectiveAt/Settlement.createdAt、our_company affiliate NULL，原公司B付A/经营未启用case不变。password只新内存随机值，不复用DB密码/宿主env。实际helper完成owner种子、登录、两公司期初登记；后继正常case仍明确fake，不宣整个业务链完成。
- HTTP沿既有global.fetch模拟边界；生产wrapper固定第三内部continuity与transport，不造context.fetch。injected模拟run开始捕获test fake；native cold CLI最早捕获固定Node builtin函数资格，两模式私有且模拟不能落到真实fetch。每await核同首函数；发送前、fetch后、json后检查固定loopback origin、仅两个明确seed POST路径（总三请求）、redirect:error、单次status/url/redirected/json capture与原target响应归属。
- Node资格实际只读核`v22.23.0`、parent binary SHA`cc61696726abdfe8392297ecd75aa9863cd9b6435b202c0dc2266039f493da10`和builtin exposed-window-or-worker源码定义；原B2/B7继续封存同真实执行binary。没有运行native fetch或扩大undici堆/安装Agent。模拟fake函数不冒真实Node fetch/SDK验收。
- owner前拒绝NOT_ATTEMPTED；owner事务/HTTP尝试、确认丢失、后验漂移保UNKNOWN_DO_NOT_RETRY，不retry/声称rollback/删受保护行补偿。原driver按App→clients→resource finally；安全有限错误/单次fixtureOutcome捕获，不投SQL/SDK cause/message、password/token/URL。

**v3已直接注册同一private NATIVE_SEED_STAGE，默认仅缺runNormalCase一项，仍在source输入读取/资源创建前拒绝。**原v2未注册/两缺状态与收据保持历史；本次独立注册delta待增量双轴，case另接。source/mock不是实际Nest DI、guard、SDK连接、HTTP监听、PG/TLS/ACL/锁/COMMIT/竞争/资金或物理清理证据。#398/依赖门保持OPEN，阶段14/45不变，无close/ready/mainmerge/部署生产。

## 实际红绿与失败保留

证据目录`/private/tmp/jg-382-task16-native-seed-evidence-20261108`。

1. `tracer-red.tap`缺wrapper实际FAILED_CLOSED→`tracer-green.tap`真实source wrapper/registry/编译fixture/三fake HTTP/owner模型协议通过。中间fake query把fixture多参数role查询误分B7 nonce；改自有mock协议区分后通过，非产品缺陷。固定无secret阶段编号诊断已移除，原日志保留。
2. `http-attribution-red.tap`原错误URL响应仍模拟完成→`http-attribution-green-qualified.tap`源归属检查拒绝。首green因fixture sourcepins尚未级联早拒，原失败未藏；JSON仅更新fixture source hash、baselineManifest hash和相应sourcepin，无ACL值变化。
3. `internal-await2.tap`断言虽过但暴露异步活动/未处理拒绝：先创建Promise再light抛会遗留拒绝。最小GREEN改为`checked(()=>operation)`先check再启动/await，`internal-await2-green.tap`零泄漏。新增所有连续路径仍经该形式；首light收进fixture自身safe try，owner前错误保NOT。
4. `full-first305.tap`303/305，仅旧B2错误码期望因实现误改_INPUT_FILE失败；恢复原安全code，不改旧断言。新日期/首FD逻辑保留；旧FIFO拒绝与新readonly dates/witness窄回归通过。原脚本TypeError未写source、fake候选缺信用码TS复制的失败也保留，分别属编辑脚本/夹具适配，不计产品RED。

5. 自核首准入validator仍经可变module.exports属性读取，经主控认可沿原verifySource模拟hook验证：`validator-red.tap`删dates并把自有模块validator改noop后resource调用1（应0）。最小GREEN同时捕获首次private const，`validator-green.tap`零resource，不引flag/新loader/cache清理。原native fresh无此外部JS前提不能替代本片原公有连续性反例；实际私有validator资格现在不被晚改exports替换。

## 精确验证与冻结

最终结果及注释修订执行桥以外部`verification.json`/`freeze-manifest.json`为准。原10source冻结`source-freeze.json` SHA`939c4c98144f2b179380add71c3bb220731b28cdfa08f093ed6d7b0e2f7dcbaa`；它绑定注释前319与原CJS lint no-empty失败，不能冒注释后重跑通过。

`full319.tap`在939c原10source上319/319、CLI25/fixture20/types/TS lint均0，原CJS lint仅no-empty一项失败。经主控同意：完整319结束后，仅给吞不可信fixtureOutcome getter异常的空catch补解释注释；以精确前后SHA/AST等价桥区分版本。注释后只重跑受影响seed19/B2固定witness与sourceguard、CJS lint/语法/pins，CLI25/fixture20/types/TS lint按其源码字节/语义闭包明确继承，不宣注释后全319独立重跑。所有旧收据和每次失败原样保存。

注释版`seed19-comment-final.tap`19/19、`b2-witness-comment-final.tap`1/1及静态0后，又按已确认必要收敛补validator const真实反例/最小修正。`validator-bridge.json`严格核对只增加首次const并替换唯一callsite，原19测试字节不变，仅附新公有反例；`source-final-freeze.json` SHA`7dd299ddb6dcb8c5d77a5baac699652d9899e83c72f39074ccf210e9308955e4`是此最终10source。最终`seed20-validator-final.tap`20/20、`b2-witness-validator-final.tap`1/1、七CJS语法/lint及pins/diff0，实际结果独立封存，旧319/25/20/types通过按其精确前像与闭包继承，**不宣最终完整320独立重跑**。最终12路径和证据hash以`freeze-manifest.json`/`verification.json`为准。

v2当时候选共12路径（v3加原driver.test为13）：driver、B2与tests、B7 loader/restricted、新seed stage/test、fixture TS、B5/B6两个source-pin JSON、本地收据与PROGRESS。两JSON runtime/observer/before/44函数/锁guards/7+17owner/otherACL保持原值；checker/所有七SQL/Schema/迁移逐byte未变。source-only/本地绿不能解实际资源与资金门，等待双轴/root独立整合。

# Task16 B8 qualified App bridge 源码/模拟收据

基线准确 `eb39f88ac4b5c5888c9fd8293f398b1d09dba7f8`，独立树 `/private/tmp/jg-382-task16-application-bridge-20261108`，分支`codex/enterprise-task16-application-bridge-20261108`。计划 `/private/tmp/jg-382-task16-B8-native-bridge-implementation-plan-20261108.md` SHA256 `7a0b4158e7f236c22a15f228bb29bc1cfe79bab9ed3de42c31f22778738f33c6`，主控IMPLEMENT GO沿用户已确认fake Nest/module loader/原publicrun范围。旧factory候选、中央与Task10未改；未commit/push，未来所有commit/finalpush HEAD须[skip ci]，原fe70事故不覆盖。

## v3 native App能力最小注册

原v2两轴source及执行/doc增量均0后，按主控小接线GO，仅在native map直接赋值`startApplication: NATIVE_APPLICATION_STAGE`。该函数与driver最初私有const完全相同，无wrapper，原缺8FD/build见证资源前拒的机械判定保留。先在既有默认CLI期望维护与新增原publicrun负例实际RED（多出startApplication），再最小GREEN；两入口均仅缺seedFixture/runNormalCase，输入包不存在仍报capabilities incomplete，stages空、resource未创建、artifacts不存在、nativeExecution/financialAcceptance均false。

本次相对v2只新增2源码路径变化：原driver与原driver.test；后者旧missing3→2维护一处、新公有反例一条。十路径候选增为十一（新增纳入既有driver.test）；其余v2源码不改，v2前像`v2-before-images`与6db0/f096/旧294/290/d44及工具启动失败保留。**余2表示源码适配器存在，绝非真实运行、真实DI/guard/SQL/资源许可或验收升级。**App源码完成不填B9日期/seed/case，#398仍OPEN，当前阶段14/45。

### v3 实际回归与冻结

`native-app-registration-red.tap`为两个真实missing列表断言失败；`...green.tap`两项通过。`full295-v3.tap`＝旧294＋新增默认publicrun1项，295/295，零fail/skip/cancel；`cli25-v3.tap`25、`fixture20-v3.log`20、`types-v3.log`、`syntax9-v3.json`九CJS、`cjs-lint-v3.log`、`preserved-contracts-v3.json`19+42 pins及两个profile byte/hash、diff均通过。只有原driver/test与2MD相对v2变更，余下八source成员中的其它七不变；candidate总11路径，source总9。最终`freeze-manifest-v3.json`/`verification-v3.json`绑定实际日志及前像，supersedes v2作为当前候选；v2及更旧材料原样保留，不挪旧pass。

## v2 首审P2修复与中央同步

本候选现基于准确`d1bbfd10bec9e0dff5988e2d2dcf43bbfbdab8bf`；正式FF前验证八source与upstream无交集并封存原十路径。仅摘除自有PROGRESS精确prefix，FF后恢复于新upstream suffix，`ff-receipt.json`记录八source/九非账本文件守恒，无stash/reset/clean。中央当前阶段14/45；下文eb39、旧290与d44为历史前像，不作新版本通过证明。

- 两轴完整首审：Standards0（目录候选撤回），Spec1 P2；`method-drift-red.tap`实际显示runtime `$transaction`在第四次owner postflight被替换后原仍SIMULATED完成。现在每次light check对owner/runtime/observer四个方法逐个单次读取，与首次捕获function identity比较，拒绝重baseline；仍用原captured disconnect逆序清理。`method-drift-green.tap`确认停止seed/case并清理。
- 另覆盖owner connect/runtime disconnect/observer query被替换，替代方法零调用、seed/case零调用、原disconnect及resource finally保留。没有给runtime加Proxy、hook或重bind。
- 仅静态读取真实Prisma5.22 runtime：`prisma-method-source-qualification.json`记录库hash与Se/yr/model缓存/原型方法依据。四个方法经默认proxy返回同原型function，无每读bind；不强求own descriptor。未require/import/构造真实SDK，不能将这项静态依据升级为实际SDK/连接证明。
- 旧`source-only-freeze.json`/d44、原十路径`pre-ff-candidate-d44.json`、所有红日志与原290收据保留。新版本精确hash与实际结果另封v2；新source修改使旧pass失效。
- 本轮lint `.bin`入口因相对pnpm路径未存在而启动失败，保留`cjs-lint-v2.log`；直接调用现有ESLint JS入口通过，`cjs-lint-direct-v2.log`。不修改依赖或产品代码掩盖此工具启动失败。

## 实质源码与未开放入口

- 新`startTask16Application`实际连接B7私有生命周期、固定模块加载、owned env/storage、已审factory、server/provider inspect和组合close；不是plan-only/noop或返回App已完成的stub。
- B2在封存fresh API dist含专用module时，资源前从同五树/build/source捕获七个固定dist入口及canonical`@nestjs/testing/test.js` FD/hash/identity；SDK只fresh require.resolve不require，测试SDK文件本身throw-if-import仍通过。旧source-only假候选可无App输出，但不能作为native App准入。
- driver首次固定不可替换applicationEntries/applicationBuild witness和B7三client/方法/初始三source header snapshot。真实入口选择只比较模块私有const实际函数identity；缺初份8FD/build/原文件身份不合先于startResource拒绝，无caller布尔或新CLI旗标。该controller CJS顶层只有pure Node helpers/常量定义，无SDK、目录创建或秘密读取；import失败不产生可用native函数。未来native map须直接绑定此同一函数，不能另包wrapper避开机械判定。
- B7同one-shot实际module registry延续Class/文件/actual module对象/exports；不二次load client、不清cache、不改Module hooks/VM/通用解释器。已登记的共享依赖只能同对象复用，App固定入口组可一次加载，fresh witness绑定、Class/exports/metadata漂移拒绝。PrismaService constructor/prototype须继承同已加载Class，token/Runtime为原实例；不new第二Prisma、不改runtime hook。
- `checkLight`只读核FD/source/env/resource/模块与三client四个方法首次identity稳定性；`verifyFull`在事务外复用唯一source/tree verifier、B6 checker/TEMP→READ ONLY及三角色nonce/OID/PID/readonly/TLS/202ledger/44函数/14表/矩阵/otherGrantee事实，不重新授权或安装SQL。factory第三生产内部continuity/onClose callback、inspect只由wrapper提供，不新增用户hook或改变原严格两函数mock形状。
- Native bridge先拒绝继承宿主秘密/配置，创建本artifacts内独占0700空storage及内存随机JWT/file secrets，前后核同值/同目录身份；App关闭返回后仅恢复自己仍持有的值并删除自己原路径的空目录。不覆盖外部变更，不扫描rename-away，不把fallback成功擦掉首次unknown。compile无可得handle、关闭不明、env或目录归属冲突均保UNKNOWN，不重试/称rollback。

**v3 nativeAdapters已直接注册同一startApplication，默认seed/case两缺、资源前拒绝。**原v2未挂App状态与其通过证据保持历史；本次小接线另封必要差异与增量双轴；不能仅靠当前缺后继cap掩盖晚准入。新wrapper返回source/provider/address协议事实与实际inspect闭包，native/financial验收flag保持false；未来B9应消费私有初值+闭包/唯一validator，不能以caller可改status或nativeProof=true当资格。

## 已确认公开模拟与红绿

证据 `/private/tmp/jg-382-task16-application-bridge-evidence-20261108`：

- `bridge-red.tap`→`bridge-green-first.tap`：原publicrun调用实际wrapper，实际B7 registry/三own FakeClient＋自有sealed fake CJS Test/Nest→owned配置→实际factory/假server→full verify/close/恢复。原正常case、seed及其它阶段在此scope是显式fake，不冒完整业务链。
- `partial-restore-red.tap`→`...green.tap`：factory已取得/关闭partial handle后，private callback允许恢复owned配置；compile无handle/close未知仍禁止恢复。没有用额外CLI/adapters输入模拟内部关闭状态。
- `initial-entries-red.tap`→`...green.tap`：原run实际B2 readonly admission资源前取得八FD见证，直接SDK导入禁用仍通过，未把子进程metadata冒父实际Class。
- `pre-resource-witness-red.tap`→`...green.tap`：选择实际native函数但缺初见证，原晚到wrapper才拒；补不可变函数identity准入后零resource/零client。缺build/FD更换额外负例同样在资源前拒。
- `binding-alias-red.tap`→`...green.tap`：同时改public clients.sourceBinding与registered header原可冒新baseline；现在首次driver私有snapshot和每await核对拒，未采用晚观测。B7亦捕获bridge/factory初份FD。
- 额外协议反例：生命周期witness不可替换；role OID漂移SDK前拒；SDK close失败即使module fallback返回仍UNKNOWN；外部env冲突不覆盖；同名Test Class export换对象不按Class.name放行；真实编译AuthModule metadata少一guard拒；SDK预载不采纳；postflight文件漂移停seed；private storage rename-away保unknown且不扫新路径。
- `restore-conflict.tap`初始合成secret sentinel误用了与fake containerId相同的64个d，收据搜索断言产生夹具碰撞；改唯一sentinel后`restore-conflict-qualified.tap`通过。原失败留存，未为此改产品错误清理或隐藏任何真实秘密。

新stage tests纯编译实际Task16 module/AuthModule到自有包，其它SDK/组件是自有无副作用fake；Fake Prisma/Nest构造只创建JS对象，不实例化真实Nest/Prisma/SDK、不打开端口、不HTTP/fetch、不SQL解析执行、不容器/证书/DB资源。command、resource.execOwnerSql、Client query/transaction边界全部显式fake，无native回填。原factory19保留其独立raw协议意义，原fixture20/正常业务handler投影另计。

## v2 实际验证结果

`full294-v2.tap`：原290＋本次4个方法漂移协议反例＝294/294，fail/skip/cancel均0。`cli25-v2.tap` 25/25；`fixture20-v2.log` 20/20；`types-v2.log` API tsc noEmit通过；`syntax8-v2.json`八CJS通过；`cjs-lint-direct-v2.log`通过；`preserved-contracts-v2.json`确认19＋42 source pins/两个权限profile逐byte未改，diff-check通过。SDK仅静态读取，旧production静态emit不作为本次新版本或实际运行证据。v2以`freeze-manifest-v2.json`和`verification-v2.json`为精确冻结；`source-delta-v2.json`只标当时full在途，完整新结果以本段/最终封包为准。

## 历史验证与冻结

- `full-first.tap`为旧274＋首bridge6/B2见证1＝281，后续新代码/反例使其不作最终证据。
- `full290.tap`为**原274＋bridge15＋B2见证1＝290/290**，零fail/skip/cancel；原CLI25/fixture20再次全部通过。
- API类型、八受影响CJS lint/语法、两JSON/19+42 source pins与diff通过。`api-dist-static`为纯tsc向外部evidence目录静态emit，产物未执行，不能作为B2候选fresh五树preparation receipt或实际SDK构造证明。
- 八源码`source-only-freeze.json` SHA256 `d44b141e8261a492965cb21747174582e3b176a952081e0179eff5b277a02aa1`在最终回归期间保持不变；旧完整十路径以`pre-ff-candidate-d44.json`为准；七base前像/三个新文件和全部旧日志保留，新版本另封v2 manifest/verification。双轴待主控安排；后续源码修改必须新冻结，不能挪旧pass。

## 保持的门

B5/B6权限矩阵/44函数/四guards/7表17函数owner/otherACL/七SQL、Schema/202迁移、产品Auth、B9 fixture/case不改。source-bound协议不是实际Nest DI或guard执行、实际监听/HTTP/SDK/PG/TLS/ACL/锁/COMMIT/竞争/资金/物理清理验收。全实现也不授真实资源权限；#398、17–24/16–42–44依赖保持OPEN；当前阶段沿中央14/45。无main/Issue close/ready/部署生产；实际B9日期、seed和case按依赖后接。

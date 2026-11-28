# Task16 B8 首纵向 factory 源码与模拟（v2待增量复审）

基线 `c77ae5f156d58890c5ed9ab29e91239dd13b1aa3`，独立树 `/private/tmp/jg-382-task16-application-20261108`，分支`codex/enterprise-task16-application-20261108`。用户本轮“确认”覆盖此前待答fake Nest工厂/module loader模拟接缝，主控批准先交真实专用module/factory生命期源码，再做qualified loader/B7 live continuity桥。计划 `/private/tmp/jg-382-task16-B8-application-implementation-seam-20261108.md`。无commit/push/remote写，所有未来commit/finalpush HEAD须[skip ci]，fe70事故原历史保留。

## 首片范围和证据性质

原public run新增严格`{loadModules,createTestingModule}`模拟对象，零native SDK fallback；全部注入仍SIMULATED。实际factory执行override-before-compile、同原runtime provider、原security/projection/json/validation/listen函数接线、loopback临时端口address核验和首败清理。专用module实际导入Database/Auth/Audit/File/FundAccount/OperatingLedger/ProjectFunding/BusinessEntryTransaction模块及原registered controller/payment服务和APP_FILTER；不导入全站AppModule/main、ContractDocument/Approval worker模块。

原AuthModule六APP_GUARD源码保持。本片fake包纯编译实际Task16 module及AuthModule，Module decorator只记录metadata，其余自有无副作用fake导入；可以证metadata接线，不能证真实Nest DI、运行guard或HTTP。fake Nest公开builder/module/app/server对象观察实际factory，未实例化真实Nest/Prisma/SDK，没有真实HTTP/listener/SQL/PG/资源。测试中的seed/case仍明确原whole-stage fake，原fixture20另计，不冒真实付款。

nativeAdapters没有startApplication：仍缺App/seed/case三项，资源前拒绝。factory返回nativeProof=false/environmentPreparationImplemented=false，不构造可信native App proof。one-shot实际模块对象闭包、source/build/角色/CA/初始resource live验证仍下一必要桥；当前sourceBinding匹配只是结构协议检查，不以self-report当真实见证。

## 生命期与私有配置

factory只消费已有前置环境/私有storage合同，不创建或恢复非自己所有的环境。强制test、SMS/审批SMS false、local private storage、独立JWT/file secrets；禁止真实SMS/COS/引擎/宿主DB/端口等覆写。storage须在本artifacts内私有正规目录，跨await核目录identity/权限、env及context/provider方法恒等。native尚无环境准备者则拒，不能拿合法形状冒准备证明。测试只设置/恢复自己的合成env和临时目录。

可得module/app先登记、先捕获close，再核其它get/create/init/getHttpServer等方法descriptor；不执行未知方法getter。compile尝试但无返回handle=cleanup UNKNOWN。App接管同container后正常close不重复module hooks；App.close失败再尝试module fallback，但第一次unknown不能被fallback成功擦除。close等待实际promise返回且可重入，不Promise.race、不forcekill；不关闭B7 runtime。原run仍application→clients→resource finally，新增有限App outcome单次capture不透原cause/message/URL/凭据。

Node22.23内置net源码只读显示Server.prototype.listening为getter（未构造server）；factory在持有app后只读一次bool，address方法捕获后读取地址/端口各一次。此静态/模拟合同不是实际HTTP监听证据。

## RED/GREEN与本地结果

证据 `/private/tmp/jg-382-task16-application-evidence-20261108`：

- `factory-red.tap` 原publicrun对新factory对象cap拒绝；`factory-green.tap` 实际factory正控。早先`factory-green-first.tap`缺自有fake PrismaService token文件的fixture错误保留，不冒产品RED。
- compile无handle未知、private storage跨await权限改变、symbol额外boundary key、SDK样式私有code、Node式listening accessor分别有独立`*-red.tap`→`*-green.tap`，纵向补最小实现。
- 原已满足的partial module、app getter登记、Appclose失败module fallback、provider不匹配、非loopback、非法边界、env准备缺失/漂移、重复close和App有限getter状态回归分别单独观察，不虚构它们先有实现缺陷。
- `factory16.tap`新16；`full271.tap` **原255＋16＝271/271**，零fail/skip/cancel。`cli25.tap`原25/25，`fixture20.log`原20/20，API types/定向TS lint/三CJS lint与语法/JSON sourcepins/diff通过。所有权限矩阵/44函数/四guards/7表17函数owner/七SQL/产品Auth/Schema/迁移不变，无需重复B8a ACL或借旧PG结论。

## 审查状态：保持源码，未接受

首source-only冻结`source-only-freeze.json` SHA256 `bd7faafe7a9486eefd0c6d50ca582a667400097aa90511a44e11f69f5469aa4a`的四源码未变。Standards已报告新P2：driver接线在既有spread之后又多次读取外层injectedAdapters.startApplication，changing getter可能在receipt/try外抛私有错误。当前271未覆盖此反例，因此不能按本轮通过整合；保首冻结/前像/原日志，等完整两轴后唯一作者实际RED/GREEN集中修，新版本证据另封。新增boundary Proxy资格异常的safe受控处理同一项待核，不扩migrate/B7遗留边界。

源只读首审与本地结果是不同性质；本片完整候选manifest会明确known P2/open，不代替双轴验收。#398、依赖门及13/45保持，真实Nest/SDK/HTTP/PG/TLS/ACL/COMMIT/竞争/资金和物理清理未验。未合中央/main、未部署或生产。


## v2：集中修复同一边界 P2

两轴首审完整报告分别 `/private/tmp/jg-task16-B8-factory-standards-source-review-20261108.md`、`...-spec-source-review-20261108.md`，同一distinct P2，无其它发现。主控批准最窄保旧spread一次getter语义，不扩旧migrate/B7/其它入口。

- `outer-getter-red.tap` 实际公开run中外层enumerable getter首读给合法stage函数，次读抛合成私密异常，原driver会raw reject；`...green.tap` 改为仅复用已spread的adapters.startApplication单次捕获值后通过。原第一读行为保留，不声称处理所有遗留adapter getter。
- `inner-proxy-red.tap` 同公开run，strict对象资格的Proxy ownKeys抛合成私密异常原会raw reject；`...green.tap` 将新增资格置于受控catch后返回安全CAPABILITIES_INCOMPLETE，零stage/资源、零native fallback，不读取异常message/code/cause。
- strict检查只对原boundary执行一次Object.getOwnPropertyDescriptors，随后全部ownKeys含symbol和函数类型核验基于私有descriptor快照；不再二次枚举caller对象。validProxy原公开正控证明ownKeys一次、两descriptor各一次后固定函数正常调用。

`factory19-v2.tap`为原16＋上述两反例＋合法单次快照正控＝19；`full274-v2.tap`为原255＋19＝**274/274**，CLI25/fixture20/API type/定向TS及3CJS lint/语法/JSONpins/diff重新通过。首bd7 source-only freeze及首9715完整freeze、所有旧39证据、271结果和前像均保留不覆盖；v2四源码中仅driver/test两变，factory/module两同，另更新本receipt/PROGRESS。四份首候选受影响前像见bd7-before-images。

新`source-only-freeze-v2.json`明确当时full274在途；最终执行与六路径准确候选以`verification-v2.json`/`freeze-manifest-v2.json`为准，supersedes首9715，但未收到增量轴通过前不称审查通过或整合。native仍三缺、环境/qualified模块/live proof桥与所有真实门不变，未commit/push/真实SDK/HTTP/SQL/资源。

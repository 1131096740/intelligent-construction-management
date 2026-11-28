# 任务10 V4接续：正文25磅局部闭环（2026-11-07）

本次接续父工单#382，保留共享原根及所有既有工作树。中央集成仍为`95a256148cff9ca2b48b51e6b1b5c48dc5923aa8`；任务10在`/private/tmp/jg-enterprise-task10-contract-document-20261106`、HEAD `b846aa89aa0d31a395368306aa58b625833192e2`上的未提交候选实施。下述行为绑定磁盘源码清单及实际运行时，**不是HEAD本身的完整验收**，没有合入中央、提交、推送、关票、合main、执行PG/SQL/迁移、真实业务、部署或生产写入。

## 原检查点与本次最小修复

继承的V3 Word已写156处固定500twips/零段前后，但独立R8 PDF首行区间约26.05pt，原接受域`[24.975,25.025]`不变。继承的V4范围限定FO适配器已编译6个class，新源96a5033f、锁ce8771f0、运行清单8f11b708封存，但原执行会话在实际导出前中断。本次未把编译或私有FO证明当成实际PDF通过。

先适配既有公开导出测试的真实V4技术指纹，并让物理检查器仅接受精确旧95f和当前新锁两个固定描述符。原业务/Word/字形断言、预算、权限和金额不改。两轴复审0/0。首次实际公开导出失败：`/private/tmp/jg-382-resume-v4-first-native-20261107/receipt.json`，SHA256 `6ae7f308630505d6748d15e6b4512fb0f720f254d7bf41535b317a3b317d67ef`。Java拒绝定位标记，未生成可验收产物；源码3367及依赖12+2前后同，三项finally均true，原失败完整保留。

独立受限诊断重放仅复制该失败输入和scope，保持拒绝条件，记录有界结构名称：实际FO inline仅有无命名空间的`id`与XMLNS声明，子节点0。收据`/private/tmp/jg-382-resume-v4-sentinel-first-replay-20261107/receipt.json` SHA256 `acfd04a4995f9b401c9a102c61a4aacf2bb9c1da8112f551147b192a125f7697`。该重放是诊断，不是业务验收；未修改原输入或执行新业务HTTP。

正式修复只将Java中属性总数改为已有语义属性计数，忽略XMLNS。额外业务属性、任何子节点、错命名空间、标记归属、重复、遗漏和引用检查均保留。诊断代码未进入正式源。Java候选SHA256 `5f8b5fa2eca7e4e9251df0a12545b79700b01b0e447306a76fc3eb9e809794da`，两轴独审0/0。独立R2目录离线编译6个class，锁`6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128`，runtime `a48b4092bf77ad89a26c083162904ab9562f52a9171eb6c57dc12228e2c30aba`，inspection `12903034b24d53b502179a4574b7ffddf48c127edb2aafc5b02476e9c125f185`。旧Java81c、旧锁95f与旧运行时200e字节保留。

## 本次实际结果

- R2 API类型与定向lint各一次通过；静态收据`/private/tmp/jg-382-resume-v4-r2-first-static-20261107/receipt.json` SHA256 `75aa7937438e92011aa441de531170b681b4f1c2404efef5ec55c76f3585c881`。
- 原公开导出用例一次1/1，0skip/0retry；收据`/private/tmp/jg-382-resume-v4-r2-first-native-20261107/receipt.json` SHA256 `c514983cbe28598178253d2cde9268c6840dbd5ae98f03496bb53d67836ef7b8`。同R4/F及V4双partner/独立key、6.5000/6.5000/0、156处Word500/0/0、28字体角色、非目标保持及原实际字形门到达。worker5691ms/130000ms，JVM120s及100MB原预算不变，应用/processor/owned operation三项finally均true。
- 实际授权下载对位于`/private/tmp/jg-task10-material-body-spacing-export-DRKRX6`：Word SHA256 `693ae2fef70b0de9d101bfea5ea71536f3f1fb8e932272e31f4ac74f10d5d4bc`，PDF SHA256 `9d8841bccdf16c4c4304075893574f81c5da1ad412a86b33e434d754449c0780`。源码3367/依赖12+2及实际18个runtime文件、JDK456条/543访问项在运行前后独立相同。runtime before60ebeae5/after3e061125；这些是实际只读前后结果，不是补造兼容字段。
- 独立观察器只重绑新来源/实际收据；Word/PDF/numeric模块与测量算法、123/125字完整样本、容差和20s父监督逐字保留，两轴复审0/0。先prepare冻结期待`a6c65edc6e12b6856f65783c88c071badfa02fe086dc5b1114d120f3cc546c77`（pdfOpened=false），再observe。父prepare收据9d8f536f、observe收据`0810591fac0fea6bece2b9dcaa9d7dfbf7cfd16803c040334370981536914fd9`均实际退出0及后验完成。
- 同一PDF两完整样本共248字，每段5行；8个段内步长和1个真实相邻段界共9项区间均落在原接受域内。最小下界24.99902283035302pt、最大上界25.001008488359947pt。观测SHA256 `271e95bc7e658bcf82b91fadd0c66e6d74a12452eeffe960ac8c34b313fb8d69`，位于`/private/tmp/jg-382-resume-v4-r2-observer-20261107/first-observe-20261107/observations.json`。实际15页只是观测，不是改成新的预期页数。
- 既有公开运行时拒绝5项一次全过：主动字段3项、缺manifest、字体角色错位；收据`/private/tmp/jg-382-resume-task10-runtime-refusal-20261107/receipt.json` SHA256 `fda510857e2b86ff53446eded804b46a44c9538d626889543b8e5218cd70c0c9`。仅按其既有合成/旧描述符边界，不外推全部新V4负控。

## 相关回归

原V3相关24组首败9216fb保留，旧106/106不冒当前全过。当前回归只维护三个当前SAVE的精确V4期待，并将semantic queue的新锁期待与旧95f历史fixture分开。历史读取、旧key、旧snapshot、文件/preview及原业务断言不改，两轴复审0/0。四文件与此前产物仅测试差异，产品/转换器/producer/runtime字节不变，不据此冒物理链重新执行。

当前相关24组一次106/106通过、0失败/0skip，保持原300秒/独立`--bail`/0retry及不继承两套runtime manifest的cleanenv。实际收据`/private/tmp/jg-382-resume-task10-current24-first-20261107/receipt.json` SHA256 `d2421af8294b3a968bf94e1394573887b4af6f8c46f0a37aafcf9da46945abd0`，3367源/依赖12+2前后守卫完成。后续API类型16.337秒、全API lint10.593秒退出0，收据`/private/tmp/jg-382-resume-task10-current-static-20261107/receipt.json` SHA256 `d57b7e586396288e6b7ae5cd38ce951164ffea2922a75c0cdd80c8b128e980ea`。此为实际当前局部回归，不计全API、15浏览器、24资源用例或远端CI。

## 手机A4工具栏：原样本真实RED到一行CSS GREEN

既有手机冷生成用例原来以硬件PageUp避开工具栏遮挡。本次保留真实公开HTTP生成、R/F、6.5000只读、私有下载、实际blob/canvas、手写/新增条款及返回编辑等断言，仅更新R2技术指纹并在原“查看本页文字”操作后直接要求“适宽”按钮中心命中自身/子节点，移除PageUp成功路径；无force click、脚本滚动或CSS注入。两轴复审0/0，两个测试最终SHA为e2e `d87198b7df9847254bcffd0e6afa16f73d1e96473d4e241337607292cc7c389b`、HTTP wrapper `bff0d537c9a1a2f9d0ef251730fe5a15db81e18235599cd01fda0ecf2165b60b`。

执行前继承的3367清单遗漏本片e2e，曾在候选激活后的KeyError首停，未启动native/browser。该失败收据`/private/tmp/jg-382-resume-task10-mobile-activation-preflight-first-failure-20261107.json` SHA256 `e4b1629b59c13547eb29377aa0c53d18c438cc6f466949ea4373a58e47b3bb60`保留。随后原3367不改，按历史47份前端上下文明确补齐恰6份缺列paper e2e/config，联合3373份命名输入；独立两轴核清基线、未知override仍拒绝，未把旧3367冒称本次全部浏览器输入。

首次受限环境WebKit启动abort134，worker processCalls=0，属于工具启动失败；原`/private/tmp/jg-382-resume-task10-mobile-toolbar-red-run-20261107/receipt.json`及Fg4Ws3日志保留。之后正式本机权限审核允许同一范围执行，唯一变化是新日志目录，未改用例或预算。

真实RED：`/private/tmp/jg-382-resume-task10-mobile-toolbar-escalated-red-run-20261107/receipt.json` SHA256 `d54ace137381acea588f328a87723e047241d27e2ed45ac3a1b528a76a46b140`，产物aMVk4x。实际公开生成/native1及PDF显示等前置通过，Fit中心(100.765625,172.296875)在viewport内但命中false；sticky状态栏y111–251.296875、z5覆盖该点，pane从y175开始，不覆盖中心。用例在中心命中断言准确失败，不将前述工具错误当此RED。

正式产品修复仅在`ContractWorkbenchPage.vue`原`@container jg-page (max-width: 620px)`的`.status-bar`增加`position: static`，base4e193a3f、candidate `20fb5af2df3f7590b2c950223d87f5d436b40a79165d2f647d1af3da5f059af3`，其余文件和桌面规则不变；两轴复审0/0。

同一测试和原预算一次GREEN：`/private/tmp/jg-382-resume-task10-mobile-toolbar-escalated-green-run-20261107/receipt.json` SHA256 `4d2a19c7fdf0eed0b748e1126db0488124f25976969e80713b6789d36d600f82`，产物jkQ605。Fit坐标相同而centerHit=true，状态栏为static且y=-1138；正常点击适宽并返回编辑、16px以上输入、两表/只读6.5000、手写和新增条款、writes0/queue1/无横溢全部到达。真实worker一次、两个操作均fulfilled/actualSettled=true，来源3373/依赖12+2及运行时pins前后同，54829已核无监听。这是390px WebKit仿真，不是手机硬件或微信宿主验收。

受影响正文/表格回归两Jest一次2/2，并从原browser.log单独核desktop/mobile各2共4个Playwright场景通过；收据`/private/tmp/jg-382-resume-task10-body-table-browser2-20261107/receipt.json` SHA256 `afc191ce78a2200bef8b2f563f94097692330f1c4ebfcebdbb62642c5bfd6e67`，两产物pLTEBR/Cckaxz，54823已核无监听。不是15组全跑。

后续API类型、wrapper lint、Web类型/e2e类型、全Web lint、e2e lint及check:ui共7门均一次退出0，来源3373前后精确；收据`/private/tmp/jg-382-resume-task10-web-current-static-20261107/receipt.json` SHA256 `8072a80817b8584cd4c23c4e87e2f6d844f53ca9d0ea9def4a3aa75600de9014`。本段与前述106/API全lint分开，不合并为一次完整候选验收。

## 未完成门

本片只证明Word156处属性和PDF原两完整样本/相邻边界。私有FO证明仍标`instrumentationEffects=NOT_INDEPENDENTLY_PROVEN`，不作独立几何oracle。全文154个PDF linebox、67非目标物理布局、字体完整矩阵、日期/签署、原生Word分页、五类八模板和全浏览器/治理/终审仍未全部闭合；新旧scope/版本/runtime组合负控和Y2/Y3实际历史消费亦不由本片推定。任务10/#392保持OPEN、任务12等待10；任务16真实PG门、42/44门保持。没有关闭更多票据或声明完整规格、远端CI、部署或生产验收通过。

用户随后明确确认任务16新增离线准备/校验CLI测试边界，接口草案`/private/tmp/jg-382-task16-offline-packet-test-boundary-20261107.md`。实现将在独立新树进行，只有源码包约束与篡改拒绝，不执行SQL/资源/PG，不据此关闭#398或解除17/24。原task16/integration和task10树各自保留，不混入本片UI源码。

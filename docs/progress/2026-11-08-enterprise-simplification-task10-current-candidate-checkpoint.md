# Task10 最新0d隔离候选：整票P2修复执行桥（2026-11-08）

当前唯一作者候选 `/private/tmp/jg-382-task10-final-integration-20261108`，分支 `codex/enterprise-task10-final-integration-20261108`，HEAD `0d563bb565b7229d3488c2ffcc5e379dae953a8e` 加未提交Task10完整范围。下方8f7部分保留为历史，不能当当前候选结果。整票SOURCE ONLY基包 e494、根绑定第12单行 d26、修复源码包6f6a均保原件；最新精确原件位于 `/private/tmp/jg-task10-final-integration-preparation-20261108/whole-P2-fix`。

两整票轴发现的P2已实际公开RED后修复，独立源码增量复审已关闭两项且新增0；最终执行/文档桥另审：

- 普通原段缺删除按钮：修正新测试has定位后r2实际缺按钮RED（23.286s、18前置断言）。UI只对服务端允许的顶层editable源段提供结构删除，沿既有deletedPositionIds，不清空w:t；已有新增条款anchor禁删并显示中文原因，表格/受控/签章段不扩权。新旧删除最终外层2/2、0skip，61.759s，每例桌面/手机；新例保另一个手改/新增/排序/权威金额，SAVE→reload→同R/F公有queue/真实worker→授权Word/PDF，段数恰减1且目标原句/手改标记消失。generated ID按producer blocks.length精确重新编号，其它block字段全等；首次错误期待保原件，非产品RED。
- formatter nested typed passthrough使unknown可隐式coerce：原公有生成器实际wrong-ready RED，最小逐call实参/局部initializer来源证明，不靠类型注解；另三unused member/unary/binary真实RED保留。无泛Error.message推断，旧不安全试验已移除并保存；纸面查询/生成/下载catch仅使用各自已有中文fallback，不读unknown原因、不改全局API/formatter、权限或请求数。真实unknown formatter现在保守blocked；真实scalar imported formatter正控保持。62/364定向（302未选）不是全量通过；最终以完整364为准。

最终执行索引 `whole-P2-fix/execution-final.json`：完整364/364、0skip、173.820s/原360s；原CI369/369、0skip、11.347s；fresh API/Web build、API/Web/E2E type、API/Web src lint、全部Task10 E2E lint、check:ui均过。两real-API fixture原reachable仅+1的库存失败362/364保留，按新固定fallback使error-message先不可达、真实API又引入它与transport两模块，准确改+2后13定向过、最终364全过，不是产品RED或放宽producer。canonical7write+7check实际14/14，真实write仅web-page-actions及capability JSON/MD三产物；require-ready检查均零写。GUI/type/build早于这三生成物及两测试计数行，逐gate after→最终执行的仅四路径差异在索引中明列，TS/Vue/API/运行依赖与实际测试文件不变，未冒全源码SHA相等。

源码/私有依赖/runtime各门before/after均同；共享58,799项后验全同，作者原树181与中央52候选路径逐SHA再核全同。Schema/client/engine匹配与首次generate失败、纯HTTP受污染env失败、先前root/selector/index/fixture库存失败全部单列历史，见 `whole-P2-fix/execution-history.json` 和原prep收据。原候选纯HTTP336、必要native前6批及LO坏/好分批实际收据保留，不将旧26/15或分片0相加冒当前全票通过。

本次当前源码HOLD，2P2源码两轴已闭合；已按批准执行原暂停资源批次9–15，详下表，最终全票执行/文档桥待独立复核。compact三片段与材料运输业务口径仍待用户决定，任务12consumer仍partial，不恢复退役410，不关闭#392；没有commit/push/mainmerge、DB/SQL、部署或生产操作。以下旧8f7事实为历史原件说明。

### 最终剩余资源与闭包分类（同日后继）

`/private/tmp/jg-task10-final-integration-preparation-20261108/resources/batch-09-15/receipt.json`：7组选中/7组执行/7组PASS，182.984s串行，原预算、flags、端口、工具和唯一Vite worker allowlist不变。逐项前后全181路径与76843冻结SHA相等，private/runtime守卫全同；每项不是旧26native或15browser库存全跑。

| 组 | 当前冻结源实际结果 | 秒 | 未选明确记录 |
| --- | --- | ---: | --- |
| 9 paper cold | 1/1 | 27.919 | 0 |
| 10 paper dirty | 1/1 | 31.155 | 0 |
| 11 paper mobile | 1/1 | 28.002 | 0 |
| 12 paper preview | 1/1 | 26.769 | 0 |
| 13 body editor desktop/mobile | 外层1/1 | 15.762 | 0 |
| 14 different-source new | 外层1/1 | 16.974 | 旧外层1未选 |
| 15 same-source old control | 外层1/1 | 31.015 | 新外层1未选 |

完整分类矩阵 `resources/final-actual-closure-matrix.json` SHA `ba95cf639502b667593cd7c12b8638c2cea36d30a00dc330a4a9679e8b901220`，明确1–8为先前候选actual加逐路径closure bridge，不声称当前整SHA重跑；相关34套336也是先前actual加API不变闭包桥。它们到本轮最终执行的API产品源码差异0，工作区包/Schema/运行依赖同；新增差异仅本票Web三组件、治理器/其测试、独立browser fixture/根路径helper及生成物/MD。该helper仅LO default-preview resource引用，7/8已在正确新root上各自独立实际坏/好通过；pureHTTP34不消费它或新增删除resource。默认样张O的既有真实浏览器模块PrivatePdfActions/LayoutPdfPreview/LayoutTemplateEditorPage源码仍同；不拿旧O冒本轮workbench纸面场景。此前first-root失败和纯HTTP环境污染失败保留，不能写15组一次全绿。

批次runner的历史 `sourceOnlyReview: whole-scope-source-only-r2` 文本标签未被用作实际源码资格；准确资格来自每项before/after全181对76843的固定SHA。运行结束后共享58,799项第二次后验全同（`shared-dependencies-resourceFinal.json`），原作者181/中央52再核未变。无新增代码/生成物变化，仅此说明及PROGRESS追加最终事实；未将app.close或没有错误日志当文件物理清理为零，原清理/物理不可观测边界保留。

当前仍待最终全票执行/两MD独立桥；compact三源/材料运输业务决策与任务12consumer仍OPEN，不提交推送、不开关Issue、不mainmerge/DB/SQL/部署或生产操作。



---

# 任务10 最新中央候选的本地验收检查点（2026-11-08）

本地候选 `/private/tmp/jg-382-task10-current-integration-20261107`，分支 `codex/enterprise-task10-current-integration-20261107`，merge HEAD `8f7aa1e5e7eca9c297b0f3501a41b25b366f9b56`：b846任务10已提交分支合准确中央ea663；当前实现及后续test-only维护仍是未提交WIP。原作者树/128项WIP/旧收据完整保留，127条非ledger最初逐路径带入且模式/字节核同，中央99非ledger变更未覆盖。没有合main、部署、SQL/PG/资源、真实通知/业务或生产操作。中央后继db273源码尚未同步本树；不把本地merge SHA冒全部WIP实现SHA。

## 实际本地通过

- 私有依赖链接层，匹配本树Schema的隔离Prisma 5.22 client、独立Shared dist、私有Vite/cache；共享58,799项前后守卫相同。原始schema raw SHA73cbea3e…；未写共享node_modules、全局app或安装工具。
- 新候选相关25套117/117（含日期11兼容），15个原浏览器wrapper实际15/15并有20个Playwright桌面/手机场景；准确收据分别 `/private/tmp/jg-task10-current-related25-r2-20261107/receipt.json`、`/private/tmp/jg-task10-current-browser15-first-20261107/receipt.json`。各自前后源/私有依赖/runtime守卫同，不冒全API/全Web或全部业务验收。
- 原26个native注册用例**每项都有实际PASS，合计30个Jest测试，但分批取得，不是26一次全绿**。逐项receipt SHA/来源完整表 `/private/tmp/jg-task10-current-integration-preparation-20261107/native26-each-case-actual-pass-20261108.json`；包括既有历史V1/V2、缺runtime/真实错font角色拒绝、严格同V4日期开关、4纸面真实UI及默认样张O。
- O原d977 native身份失配单独保留。当前官方签名bundle1d91的独立新profile `/private/tmp/jg-task10-current-lo-profile-20261108-lxyjmksl`，manifest `fb7cfd80e32dd30c9deb285913bfbe738f997eac152c554d29b38245f45939d0`；旧9t manifest553edd未修改、字体exact两原bytes、wrapper81c7未换。来源证明658f477b…；不声明新旧native等价。O完整PASS是 `/private/tmp/jg-task10-current-O-newprofile-linked-worker-20261108/receipt.json`，15.242秒，6597项App/Python/sitepackages/fonts/sidecar/worker前后同。
- 18–21纸面四项的新独立批全部通过：`/private/tmp/jg-task10-current-native-matrix-r11-paper-20261108/matrix-receipt.json`，97.402秒，原预算/物理/UI断言保持。
- 当前v2边距对照公开双格式通过：源仍恰四margin差，两实际Word所有ZIP成员raw SHA相同、两全局左右80/原行108不变；旧S0“输出无left/right”期待不再冒当前v2。独立18.574秒收据 `/private/tmp/jg-task10-current-margin-v2-first-20261108/receipt.json`。
- 旧无布局轴fixture现在明确安排两历史owner：所有业务先公开SAVE，再完整投影校准F；只有fixture准备窗口按exact owner/bill ID读取既存3个compat cents，单价仅Decimal标准字符串作F preimage；public未知/null、金额literal/行不变，不把unknown推0，不测试生产迁移。owner历史R/F递增、无profile重复GET守恒，prepare后封store，原旧tuple/实际Java/全Word+PDF/历史成功下载不变均过。最后PASS `/private/tmp/jg-task10-current-legacy-noaxis-first-20261108-r4/receipt.json`，18.057秒。校准是fixture一致性，非独立F算法oracle。
- API类型/full src lint、Web类型/e2e类型/full src lint、Task10全部20e2e定向lint、check:ui通过；最后fixture后的fresh API build19.202秒，Shared/Web fresh build亦通过。全e2e lint的4个无关既有错误在2文件，已逐SHA证明与中央ea663同，未改这些文件。

## 仍失败或待验

canonical七write已实际运行，原首次freshness拒绝、后私有query-engine未显式定位失败均保留。显式只读绑定原e0f407缓存engine后，metadata可正常初始化（脚本原生SKIP_DATABASE_CONNECT/禁worker机制，未connect/SQL）。新唯一GET document-body已与中央route set差核，routeusage原四个期待各+1后ready；classification/consumer override hashes原样。两个纸面queue/file-ticket消费先漏登记，已登记真实按钮/handler，但通用治理器仍不能证明readonly组合grant及catch/finally的因果/能力支配，**七check尚未全部通过**，原blocked输出保留，不手改ready/放宽parser。

原CI编排实际367/369、0skip：一个cleanPATH缺系统sha256sum；一个POL23继承当前治理blocked。只读已定位/sbin原真实二进制并封pin，待治理真ready后以原入口新跑；不改CI、测试计数或PG库存。

默认样张/旧LO fallback的B坏字体runtime失败关闭仍OPEN：新docx4j正文有exact font-role拒绝，但不能覆盖LO。当前1d91坏profile原公开反例尚未重跑；trusted O正控不是B已修。详细分路源码定位 `/private/tmp/jg-task10-current-integration-preparation-20261107/B-current-readonly-assessment-20261108.md`。

全文154正文仍仅94多行25pt可观察、60单行linebox未知；67非目标局部frame/full-font/五类八源矩阵及整票正式双轴未闭合。独立date物理r4局部通过仅证明日期文字/几何，不冒全文。普通Word app/法务人工签认不另作强制安装门。

尚待可携测试bootstrap替换当前临时sidecar硬编码、最新中央同步、最终统一源码/维护补丁审查。#392保持OPEN、12等待10，任务16/42/44硬门保留。

## 首败/维护来源

所有运行轮次及前像在 `/private/tmp/jg-task10-current-integration-preparation-20261107` 聚合：root/pin/config、margin-current-v2、legacy-noaxis、linked-worker、governance-task10各目录。原失败有：缺fixture输入、旧root与旧pin、沙箱Chromium MachPort、Vite私有deps worker403、历史fixture未知compat/单价表示/不支持select、治理blocked、367编排；均不是被修复的产品RED。naive ??0中间草稿未执行，保外部原件。四日期产品仍88d6/8346/2648/d68a原freeze，未因维护修改。

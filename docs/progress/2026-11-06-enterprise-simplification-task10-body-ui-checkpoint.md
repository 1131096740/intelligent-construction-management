# 任务10正文UI局部执行检查点

本记录是完整正文读取、普通条款编辑与原聚合保存的第一纵片，不是完整任务10或UI验收完成。实际源与输出均在自有隔离树/证据根，原失败保留。

原首命令在Chromium MachPort bootstrap前被沙箱权限拒绝，没有达到页面。沿原用例正式取得浏览器启动权限后，真实登录和工作台入场成功，原10秒expect在“完整合同正文”heading缺失门失败（desktop11.8秒，mobile按原maxfail1未运行）；实际DOM是“合同正文画布/尚未生成合同正文”。公共served Workbench/Canvas JavaScript与disk源分别记录SHA，Nest创建前4个直接后端入口源也记录SHA，不以私有Vue状态或假页面作RED。

最小实现通过domain API读取完整正文，版本/修订/layout归属和请求世代防止迟到响应替换当前正文；按后台flow呈现原段落与表格/合并单元，关键资料只读。普通条款变更只传入既有extraDraftData/markDirty，保存继续调用原saveNow与唯一aggregate PUT；没有新增前端存储业务权威或第二后端写路径。适宽字体最小16px，A4/新增删除重排/重建确认等后续UI能力仍未完成。

首GREEN尝试严格沿原90秒case/10秒expect/0retry、每次fresh Vite执行。完整heading、甲方和原普通条款值已通过，但预注册的waitForResponse在90秒先超时，不能据堆栈称fill或保存点击已完成。只读trace发现正文GET200、0 PUT，末DOM“当前页面只读”、保存正文disabled、条款仍原值；公开workbench返回lease.state=held_by_me。种子createTask09Draft取得真实租约保存后没有释放，正式客户端对没有本页grant token的held_by_me正确视为held_elsewhere，不允许继承别页编辑权。

修复仅在合成入口用种子的原token调用现有公开DELETE edit-lease，要求released=true、随后公开workbench的lease=available，再让真实浏览器独立取得grant。原case增加toBeEditable及保存按钮enabled前置（仍原10秒expect），保留原保存、公共重读、刷新、适宽与字体断言和两项目/预算；没有放宽产品租约规则。修后原desktop2.7秒case已实过own grant POST201、含正文aggregate PUT200、公共GET重读、刷新保留和viewport适宽；首失败在原min16字号门，实际textarea computed14px，mobile按maxfail1未跑，整片不计通过。详细只读因果证据为独立本地body-ui-first-green-lease-diagnostic.json，原浏览器输出6alAfB（真实heading RED）、qqxSsC（租约前置阻断）均保留。


字号首因来自正式TDesign `.t-textarea` wrapper的默认font14，原inner `font:inherit`只继承wrapper14，而没有继续继承源段落>=16。只补本组件局部wrapper font:inherit一条规则，不改全局token、库或测试阈值；同原两项目重验待做。gG1LRF保存了字体真实RED/公开grant、PUT和GET证据，独立诊断body-ui-font-inheritance-diagnostic.json不含授权header或token。


局部一条wrapper继承CSS后，原两项目一次2/2 GREEN：desktop2.6秒/mobile2.1秒、Playwright8.5秒、wrapper13.839秒。原public保存/重读/刷新断言保持，viewport分别1366/1366、390/390，textarea计算字号18.6667/18.666666px；两个PNG已离线查看。刷新验证的是持久值与可读性，原租约策略可能使新页面只读，未冒称刷新后继续编辑。当前UI包类型/lint/check:ui与其余UI/文书门仍待，未整票收口；精确WIP源桥、双receipt和图/served/启动源指纹位于body-ui-first-slice-two-project-green-checkpoint.json。


随后表格分支已按 check:ui 真实失败从手写 table 改为官方 TDesign t-table，规则无 ignore/allowlist，局部类型及 lint 曾通过；这不是实际表格DOM通过。原8列/2表素材两端复验仍为desktop通过、mobile失败：最初内容宽-6px，去冗余padding并采用Word grid/15自然宽后9px；边框去除后11px仍小于16px，且scrollHeight136大于clientHeight103。旧COL零宽比例观测不能算通过，已改强制非零的8个无合并表头TD测量，仍保原1px误差阈值。所有原几何失败与只读库源诊断保留。

当前已按确认的公开交互改为源段落p呈现表格文字，表外官方Dialog列出本表全部server.editable段落，修改立即进入原bodyplan/dirty/aggregate链；“完成编辑”仅关闭视图，不称服务器已保存。关键字段保持只读，版本/layout/source变化清除选择，未增加前端业务权威。原可读性断言改为强制真实p测量，另补Dialog编辑→公共PUT→GET重读→刷新持久值断言，阈值及原两项目预算不变。此新源尚未运行静态或真实浏览器门，不能算已通过；详细来源及预测见本地body-table-semantic-dialog-predictions.json。


语义表格源码当前三窄门 check:ui、vue-tsc、Editor/Flow/tablee2e ESLint 均exit0；ESLint保留80条格式warning/0error，无ignore或规则放宽。实际官方Dialog不自带role=dialog，入场前仅将测试定位改为公开.t-dialog+精确header文字，未改产品或断言；此定位变更在ESLint之后，生产组件与类型/规则门源码无变。原两项目一次2/2 GREEN（desktop12.8秒/mobile12.8秒，Playwright27.4秒，wrapper34.528秒）。8个真实p均16px，手机内容宽18/68/56/28/34/79/17/130px，正TD比例原1px门通过，viewport1366=1366、390=390。首表普通段落和签署表12个可编选项的非首末“地址”段落，均经原aggregate PUT200、公共GET、刷新保存到正文revision5；打开Dialog期间真实自动PUT与后续正文GET后，原可见、值和焦点断言均通过。同源回执的watcher更正是源逻辑修正，未冒称另有浏览器RED。

新证据根为jg-task10-body-table-browser-CGerxN，准确hash/源码桥/receipt/artifacts在body-table-semantic-two-project-green-checkpoint.json。两个PNG已打开，但desktop全页1366×13618缩略缺少可读table细节、mobile fullPage实际1170×2532只呈当前viewport，不能据此声称完整表格视觉独审已过；当前是实际DOM/几何及编辑保存链通过。原负宽/COL0未证明/9px/11px失败均保留。13列/45行/vMerge/A4及完整10门仍未验；自有54823端口已无监听。


净税首单HTTP验证已尝试一次：case1.194秒/wrapper7.057秒，首失败为合成请求漏原aggregate必填parties数组，公开PUT400 DRAFT_VALIDATION_FAILED（主体数组校验），尚未到workbench保存事实或正文，不计真正render RED。原日志net-body-first-public-red.log SHA456f08964a192e1cfffb9e70a0c09e6e40840218658398c3ce498cde696af44d保留；修正仅测试请求补与既有saveBody相同甲乙公开快照，后端/renderer/queue保护未改，新caseSHA528867675d405efba9dce61517346765fe930bf4cbb2fb10a7fed1a0b8a8ce81尚未重跑。

2026-11-07新增普通条款纵片：先在原正式44be正文、普通第4条手写后缀、两表及6.5000前置成立后，桌面原10秒期望真实失败于“新增条款”按钮不存在，手机依maxfail1未跑；原失败日志SHA `ac7261f2be4c979a7bf89189db6f7ac14340be3b7bea88b23bd5ca15b3116dea` 保留。随后仅Editor新增官方TDesign入口与Dialog：候选位置来自当前server editable普通顶层段落，关键字段及表格权限不增；Dialog缓冲经“加入正文”追加现有plan.additions并emit到原草稿权威，明确提示以保存回执为准，不将加入冒称已保存。

该片check:ui、vue-tsc、仅Editor与该e2e lint均退出0（0.313/9.074/0.827秒，格式warning保留）；API源与wrapper未改，类型准确桥接此前14.886秒门、不称再次执行。原90秒case/10秒expect/0retry/maxfail1、fresh Nest/Vite及公开释放seed lease的双端用例2/2通过（桌面7.4秒、手机7.6秒，总wrapper23.891秒）。实际选普通4锚点、输入加入、PUT200、GET唯一“补充条款1”及紧邻flow、原手写全文不变、刷新保留、6.5000仍只读、全页1366/390均不横溢。当前源end hash均吻合，服务已退出。

证据目录nAFZAt，日志SHA `b5dc6b4f69981496d6e04461af97c06624bb8ab337b9f70d652d893e47071755`，17产物的独立checkpoint SHA `a7bd309d71992451cbea00c95e98bdff0611f9e06a13a3c79f760407741228e7`。此为新增普通顶层条款保存链局部通过，不包含删除、重排、重新生成、A4、在途输入与来源切换的独立动态反例，或新增条款双格式实际文件验收；任务10仍未完成。

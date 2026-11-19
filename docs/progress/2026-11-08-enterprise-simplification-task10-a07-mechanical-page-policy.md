# Task10 A07 原机械 PAGE 服务器呈现轴：本地验证待双轴复审

2026-11-08；候选 `/private/tmp/jg-382-task10-current-integration-20261107`，`8f7aa1e5e7eca9c297b0f3501a41b25b366f9b56` + 原有WIP。前像为已审不同源UI `25eb7cad…22568` 的完整库存，原作者树/中央未改。本片4产品+1原已分类native测试文件，另本MD/PROGRESS；不是整票、中央同步、Git或发布完成。

## 实际缺陷、有限版本闭包

原9139机械母版 `9139d5eb2905cb659e90c00f053c8b17c40d265bca5c660da5d2d8e1028d4c32`，原footer1 SHA `fcdffa218f593eeeb844929a7ad82b8d58c7356c4aa0a4bae1f133698b2a7097`。首次在未改产品源码下真实公有queue→封pending→worker成功→授权Word/PDF，原footer bytes/45行/strict物理先过，但13页页脚visibleText皆空、raster ink皆0；随后新PAGE可见断言实际RED（28.042s）。这是worker成功后的实际显示缺陷，非检查器或worker失败。

新增独立服务器呈现版本 `reviewed-original-mechanical-page-number-v1`：

- 仅真实9139母版的numeric-v2 SAVE校验后授予 `documentRenderProfile.pageNumberVersion`；保持现客户端只读metadata回传/拒改/剥离后从真实source重授合同，不新增HTTP权限规则或表单字段。
- persisted未知/混轴版本拒绝，缺轴历史GET不补；保存F继续由现有draftData/profile链计算。queue的bodyDocument及renderValues双partner冻结同值，key仅有轴才在原tuple尾追加；旧缺轴tuple不加null、不重算旧key。
- worker在任何模板读取/生成上传前核双partner、唯一版本、9139 source、现docx4j/money语义及不相容轴；既有95f runtime lock不变。中文安全错误固定进入原允许集合，不泄原始异常。
- 仅有轴且源/映射后footer仍精确匹配时，原双Choice/Fallback同一PAGE容器变为单普通PAGE域。保原5个field runs、字体、style14的9pt、原section/正文及其他ZIP成员；用原9866twip可用宽与2880twip容器、显式zero inset推得左缩进3493twip。Word/PDF共用同一最终DOCX，不换引擎/字体/边距、不改原母版。

名义page-left225.65pt是新普通段政策值，不宣原Word autoFit浮框bbox已测或等价。独立实物观测origin.x225.642410pt/字号8.999698pt，不为此新增调整字段或放宽原容差。

## 独立旧 pending 和同 owner 真实升级

首RED前worker尚未运行时，公有documents返回queued/no inspection，独立旧key、R/F、owner、mapping、源及文件身份已固定：

- 黄金目录 `/private/tmp/jg-task10-A07-PAGE-preproduct-pending-20261108`，manifest SHA `0e965422835029a39e11bfde0922aedf75f55f4229f4c3d6ae075e89d36f0bac`。
- 必需输入 `pre-PAGE-actual-public-pending.json` SHA `3c04a9bda0bf505e418018f0dd2e3adac2c4d2a92b2de1c690eec53d466250a6` 和 `original-master.docx` SHA9139；独立literal key `bef12297ce2e2274dabd2843a7d4c570e647d076358882c6101dcdcb310e5952`。
- 测试只通过显式 `TASK10_PAGE_LEGACY_REFERENCE_DIRECTORY` 读取，缺失即失败；测试内固定JSON/master SHA及literal key，不从当前tuple动态生成旧期待。最终native config把完整黄金目录额外列入runtime前后锁；freeze另附这两个逐byte同输入副本及重放配置，不能默认环境天然存在/private/tmp捕获。

在自有合成持久适配器准备窗口明确恢复该历史owner/source/file关系，未预塞generated job、未通过新SAVE再删profile冒历史。新公共queue实际命中独立literal；GET不升级、body/key/snapshot无轴、实际旧worker/rawfooter授权pair。旧公开owner税revision的null来自原mock absent increment的非有限值；此次只明确用可持久finite0，单列taxFactRevision及同源taxFacts.revision null→0，金额、税事实内容、IDs、R/F/key不改、不做F校准。原NaN试验保留但不计有效历史验收。party/bill的原mock create默认status/draftRevision在这两个无此字段的实体上显式抵消；不改全局adapter，不宽滤业务字段。原时间与新恢复updatedAt亦明确区分。

封store后全消费沿真实公有HTTP/worker。旧pair先生成下载，再同owner获取真实lease、无业务变化SAVE；保手改plan/45行与业务值，服务器授予PAGE，新R/F及新尾轴key另断言。SAVE之后/新worker之前，旧stale key/snapshot/refs与现授权下载bytes同。用户明确生成新预览后，原processor854–864的正常superseded/null refs和清理动作照常发生，该段未被本片改动；不能把不暗升历史成功解释为豁免原替代合同。

r5同owner完整PASS 28.699s，目录 `.../jg-task10-A07-PAGE-legacy-upgrade-7iScFS`。两Word成员集合相同，唯一payload变化footer1，其余每成员未压缩bytes逐hash同。原raw footer bytes断言保留在此缺轴历史正控，新fresh-SAVE场景改为明确新版结构断言，不偷删历史语义。

既有合成文件引用adapter拒绝未建模orphan查询，清理日志保留；未认证superseded后存储零孤儿/零残留。app/processor关闭不冒文件清理完成。无真实SQL/PG恢复或完整生产审计生命周期证明。

## 同源运行与独立物理

所有最终源码运行均由原guarded-run串/并行适当执行，预算未放宽；final runtime/native资源串行。

| 最终入口 | 实际结果 | 秒数 |
|---|---|---:|
| 原mechanical资源文件全case：旧asset控制、新9139、独立legacy/sameowner、18公开边界 | 21/21，0skip | 64.857 |
| 原body入口非目标synthetic/专业/generic/劳务控制 | 4/4，0skip | 18.775 |
| 受影响backend，含processor/service/aggregate、原日期compat与机械公有位置 | 288/288，10suite，0skip | 22.925 |
| API `tsc --noEmit` | PASS | 18.764 |
| 五源码定向eslint | PASS | 1.226 |
| 原default Jest list分类 | 607项，本native资源文件不在其中 | 0.675 |

收据 `/private/tmp/jg-task10-A07-PAGE-final-{native,body-controls,backend,typecheck,lint,classification}-20261108/receipt.json`。每次source/private88/runtime before=after；整组共享依赖58,799前后守恒。未重跑旧26/15或359/369当新增，通过数不冒原完整矩阵。

18边界含persisted unknown/null/mixed且client omit不能降级、client伪版本按原metadata规则拒绝/omit重授；14真实worker缺partner、unknown/null、错源/engine/money、混typo/date/tax，均公有failed/无refs、精确安全文案、0模板读取/0生成上传，WB原事实不变。首负控6过/12在safeerror文案处止，随后补固定允许集合1行，再18完整过，最终21全入口又绑定该最新processor。

独立只读观察，不与作者test断言混作一份证据：

- `/private/tmp/jg-task10-A07-PAGE-new-policy-independent-physical-20261108.md/json`：r3新pair13页1…13、17数字实际非.notdef/非空轮廓、真实paint+紧bbox raster；9pt/style/3493左缩进和原styles/fontTable/section保。
- `/private/tmp/jg-task10-A07-PAGE-same-owner-independent-physical-20261108.md/json`，JSON SHA `a5772db237c49dc24ed7f22c36d3d124d3253b7956c2f7664d46c2f93fa86e60`：r5旧新同13页，非页脚10686个真实paint字符逐序/font/origin/bbox/size/相邻origin-x advance全差0，无clock/字段过滤；45行落页同、手改/金额保，新PAGE紧区有墨迹。旧footer原bytes及SAVE前后旧下载bytes同。

独立物理pair来自各自已完成PASS原件。之后产品只加processor固定安全文案1行；renderer/aggregate/service同hash，最终21与body4/288均重绑最新源。最终sameowner新pair另在 `.../jg-task10-A07-PAGE-legacy-upgrade-CkmwxN`，fresh9139在 `.../jg-task10-A07-original-mechanical-OLZDOh`；不冒独立观察者重读最终新产物。原Word浮框实际bbox、所有绘图对象全像素、全字体Unicode覆盖均未宣称已证。

## 原失败、范围与下一步

首次物理RED及所有失败原件完整留存。新policy r1类型0tests，r2新反斜杠assert期待错误；history首null→0投影/NaN试验、mock默认字段、无业务SAVE误传可选null、末尾原superseded refs期待，均技术fixture/观察契约维护，不冒PAGE产品RED。没有改阈值、source、金额或旧失败文件换GREEN。

本scope待独立Standards/Spec复审；此前UI25eb、劳务a144、generic8c315、机械c54、B6603、治理161713各scope双轴0保持。#392/任务12仍OPEN：compact/材料运输业务选择、最新中央0d同步、整票受影响验证/终审/Git尚未闭。本次未提交/推送/合并、未实际PG/SQL/资源、未部署或生产操作。

本地重放输入包：最终freeze目录的 `native-input/` 附上述两个固定SHA文件，`replay-native-config.not-executed.json` 将唯一参考env及extraRuntimeDirectories改为该副本目录，保原全部预算/命令。需先核候选五源码与manifest及既有95f/工具/依赖锁仍匹配，再以原 `guarded-run.py` 显式执行该config；输出指定全新 `PAGE-replay-not-executed` 目录，不能覆盖原收据。此config只是可重放交付物，未执行，不冒CI/跨机器/自动下载运行时已验证；缺输入包时测试明确失败，不回退从当前tuple生成旧key。

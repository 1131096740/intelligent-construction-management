# 任务10 A07 专业首源：公有编辑同步与双格式

本地候选仍8f7aa1e5+WIP。本首纵向待独立双轴，非八源全绿或#392完成。B6603及治理原scope两轴0已闭，旧证据各保精确源码边界。

## 准确源和公有路径

原probe `scripts/probes/task08-documents/samples/professional-subcontract-v1.docx`，7094B、SHA256 `6ae812af212498638036a24fbc7ce793497a82894a76b28b087b51a1cef366f4`。公有numeric-v2 POST /contracts使用真实professional_subcontract，不伪材料类型；只给测试创建helper新增显式类型参数、默认仍material_purchase。临时catalog用原confirmedBodyLayout、type professional_subcontract、唯一loop genericItems；后者由原通用清单alias映射统一main。无正式seed/母版采用或Schema/权限变化。

实际source-positions、专业select保存→p34普通手改→甲方p13/53同步、三行单价100→120/总额600→720，手改保留→保存重读R_F恒等→同saved修订queue/真实95f docx4j→两个原授权ticket/download已全部到达。普通条款、两方、专业标题、尾行、金额和签章Word/实际PDF均核。额外header-contract原part保留；最终Word两header均草稿、active引用header1，PDF无未展开文档水印，未删源内容凑通过。

该source不命中四个角色字体版本，实际95f52434/200e2a3b/schema2 inspector，body-bill-loop-v2/contract-money-v1按现有契约，不冒V4/LO。首case不强塞45行，长表保留原13列材料/10列机械后继门。

## 真实 RED 和最小兼容修复

`/private/tmp/jg-task10-A07-professional-first-observation-20261108` 首10.501s，编辑/同步/公有排队过，worker failed；owned conversion-uZLsW8记录 docx4j CustomXmlDataStoragePart→FontTablePart ClassCast。原6ae和实际rendered input缺 /word/fontTable.xml 的 ContentType override，却有唯一合法internal fontTable关系和w:fonts。`.../jg-task10-A07-professional-public-red-20261108` 再次5.542s保公有完整job failed与真实输入。不是helper硬编码类型、mapper或金额期待错误。

只对actual master SHA6ae，在生成的Word/PDF共享最终输入上补合法且缺失的fontTable OPC声明。原有有界ZIP/XML验证；唯一internal canonical rel、合法root、Types root、缺失声明才补；冲突/重复/外部/错root拒绝，不覆写冲突。非目标返回同一Buffer，不动字体/样式/正文内容、原master文件、engine/Java/runtime lock。

依据本次明确取舍，这是包语法元数据合法化而非可选可见排版政策：不增加SAVE/GET/profile/双partner/key轴。旧GET不修包、旧success文件不改；仅正常生成/重试该已知源时补元数据。inspection仅applied时附固定normalizationId/masterSHA/pre-renderedDocxSHA/postDocxSHA/changedParts=[CT]派生见证，不冒原冻结输入或原字节未变。

## onlyCT 的证据边界

1. 代码内强制检查：同一次实际helper的pre/post两个ZIP成员名完全相同，每个非CT未压缩payload逐字节equals；异常失败关闭。此为实际生产路径内检查，不是独立公有下载过pre原件。
2. 公有可复核：下载post DOCX hash=inspection postSHA；CT原声明序列恰追加1个canonical fontTable Override；fontTable/styles payload与原master字节同，原sourceSHA仍6ae。所有公开正文/业务literal/实际PDF检查独立使用真实下载。
3. 外部inverse仅还原CT+原date重建的rawZIP SHA不等producer before witness，明确UNPROVEN原件保留，不继续猜ZIP metadata，不作失败门或独立before原件证据。

没有给helper增加私有测试hook/伪SHA入口。目标原master不可变且public编辑只影响正文，结构异常的target postrender字节在现有公有API无法单独注入；未假称做过冲突分支公有恶意反例。严格结构拒绝交独立source review。

## 最终同源检查

- native：10.051s exit0；`/private/tmp/jg-task10-A07-professional-final-native-20261108/receipt.json`。专业+原非目标synthetic两it，2/2，0skip。
- legacy-bad：5.655s exit0；`/private/tmp/jg-task10-A07-professional-final-legacy-bad-20261108/receipt.json`。所选legacy1通过、同文件其余3未选；不冒全4。
- legacy-good：5.807s exit0；`/private/tmp/jg-task10-A07-professional-final-legacy-good-20261108/receipt.json`。所选legacy1通过、同文件其余3未选；不冒全4。
- backend：6.114s exit0；`/private/tmp/jg-task10-A07-professional-final-backend-20261108/receipt.json`。114/114，0skip。
- typecheck：17.568s exit0；`/private/tmp/jg-task10-A07-professional-final-typecheck-20261108/receipt.json`。
- lint：1.702s exit0；`/private/tmp/jg-task10-A07-professional-final-lint-20261108/receipt.json`。

四源码在6次执行12个before/after逐hash同；每次私有依赖88与实际runtime3407/6597/6602项守恒；共享58,799前后同。文档写入后仅PROGRESS与本MD桥，未用旧7.195或7.086结果替最终源码。

GREEN1是XML documentElement nullable TS前置，0tests；第一次provenance公有worker/双格式到达，但CT缺失Extension实际null与测试空串期待不符，精确改null；均保原失败，不冒产品RED。首metadata修复7.195s和provenance7.086s原件保，只最终同源native10.051s供交付。原严格物理阈值/引擎/预算未放宽。

最终专业实物 Ujo4fx，physical-Q22Ron GREEN；原非目标VSI9ZH/physical-BpAzMp与其原严格检查通过；受影响legacy LO bad/good复跑均过，helper40c8未改。见外部 `artifact-proof.json` 与 `execution-bridge.json`。

完整freeze `/private/tmp/jg-task10-A07-professional-freeze-20261108/manifest.json`。仅本准确专业源的首纵向，不代表正式采用；其余七源/A07两长表及唯一跨不同source覆盖UI、最新中央0d同步、整票双轴/Git仍待，#392 OPEN、12等待10。无提交推送/main、SQL/PG/资源、部署或生产操作。

# 任务10 A07 原劳务faae：新增手改与同步后的修订末端

承接generic8c315与机械c54各scope双轴0；同一候选8f7aa1e5+WIP，仅追加既有显式native资源入口body-export中的一个测试。没有产品/helper/CT名单/Schema/权限/必填/母版/引擎/字体改动；未提交推送、SQL/PG/资源、部署或生产操作。不重跑旧09/05当新增，不冒正式模板采用或整票完成。

## 新旧证据分开

原source `scripts/probes/task08-documents/samples/labor-subcontract-real-v1.docx` SHA `faae3cebc8e377764df12e999bcfddb1beefe6958cb728175f33f8e6fa4a187f`，不是asset d828。旧09/AQD3eU保原source/R_F/hash，只证明三行初存、全角逗号与实际双格式，原saveBody(documentBody=undefined)没有manual edit或第二次关键sync。旧coverage“09手改”口径已由独立notes纠正，未改旧测试/产物。

本次真实POST labor_subcontract，不先材料创建再改label；main沿唯一声明loop alias到laborItems。原九core：p5/26/31合同名、p12编号、p13/27甲方、p14/28乙方及header1水印。另在p56对原计价方式/发票类型显式canonical绑定，复用已审contract.pricingNatureLabel/field.invoiceType authority；共11bindings，公有source-positions与独立draft PATCH/GET回读master/sourceFileId/R2/fingerprint/bindings/optional=false规则。不是全局raw alias或新表单。

p58原“具体工作内容、计量单位、数量和单价详见本合同劳务清单。”的公有ID/editable均核实，保原句追加“原劳务人工补充约定保留。”。三行qty1/2/3、price100、0税，含税/净额600.0000；保存manualPlan，再以服务器完整plan改甲方和price120，含税/净额720.0000、税0、尾003=360.0000。plan全等、人工句不丢、甲方两处同步/旧甲方消失、saved version重读恒等；最终测试明确assert内容R增加、F变化。未知发票按既有“—”、计价性质固定单价由真实持久值消费，不伪造发票/金额。

排队准确sourceRevision→真实worker→同generationId/contentR_F/source95f列表→原FileService双票据授权下载。Word/PDF均核手改、甲方两锚、001/003/720/360/大写、原劳务分包工程名称、原发包人盖章标签及旧三全角逗号上下文。原三表保留，劳务清单展开4行7列，不套generic两表/签章页标签，不强加45行。styles/fontTable与两CT原已合法，实际packageMetadataNormalization无，CT/styles/fontTable/footer未压缩bytes等于原源；未预修metadata或套d828 tax/typography/date轴。

## 实际执行与边界

- 首链 `labor-first-observation`10.689s直接GREEN：新case1/1、旧3未选，准确新增覆盖，无产品RED。第一整文件4/4=19.272s/type18.521/lint1.048原件保留。
- 封包前发现新clone继承了generic的“raw first”产物scope误标；只修新labor文件名为pricing-mapping-readback与准确canonical说明，同时补显式R/F变化断言。没有改业务向量/产品/旧封件，不能借旧19.272s冒新test hash。
- 最终 `labor-final2-native`19.553s，body文件4/4、0skip（新劳务+旧generic/6ae/synthetic控制）；type17.780s/lint1.051s exit0。纯test-only按主控裁定不再重复旧210/213后端组；没有改默认Jest/资源分类或26/15库存。
- 最终各before/after测试源码同最终、全source/private88/runtime一致；后只本MD与PROGRESS变。共享58,799前后unchanged。测试before精确等8c315 after，原3case前缀字节保持；三产品源码逐8c315 hash相同，旧09/05源码保持。

最终pair `/private/tmp/jg-task10-A07-professional-preparation-20261108/tmp/jg-task10-A07-labor-OuSUGo`，strict物理 `/private/tmp/jg-task10-docx4j-runtime-20261106-r2/artifacts/physical-aH4cT1`实际GREEN。新case saved-public-facts/worker-public-result/verified-receipt保存前后真实R/F与新产物sha，不套旧09。实际页数按新inspection记录，不将旧16页设为硬门；95f/200e/schema2与money-v1/table-v2实际来源，不冒新字体profile/全几何/PAGE可见。

补充generic证据澄清：真正raw未映射首读属于4muV4w；D8XTGd同名pricing-first-observation实际为9bindings后已填值，沿Spec evidence-note，不重计RED、不改已封原件。新labor最终说明已正确区分canonical读取。

## 仍待完成

本test-only scope待双轴。跨不同source覆盖UI、机械PAGE独立服务器可见政策轴/旧queue兼容、compact/材料运输用户选择、中央同步/整票检查及Git仍OPEN。finally仅记录真实processor shutdown/app.close，不冒原私有文件全清；未新增Word/法务强门。

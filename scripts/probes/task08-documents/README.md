# 任务08：真实DOCX编辑/转换技术探针（#390）

当前结论：**未通过，任务08尚未完成，不能固定此转换方案供正式实现。** 本目录是隔离、可丢弃的技术验证，不接入业务API、数据库、对象存储或正式模板目录。完整可复核输入及测量摘要见 [sources.json](sources.json)、[receipt.json](receipt.json)。原始DOCX/PDF、逐页文字/字体/版式数据、渲染图和失败日志保留在 `/private/tmp/jg-task08-document-receipts-20261105`，不把截图或本说明当作实际产物。

## 样张和确认依据

准确起点 `f352d187b720a2e8231874775616c24e91eb3bd8`。按D04只复制保留工作区的八份模板作为本票样张，逐份字节/哈希与主线差异见sources；没有整体承接旧业务代码、覆盖主线七模板或改动原件。类型为劳务2、材料2、机械2、专业分包1、其他1。专业分包是旧根新增资产，主线不存在。

字体依据为保留工作区 `docs/design/建工智管_合同Word版式标准.md` 的精确副本 [confirmed-layout-standard.md](samples/confirmed-layout-standard.md)，并核对10月30日字体修正记录。该历史文件中的旧税务/发票选项不导入本轮业务规则；当前193条规格优先。

本机现有上传字体：方正小标宋简体、仿宋_GB2312、楷体_GB2312；数字英文Times New Roman。读取既有字体的哈希、name表和OS/2 fsType，未安装、修改或提交字库。PDF实际包含FZXBSJW--GB1-0、FangSong_GB2312、KaiTi_GB2312（适用处）、TimesNewRomanPSMT及SIL-Hei-Med-Jian。**全部字库嵌入不等于字体规范全部通过**：三个简版资产没有正式封面标题字体，仍是源资产差异；黑体PDF名称也不冒充已证明逐字库来源链。

## 已确认公开接缝与红绿

候选CLI以真实DOCX、权威字段及普通条款编辑为输入，输出真实DOCX/PDF；测试读取导出文件，不调用私有分类器或渲染替身。`candidate.py`采用保留OOXML的方案：

1. `render`克隆真实模板、展开既有清单循环，把字段位置映射为有锁定标记的内容控件；其余包部件、段落/表格/图片/字体声明保留。
2. `revise`只更新对应字段锚点；普通条款可在唯一原段落后插入并修改。再次同步关键资料后手改仍在。普通编辑遇锚点段落拒绝，不能用本入口直接改权威字段。仅为段落级文字编辑探针，不是完整富文本Web编辑器、后端权限或修订冲突实现。
3. `regenerate`/换模板必须显式确认放弃手改，输出新文件，并另存原DOCX的 `.previous.docx` 恢复点；不覆盖原路径。测试中未确认拒绝，确认后原件字节保留。
4. `export-pdf`对**同一已修订DOCX**调用本机LibreOffice独立临时profile导出PDF/A-2b。没有另外拼接纯文本PDF。`printProfile=a4-portrait`仅显式设置派生样张A4页式，来源是确认标准；不偷偷修改源文件，也不称版式完全未变。

红绿记录：无候选CLI时公开导出测试失败；实现首条渲染/同步后通过（首轮夹具遗漏页眉水印而失败，另存日志）；普通条款修改与后续同步先红后绿；换模板恢复点先红后绿。可用的OOXML行为测试：

```sh
TASK08_PY=/private/tmp/jg-task08-document-tools311-20261105/bin/python
"$TASK08_PY" scripts/probes/task08-documents/test_candidate.py CandidateCLI.test_authoritative_sync_preserves_inserted_clause_and_original_format
```

真实劳务标点回归仍红，**不能跳过后称全套通过**：

```sh
"$TASK08_PY" scripts/probes/task08-documents/test_candidate.py CandidateCLI.test_explicit_print_profile_keeps_fullwidth_comma_in_actual_pdf
```

该测试需要本机应用转换权限。沙箱内LibreOffice退出-6的失败另保留；获批本机转换才取得真实文件。此命令会打开新的独立转换profile，不是当前允许反复重跑的许可。当前父控已暂停再次转换，后续操作以其指令为准。

## 真实产物与未通过项

原样式生成8份基线+8份修订PDF；显式A4派生再生成8+8份；另生成3份A09反例。最终A4派生页数前后分别为：机械真实20/20、机械简版2/2、其他2/2、劳务真实15/15、劳务简版1/1、材料真实20/20、材料简版2/2、专业分包2/2。页数相等只是本组结果，不是禁止合理重排或原生Word分页证明。

- 机械真实10列、材料真实13列各45行，逐个行标记001–045完整；均跨PDF第2–3页，续页重复表头。独立读取PDF字库字节、逐页尺寸和文字坐标，最终八份修订版均A4、字库已嵌入、没有页面范围外文字。补充目视核对材料第2页和机械第3页：表格边框及续表行连续；机械源样张黄色提示仍在，不冒充正式签认。
- **真实劳务丢字**：源文“公司审批后方可生效，…”（PDF第4页）、“所有工序、工艺，…”（第5页）、“向甲方汇报，48…”（第7页）中的3个U+FF0C，在普通文字提取和PDF绘制texttrace均不存在；字体为FangSong_GB2312。第4页真实渲染已目视确认。另“材料浪费、遗失”的1个U+3001只在普通提取缺失，texttrace存在，不能混称真实丢字。两种差异分别保留，未删原字符或放宽容差。
- `overflowPunct=0` 和 `characterSpacingControl=doNotCompress` 两个明确假设分别实测无效，失败保留，均已从候选移除，不继续猜参数。
- 原机械/劳务简版未定义纸张，原样导出Letter612×792；只有显式A4派生修正页式。三个简版原资产还缺少正式封面/标题字形，不能因计入八模板就当全字体规范通过。
- A09历史反例：框架空总价、包干无数量、不含税且税率/发票待补3个真实DOCX/PDF。未知税率未被转成0，但源模板会留下“合同金额（含税）：人民币元”，且不含税说明与固定含税标题冲突；这是需要显式语义锚点/模板映射修正的**真实失败**，不能仅补一段说明后称口径一致。技术探针不改正式模板或新业务规则。此处是保留的修复前失败；下节记本票派生语义锚点的实测修复，不删除旧收据。

`run_comparison.py --artifacts <新的不存在目录>`可重建八模板对比；完整测量失败时返回非零。`run_pricing_cases.py --baseline-request <对比生成的generic render.json> --artifacts <新目录>`重建反例。字符多重集合会被重复页眉等掩盖，因此只作有界测量，不作为完整逐字等价证明。PDF字节因生成时间/子集等可变化；收据的哈希绑定本次文件，不承诺重建字节恒等。

Microsoft Word未安装；已有Pages15.4。一次AppleScript在open处40秒超时(-1712)，未生成PDF；脚本没有finally，原结果不推断转换能力或关闭状态。父控后来以原生UI打开同f938源副本，观察到缺字体警告，正确本地路径/文件名的导出按钮始终不可用，无PDF；随后取消并关闭唯一自有文稿，UI返回noWindowsAvailable。该诊断为NOT_ACCEPTED，不推断按钮失效原因；未安装字体、登录、改设置或触碰未知文稿。原生Word分页、移动端编辑及合同部/法务逐页签认仍未验证。

## 后续有界差分与A09语义锚点修复

保留相同劳务派生源 `f9388ca82159d79d06097c3f4c261cc5e66f9e0cf174fb6151dbcdbc8c5f0043` 的字节、LibreOffice版本、字体及页式，只执行一次 `SelectPdfVersion=2`→`0` 差分。转换前创建独占尝试目录，不允许重复；标准PDF仍真实缺3个U+FF0C，所有字体嵌入、页面外文字0，源前后哈希相同。PDF/A导出/子集独有原因假设被否，停止此参数方向；实际PDF与日志在外部 `lo-standard17-once/`。

A09修复在**本票派生文档**明确映射关键语义金额范围，不改原模板：`pricing`参数包含mode、basis、total、uppercase、taxRate、invoiceKind。NULL总价在框架模式显示“部分金额待确定（非最终总价）”；已知总价原样显示调用方精确小数字串及大写。含税/不含税标签随同一个权威上下文同步，NULL税率/发票显示待补充，不推算另一口径。此探针不复制02正式金额/大写算法：`1.5340`及调用方给出的“人民币壹元伍角叁分肆厘”按字面保留。

语义金额范围以八份样张各自明确的原文映射，必须唯一匹配；缺映射或旧文稿没有语义锚点时拒绝。同步关键资料后普通新增条款保留；语义依赖字段不能另用raw fields单独改税率/金额造成两套口径。该拒绝先红后绿。三项公开DOCX流程通过（含八模板逐份映射、后续同步保留手改、恢复点），styles.xml仍与原样张字节相同。

三个修复后的实际generic DOCX/PDF位于 `pricing-cases-02-semantic/`；框架NULL、包干无数量、不含税未知税率的预期文字均在实际PDF存在，独立检查缺字符0、嵌入true、A4true、页面外文字0。八份**DOCX**映射通过不等于八份修改后PDF版式全部验收；劳务转换红、简版封面/字体差异仍阻止任务08完成。

公开回归命令（不包含仍红的劳务转换项）：

```sh
"$TASK08_PY" scripts/probes/task08-documents/test_candidate.py CandidateCLI.test_eight_real_templates_have_explicit_semantic_total_mapping CandidateCLI.test_pricing_semantic_anchors_keep_unknowns_and_sync_basis_without_losing_clause CandidateCLI.test_authoritative_sync_preserves_inserted_clause_and_original_format
```

## 独立引擎诊断：字体前置未成立，转换未执行

主控复核官方源及许可后，仅在 `/private/tmp/jg-task08-docx4j-tools-20261105` 准备Temurin17.0.17+10及docx4j17.3.5 core/extras两jar；下载235,989,010字节，总560,593,557字节，未全局安装。JDK核官方SHA256，两jar核官方发布SHA1并另记本地SHA256；没有伪称不存在的上游jar SHA256或未验签的签名已验证。实际许可/NOTICE已逐项留证并由主控读取接受为本地诊断，不构成产品依赖采纳。

第二阶段编译最小adapter，Java17 SecurityManager以`policy==`覆盖默认策略：只准任务目录、原派生DOCX及显式本机字体读取/输出；不授SocketPermission。实际loopback Socket、DNS及目录外文件权限三项拒绝均在加载文稿前验证，XML/URI限制file/jar与文件白名单相交，原DOCX外部关系/DTD/ENTITY均0。

仅一次adapter启动：精确仿宋注册成功，随后原FZXBSJW_1.TTF没有得到精确PhysicalFont，按规则停止；未替换字库、没有进入CONVERSION_CALL_BEGIN、转换调用0次、没有PDF，源前后f938相同。该结果只证明当前字体前置失败，不判docx4j/FOP渲染能力失败。

随后只读因果核实：当前原路径FZXBSJW_1.TTF不存在；当前同家族“方正小标宋简体.ttf”为单TTF、fsType8、相同家族/PS名称，却是另一SHA256（da8112c1…），与早期已记录2322dbfb…字节不同，不将它静默替换。jar字节码在FontInfoFinder返回null后直接返回，alias参数尚未参与字体构建，否定alias查找假设；当前缺失路径是可解释该失败的前置问题，不足以宣布解析器不支持。字体目录变化原因未知，未修改、安装或跨目录寻找旧字体。源码、policy、字节码及失败日志见外部目录与receipt指纹，不随机改旗标或字体再试。

### 新字体版本与首次真实PDF的安全检查点

主控随后明确选择当前已存在的同家族da8112c1…标题字库为**新版本候选**，不冒充历史2322dbfb…同一文件；仿宋正文fef7cf99…仍逐字节相同。单次字体发现成功，离线/越界三拒绝仍成立。复核还纠正了初版adapter的STHeiti SC映射：Heiti SC不是模板的精确黑体；v3改用主控指定的既有SimHei/黑体.ttf（aa4560dd…），仅换该文件映射和读取许可，单次发现成功。旧adapter和失败均保留，未安装、恢复或修改字体。

获批首次真正toFO时，全部10份显式字体映射成功，但FOP默认cwd读取被策略拒绝，留下0字节PDF及241,590字节中间FO。主控核因后仅追加一次cwd修正：Java子进程工作目录设为本票新输出目录，适配器、policy、源、字体与转换flags不变，不增加读取权限。源f938与10字体前后哈希均相同，实际三个离线/越界拒绝仍成立。

该次实际PDF完成：16页A4，原3个逗号上下文均存在（第4/5/7页），文字和texttrace缺失计数均0；没有.notdef/替换字形候选，字库全部嵌入，实际字体为FZXBSJW、FangSong、SimHei、Times变体，没有Heiti SC。封面、正文、两个签署表和清单页已独立渲染核对。

**仍为NOT_ACCEPTED_LAYOUT**：第16页仅水印/页脚、没有正文，相比LO15页多一个无正文末页；第15页三个清单数据行各重复表头，尚需只读区分源循环和转换原因。恢复逗号不是完整版式通过；未开展新引擎八模板/45行批量转换，也未证明原生Word分页。安全交接证据在 `tracer-v4-cwd-correction/` 的receipt、literal-font-checks、final-layout-assessment及实际PDF/PNG；原0字节失败保留，停止追加转换。

### 两个布局反例的有因果源修复

只读对照原模板、f938派生DOCX及v4 FO：原模板用两个独立loop段包住整张清单表，候选按条目克隆整个区间，三条数据遂生成三张同头表；FO只是保留了这个结构。原模板与派生文末均另有6个纯空/空格段，FO将其展开成6个25pt空block，末节`force-page-count=no-force`，没有发现强制奇偶空页。这两个反例不能据此归为引擎能力不支持。

按主控确认，只在派生源做最小修复：明确的“开始标记段+一张表+结束标记段”必须仅有一个占位数据行，只复制此行，静态表头保留一次并标注可续页；多表、额外归属不明块或多占位行拒绝，不造通用模板引擎。现有A4 profile只裁剪文末连续惰性空段；字段、图形、分页、书签或节属性会停止裁剪，文中空段及签署区域不动。

两项结构先红后绿，并补歧义拒绝红绿，共6项公开DOCX流程通过；3行/45行都是单表头加对应数据行，两张签署表与原件相同，末尾书签保留。初次空段保护将段落制表位属性误判为正文元素而只裁3段的失败亦保留，随后正确区分属性后代与实际内容，未删分页或书签求绿。

唯一获批的新源转换使用f56203e2…派生DOCX：比f938仅合并重复表头并裁掉6末空段；3条数据行、两张签署表及最终节属性的C14N相同，手改条款保留。引擎、10字库、policy和flags均与v4相同，离线拒绝与输入前后哈希检查成立。实际PDF为15页，无空末页；末页仅1头+3行，已真实渲染核对。全字符/trace缺失0、.notdef候选0，3个原逗号存在，精确字库嵌入、A4及页面坐标检查通过。第11/14页签署正文固定区域像素与v4完全相同（页脚总页数在区域外）。

此结论仅为单样张测量通过，尚未固定整套方案或完成任务08；新引擎八模板/45行批量及简版封面/字体标准仍待验证。`derived-layout-fix/`与`tracer-v5-derived-layout-fix/`保存新源、生成器快照、因果清单、PDF和独立检查；旧f938、v4反例及全部原8样张字节保留。本轮没有追加第二次转换。

## 依赖、许可及后续约束

Python3.11.15；隔离工具环境按 [requirements.txt](requirements.txt) 固定版本，没有改pnpm依赖/锁文件。首次误用Python3.9安装PyMuPDF1.26.7失败，改用已存在Python3.11另建独立环境后成功，未升级包。工具说明：

| 组件 | 本票用途 | 许可/限制依据 |
| --- | --- | --- |
| lxml6.0.2 | 保留OOXML结构的候选 | [BSD及依赖许可](https://github.com/lxml/lxml/blob/master/LICENSES.txt)，未修改库 |
| fonttools4.60.1 | 只读字体元数据 | [MIT](https://pypi.org/pypi/fonttools/4.60.1/json) |
| LibreOffice26.2.4.2 | 既有本机离线转换进程 | [MPL2.0及组件许可](https://www.libreoffice.org/licenses/)，[PDF参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)；本次实际丢字，未选为合格正式方案 |
| PyMuPDF1.26.7 | 本机独立解析、字库读取、逐页渲染诊断 | [AGPL/商业双轨](https://pymupdf.readthedocs.io/en/latest/about.html)；未购买商业许可，未作为产品运行依赖或分发二进制，不能把此探针直接移入闭源服务 |
| 上传/系统字体与Pages | 只使用既有本机安装 | 未收集可再分发EULA；fsType只是技术标志，不是法律授权。未复制字体到仓库、未安装新应用、未购买或登录 |

下一步须解决可靠转换、简版源资产差异并扩展语义锚点后的实际版式验收，再在准确新SHA复核全部实际产物，才能固定正式实现方案。任务09/10/11不能复用本票失败结果当完成。此处没有运行任务01 driver、PG/Docker/SQL/迁移、部署、生产读写、真实业务或外发文档。

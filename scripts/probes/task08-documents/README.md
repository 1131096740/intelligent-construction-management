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
- A09：框架空总价、包干无数量、不含税且税率/发票待补3个真实DOCX/PDF。未知税率未被转成0，但源模板会留下“合同金额（含税）：人民币元”，且不含税说明与固定含税标题冲突；这是需要显式语义锚点/模板映射修正的**真实失败**，不能仅补一段说明后称口径一致。技术探针不改正式模板或新业务规则。

`run_comparison.py --artifacts <新的不存在目录>`可重建八模板对比；完整测量失败时返回非零。`run_pricing_cases.py --baseline-request <对比生成的generic render.json> --artifacts <新目录>`重建反例。字符多重集合会被重复页眉等掩盖，因此只作有界测量，不作为完整逐字等价证明。PDF字节因生成时间/子集等可变化；收据的哈希绑定本次文件，不承诺重建字节恒等。

Microsoft Word未安装；已有Pages15.4，本地字典有导出PDF接口。仅一次AppleScript在open处40秒超时(-1712)，未生成PDF，不能推断转换能力；未取得document引用，脚本没有finally，故不声称关闭应用/文稿。父控另用原生UI仅观察到模板选择窗口，将独立记录UI tracer；本目录不再调用AppleScript。原生Word打开/分页、移动端编辑及合同部/法务逐页签认均未验证。

## 依赖、许可及后续约束

Python3.11.15；隔离工具环境按 [requirements.txt](requirements.txt) 固定版本，没有改pnpm依赖/锁文件。首次误用Python3.9安装PyMuPDF1.26.7失败，改用已存在Python3.11另建独立环境后成功，未升级包。工具说明：

| 组件 | 本票用途 | 许可/限制依据 |
| --- | --- | --- |
| lxml6.0.2 | 保留OOXML结构的候选 | [BSD及依赖许可](https://github.com/lxml/lxml/blob/master/LICENSES.txt)，未修改库 |
| fonttools4.60.1 | 只读字体元数据 | [MIT](https://pypi.org/pypi/fonttools/4.60.1/json) |
| LibreOffice26.2.4.2 | 既有本机离线转换进程 | [MPL2.0及组件许可](https://www.libreoffice.org/licenses/)，[PDF参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)；本次实际丢字，未选为合格正式方案 |
| PyMuPDF1.26.7 | 本机独立解析、字库读取、逐页渲染诊断 | [AGPL/商业双轨](https://pymupdf.readthedocs.io/en/latest/about.html)；未购买商业许可，未作为产品运行依赖或分发二进制，不能把此探针直接移入闭源服务 |
| 上传/系统字体与Pages | 只使用既有本机安装 | 未收集可再分发EULA；fsType只是技术标志，不是法律授权。未复制字体到仓库、未安装新应用、未购买或登录 |

下一步须解决可靠转换和A09语义锚点，再在准确新SHA复核全部实际产物，才能固定正式实现方案。任务09/10/11不能复用本票失败结果当完成。此处没有运行任务01 driver、PG/Docker/SQL/迁移、部署、生产读写、真实业务或外发文档。

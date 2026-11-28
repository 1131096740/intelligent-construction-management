# 任务11实际PDF物理检查（仅测试工具）

本工具服务已确认的公开HTTP/worker/真实browser+合成持久层/私有文件边界。产品converter、processor、extractor均不改，字体文件/Python/本机路径不进入产品依赖或Git。不能用普通文字提取、ActualText、仅`%PDF`或嵌字体字节非空冒称字形正确。

## 依赖与显式入场

- Python版本在外部运行manifest的`tools.python`精确声明并与实际解释器比对；本轮见证3.11.15。
- PyMuPDF1.26.7、fonttools4.60.1已有精确pin：[`scripts/probes/task08-documents/requirements.txt`](../../../scripts/probes/task08-documents/requirements.txt)。本轮复用已批准隔离工具环境，不安装新包、不修改产品package/lock。缺包、版本不符、缺manifest/字体均明确失败，不自动换解释器或skip。
- 调用者显式设置`TEMPLATE_PDF_INSPECTOR_PYTHON`和`TEMPLATE_PDF_RUNTIME_MANIFEST`；解释器/字体实际路径由外部manifest和运行环境给出，源码不硬编码用户目录。
- manifest字体SHA必须属于正式Task08锁定的既有字体版本；按实际源run声明匹配真实font name表，不猜别名。此处只复验11短样张，不能据此声称正式10母版/复杂分页标准完成。

## 外部manifest合同

`schemaVersion:1`；`workspace`为全新任务自有临时目录，manifest位于其根。`artifactDirectory`为该目录的输出子目录；`fonts`为`[{path,sha256}]`，均是已授权现有字库的同hash临时副本，不能提交字库。`tools`包含精确`python/pymupdf/fonttools`版本。`converter.wrapper/native`分别记录已有runner/native的绝对路径与SHA；`fontconfig`记录私有XML的path/SHA，`fontDirectory/cacheDirectory`均在workspace内。

fontconfig XML仅含唯一字体副本目录和唯一自有cache，不include系统配置，不加替代/alias规则。两个已见证regular字库为仿宋GB2312（fef7cf991b458cabd184b73378918d9d15429010e1d6c804f08d394395c3c3b4）及TimesNewRoman（f3b4ffff71c2a0c7227d37497683b2498fb2d0a4e8beae26f022e3ccfcaabfa3）；来源和文件元数据同正式Task08 lock。没有下载、全局安装、全局字体cache或用户profile变更授权。

## 已执行的RED/GREEN运行方式

从本票工作树运行。下列变量值须来自本轮外部见证manifest，不得指向其它未知资源；它们是命令级子进程环境，不能修改全局配置。正常完整链不加FC_DEBUG。外部见证路径/工具hash和完整可复制命令由候选收据提供。

```sh
# 明确的默认runtime反例；不要设置FONTCONFIG_FILE。预期物理断言真实失败。
TEMPLATE_PDF_RUNTIME_MODE=default-control TEMPLATE_PDF_RUNTIME_MANIFEST="$manifest" TEMPLATE_PDF_INSPECTOR_PYTHON="$python" pnpm --filter @jiangkong/api exec jest --runInBand template-mapping.http.spec.ts -t 'saves only the director'

# 同一public case在显式同hash字体profile下通过；无隐式默认fallback。
FONTCONFIG_FILE="$config" TEMPLATE_PDF_RUNTIME_MODE=font-profile TEMPLATE_PDF_RUNTIME_MANIFEST="$manifest" TEMPLATE_PDF_INSPECTOR_PYTHON="$python" pnpm --filter @jiangkong/api exec jest --runInBand template-mapping.http.spec.ts template-selection.http.spec.ts template-selection-legacy.http.spec.ts template-browser.http.spec.ts template-selection-browser.http.spec.ts
```

真实Chromium在本机需formal执行权限（MachPort）；不能绕为request拦截或浏览器业务假数据。5套26项为受影响范围，不重复全30套或原369。原默认字体PDF的实际失败、诊断最小/原文及新受控完整链分开保存，不修改旧文件。

## 判据及证据

共享TS入口保存实际source/PDF，Python独立读取draw trace及已嵌font程序：中文非零且足够不同的物理glyph、无空轮廓、声明中英文字体家族匹配、实际嵌入及A4。语义文字只供应覆盖目标，原公开用例继续独立断言正文/签章全称、普通条款、range与历史哈希。每次保留JSON、实际DOCX/PDF、栅格PNG、版本/manifest/source/PDF哈希；截图仅补充，不代替物理检查。

## A/B界限与硬门

A已证为本地runtime没有正确发现/使用现有字体；同输入、同native/module/参数，仅私有FONTCONFIG_FILE使2/2及44/44字形恢复。B仍是现有产品限制：`contract-document.processor.ts`离线修订、版式预览、正式文书三路均`convertDocxToPdf(buffer)`未传声明字体；坏字体runtime仍可能产生PDF并标success。本补丁不将B称为failclosed已修，也不泛改全局renderer。

任务10正式文书实现及44发布前必须使用拟发布的实际转换runtime/字体清单，验证声明字体发现、实际字形/轮廓、中文/数字、分页与实际文件；不能继承此本机profile或技术绿测试替代。部署/安装/生产转换器配置仍须单独授权。旧无效PDF不被本补丁自动修复，合法历史字节/权限规则不变。

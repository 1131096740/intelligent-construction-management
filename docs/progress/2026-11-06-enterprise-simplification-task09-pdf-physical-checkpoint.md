# 任务09受控运行字体与实际PDF检查点

在任务09原干净 `7353139895a9032a2c9481ef8ad5f0cb9c64e9d4` 树核回原封包后，仅合正式 `2863bc93b496161566956b7ab79309b269d50b86` 的两份Markdown；未吸收11候选/WIP。产品 converter、processor、docx-renderer 与735字节相同。本次仅改09测试、独立物理检查器及说明，无产品转换器修复、全局字体安装、原DOCX编辑。

主控确认唯一完整链命令：

```sh
FONTCONFIG_FILE=/private/tmp/jg-task09-pdf-profile-20261106-r1/fonts.conf TASK09_PDF_FONT_DIR=/private/tmp/jg-task09-pdf-profile-20261106-r1/fonts TEMPLATE_PDF_INSPECTOR_PYTHON=/private/tmp/jg-task08-document-tools311-20261105/bin/python pnpm --filter @jiangkong/api exec jest --runInBand --runTestsByPath src/contract-template/task09-new-selection-browser.http.spec.ts
```

命令有显式private resolved-cwd断言，FONTCONFIG_FILE仅命令子树继承；无全局export、SAL flags、alias、第二引擎或converter参数/120秒超时更改。私有config只含自有fonts/cache，rescan0。仿宋_GB2312与TNR源/copy哈希均和任务08锁一致，前后相同，未把字体二进制放入Git。profile与工具指纹见 `/private/tmp/jg-task09-pdf-profile-20261106-r1/profile-receipt.json`，该配置及依赖闭包是运行前置，不因源码packet通过而自动部署。

## 真实RED与唯一GREEN

独立检查器 `services/api/src/contract-template/task09-pdf-physical-inspector.py` 先检查旧同源DOCX/PDF实物，退出1/RED而非工具异常：旧生成DOCX73个CJK/40种字；坏PDF的trace Unicode标签折叠成“合”，实际字形glyph0/空轮廓、页面中文空白。这里不是页面显示重复“合”。旧文件、失败receipt和栅格均保留在 `old-82-glyph0-red/`；不拿其73/40或任务11原44计数作为新样本期望。

唯一原public完整链通过：Jest1/1、其中桌面1366×768和touch390×844两项2/2，26.108s；原90秒/retries0不变，无force、任意sleep、HTTP拦截或转换重试。真实新建→双方资料→当前类型→手选已发布Word→lease保存/公开GET→queue/实际worker→受权私有DOCX/PDF下载后，独立读取每份对应新DOCX、PDF：各75/75 CJK，40/40种实际字形非零、非空、不折叠。每个CJK outline按各自unitsPerEm转em、分解复合glyph后与锁定源font同Unicode轮廓一致；子集命名不参与判断。实际嵌入family仿宋/TNR分别匹配其CJK/ASCII角色，不以嵌字体名称或ActualText提取代替物理证明。

- desktop: DOCX `6e0845d64f0e44c5024705a991afc8a335274c1b610957f22a82db66dcb3682e`；PDF `e6c461eb77d8384c060ea2b425cde894b83af0235be2e4467d03f6addb24616c`；物理receipt `/var/folders/w1/24df0jys7sb9zs4lfcsq0p_c0000gn/T/jg-task09-new-selection-browser-5Ak1CV/browser/task09-new-selection.e2e.ts-真实新建、独立业务类型、手选已发布Word模板并保存生成实际文件-desktop/pdf-physical/receipt.json`；实际栅格 `/var/folders/w1/24df0jys7sb9zs4lfcsq0p_c0000gn/T/jg-task09-new-selection-browser-5Ak1CV/browser/task09-new-selection.e2e.ts-真实新建、独立业务类型、手选已发布Word模板并保存生成实际文件-desktop/pdf-physical/page-1.png`。
- mobile: DOCX `87f6b79f4b1c216cadd35bf910d25c05e0e1f65b6a4f07a0d11a4ac9e0674123`；PDF `79f1a27e6a28951d43c5da039b6b8c67f62a0d4f3233fab5d75f48b390be4ca5`；物理receipt `/var/folders/w1/24df0jys7sb9zs4lfcsq0p_c0000gn/T/jg-task09-new-selection-browser-5Ak1CV/browser/task09-new-selection.e2e.ts-真实新建、独立业务类型、手选已发布Word模板并保存生成实际文件-mobile/pdf-physical/receipt.json`；实际栅格 `/var/folders/w1/24df0jys7sb9zs4lfcsq0p_c0000gn/T/jg-task09-new-selection-browser-5Ak1CV/browser/task09-new-selection.e2e.ts-真实新建、独立业务类型、手选已发布Word模板并保存生成实际文件-mobile/pdf-physical/page-1.png`。

主控已独立查看两份实际栅格：中文、正文双方、签章位置和普通条款清晰。源字体、copy、独立检查器、Python、fontTools、PyMuPDF及soffice wrapper的工具指纹和三产品文件前后哈希在profile receipt；完整case及glyph摘要在 `fullcase-physical-summary.json`。无默认环境PDF已自动修复的声明：本次证明的是已确认的child-only字体可见性运行条件下原公共链正确。

API受影响测试即上述真实完整链；API类型/lint、E2E类型和改动E2E文件lint通过。仅测试/说明变化，不重复637、全UI业务或369，也不继承它们为本次新SHA实际重跑。上一检查点已通过的产品行为证据按未改产品字节保留。原canvas旧文案断言未修；不是此次新功能失败，也不能以其仅基线为由隐藏。

## 极简需求完成与缺口矩阵（供主控提基础阶段收口选项）

| 需求 | 本次可交付的基础范围 | 未完成或后续责任 |
|---|---|---|
| CON-01/04/05 | 三关系与五类型独立起草；现存库结构起草需已有项目+业务类型，名称/双方可暂空保存，生成前定位五项；双方搜索/当前单手填不建共用档案。 | 不代表未选项目也已落库；真实PG仍仅准备。 |
| CON-06/07、BAS-02 | 四位/NULL与0、框架未知/包干/清单、部分金额标签、付款单文本及结算文本；后端校验和防重；无OCR或线下事实自动推断。 | 正式付款/金额冻结不由本片扩展；真实PG和实际交易未执行。 |
| CON-08 | 草稿含税/不含税声明、待补税率/发票、网格与Excel已接通；无票不把未知税率变0。 | 不含税新v2文书明确写前拒绝，正文/导出适配待10；正式提交冻结待12，正式税务补充更正待13。 |
| CON-09 | 不推荐、不预选；按当前合法type手选发布Word，关键资料带入，已验证对上新建完整DOCX/PDF链（锁定child运行条件）。 | 不冒称任意运行环境/全部业务模板矩阵已通过；完整正文编辑另属10。 |
| **CON-02（部分）** | 三关系可新建保存，已有对上新建→手选→实际文件正控。 | “表内生成并审批”、表外/对上可审批或直接上传已签PDF/照片登记台账未完整：12；三类历史接管：34。不能用draftData.relationship证明正式生命周期均已支持。 |
| **CON-03（部分）** | 填写信息/合同正文两标签及主要区域布局已具备。 | “可编辑的完整合同预览”与正文同步尚未交付，任务10；现有文档/预览入口不冒作完整编辑器。 |
| CON-23 | 沿用自动编号协议；新draft原号可空、不暴露DBID，样张显示自动草稿号；未改正式编号触发。 | 新v2正式提交仍failclosed、待12闭环；历史/线下原编号及无号空值待34，不能称全来源已验。 |
| 旧canvas/运行与发布 | 旧canvas字串失败在精确4bdc基线已存在，本片保留；新建保存/手选/实际双格式有独立行为和实物验证。 | 原失败作为44前债保留；真实PG/迁移、部署/生产验收未做，字体runtime配置尚非生产部署。 |

该矩阵不是全部CON已通过。用户尚未确认基础阶段收口选项，09不关票、不整体review、不启动10；审批12/历史34的缺口仍按原规格保留。未push、合中央、执行PG/SQL/迁移/受控资源、部署或修改生产。

## 本阶段日志与物理收据字节

- `/private/tmp/jg-task09-pdf-profile-20261106-r1/profile-receipt.json` SHA-256 `b9fd272d9f9263fc8d228943cbd4c2a9511343fb014ec9f73e09ae054bc31e74`。
- `/private/tmp/jg-task09-pdf-profile-20261106-r1/fullcase-physical-summary.json` SHA-256 `049b8ad62c6ac018cf96e01e737dbb632dffad80b8845f75ccb8375168a35309`。
- `/private/tmp/jg-task09-pdf-profile-20261106-r1/old-82-glyph0-red/receipt.json` SHA-256 `3bf00f24ab6d7653a54409873eb2c9a194e5595dc0bcca68c44481555e4c9f73`。
- `/private/tmp/jg-task09-old-pdf-physical-red-r1.log` SHA-256 `416c6448224b1dcb21a51caab2c9878073626520084572062932da1edf3f17f7`。
- `/private/tmp/jg-task09-pdf-profile-fullcase-r1.log` SHA-256 `945e7a19cafdb8ff005f9bb43fb1409523e7c25a0023358ca6f9e84044024e8b`。
- `/private/tmp/jg-task09-pdf-api-types-preflight.log` SHA-256 `a757ca5925f3ae18bba341e321fa8a89da94e6daaa1efa358d42f0505f98b7c3`。
- `/private/tmp/jg-task09-pdf-e2e-types-preflight.log` SHA-256 `d21956042676b00d55515faaedd600bfab57d2cda7eb6070139ac7f81bffa62c`。
- `/private/tmp/jg-task09-pdf-api-lint.log` SHA-256 `46642744d45e082a48c782aea3a9f7288bb41639dec537fa0374fae6f894b28a`。
- `/private/tmp/jg-task09-pdf-web-test-lint.log` SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

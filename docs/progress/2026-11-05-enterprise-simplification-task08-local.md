# 任务08：公开CLI技术验证本地记录

## 准确来源与本轮整合

- 作者候选：`76837c2015148e29619e2d3d3cb3b41cfb1ec9b5`；中央合并：`75a83b95dece7cc6485b6f8d3060786e515c5bdd`。合并后完整树与作者候选相同；相对原中央40b仅新增21个`scripts/probes/task08-documents/`范围文件。
- 独立[Standards](2026-11-05-enterprise-simplification-task08-standards.md)/[Spec](2026-11-05-enterprise-simplification-task08-spec.md)均0项，报告准确绑定768，不冒称后续文档提交全部产品门通过。
- 中央同树既有17项聚焦检查通过（14个CandidateCLI公开文书行为+3个PublicExport既有实际PDF/拒绝边界检查），无新增测试或额外PDF导出。日志`/private/tmp/jg-enterprise-task08-integrated-focused.log`，SHA256 `311840a294642891c29ade6e86a97fabc61bc78e53ae20f48f91449e83105dac`。Python为任务隔离环境3.11，不改pnpm包。

## 已确认的技术证据

五类型八份已审样张各基线及普通条款新增/编辑后关键字段同步，加材料13列、机械10列各45行长表，共18项实际DOCX/PDF。文本和trace缺字、无效字形、字体嵌入、A4、页外坐标、续页表头/边框、行顺序与签章结构均独立检查；两长表数量45个均为单行9pt，并核实际表页及签署页。截图仅为补充。

819旧候选三compact甲乙方缺失被Spec判P1；现以编号后/金额前的受控正文中性“甲方/乙方”映射修复，不猜买卖/承租法律角色。3baseline+3after各一份新实际输出，均1页；after旧双方名消失、手改条款保留，双方实际仿宋14pt。其余12项仅在当前公开CLI生成DOCX所有ZIP部件名称/字节与原实际PDF输入严格相同时继承测量，未冒称重新转换。最后位置守卫后的当前全18 DOCX等价链亦核验。

- 有效清单：`/private/tmp/jg-task08-document-receipts-20261105/task08-party-fixed-effective-matrix-current.json`，SHA256 `a1923a4ac3e037bab59c41fef23e1a1e2113502183dfdb4b90e54a3b5f299f33`。
- 候选绑定：同目录`task08-party-fix-candidate-binding.json`，SHA256 `b315a6b06f42a518cc587cfab231c1a3eb81b517731da2e7b039bc2b85b5a425`。
- 原八源样张字节不变；源/主线差异与用途在[来源清单](../../scripts/probes/task08-documents/sources.json)；只进入probe副本，不采纳为正式生产模板。原LO丢逗号、包声明缺陷、8.5pt和漏双方等失败均保留，详见[探针说明](../../scripts/probes/task08-documents/README.md)。

## 保留的限制与后续任务

当前选择为已审模板版本、权威字段锚点、独立普通条款及固定离线docx4j从同一DOCX修订生成PDF。原生Microsoft Word分页及合同部逐页母版签认未证明；compact原封面/标题字形/签署区缺口及real原标题/正文/页边距差异仍存在，不称全部正式母版标准通过。10负责正式API/UI、权限/持久修订/同修订导出；11负责主管上传映射确认、版本停用隔离和母版规范签认。本票没有制造完整产品编辑器或任意Word转换承诺。

依赖按README及固定运行时锁记录：lxml BSD、fonttools MIT；docx4j及随包NOTICE不得概括全部传递依赖为单一许可；Temurin GPLv2+Classpath Exception为临时工具。PyMuPDF AGPL/商业双轨仅作本机诊断，未购买商业许可、未纳入闭源产品运行依赖或分发二进制。既有字体EULA未收集再分发授权，fsType不等于授权；字体/JDK/jar不入仓库。

## 状态与安全

本地CLI技术边界完成，#390仍OPEN待父控准确源码封包/核验、推送及收口。05/06继续补修，05未闭因此11尚未可领取；07测试边界已确认，仍等05。193规格行、45任务ID、阻塞边和Mermaid未改；中央PG库存仍517逻辑场景（非实际通过），05私有树新增库存未吸收。

本merger未推送、未改main或关闭Issue，未运行PG/Docker/SQL/迁移/Task01 driver/helper、真实短信/存储网关、部署、生产读写或真实业务。原脏根及其它私有工作树保留。远程含PG迁移CI仍不启动，提交带`[skip ci]`；不代表CI通过或豁免发布门。

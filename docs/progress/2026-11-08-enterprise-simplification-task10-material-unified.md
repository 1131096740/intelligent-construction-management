# Task10：已确认 compact 准入反例与材料运输统一清单（本地，待最终执行桥复核）

当前基底为 eb39f88ac4b5c5888c9fd8293f398b1d09dba7f8；专用树 `/private/tmp/jg-382-task10-material-unified-20261108`，未提交。用户确认三份 compact 原件保留为准入反例，材料与运输采用统一 main 清单及匹配新模板版本。CON10 提交提醒正式 consumer 仍属 Task12，#392/Task10 尚未关闭；不以本片完成解除其依赖。不新增必填、Schema、权限或旧退役写入口。

## 实现与权威数据

原材料母版 8d707f8ecd65e2ca69c6920991dcb542cbc23ada42cf39a62299ab25e5820334 原样保留。新技术副本 `material-purchase-unified-v2.docx` SHA256 3fcd682276933ccf69014ac30ddcb32e7e15322a3c433e19db437478fac95722，仅 document.xml、footer1.xml、footer2.xml 三个 ZIP 成员变化；generator 与 provenance 可重放。并非正式生产母版采用，也不声称等价于既有 44be 母版。保原其它条款、签章、字体、节式；两运输句明确费用已计入合同总价并在统一表单列，不另收、不重复累加。两原 WPS/VML 页码容器仅在新副本规范为普通 PAGE/framePr，保原可证明名义格式，不声称旧浮框物理 bbox 等价。

序号由服务端真实行位置生成；税额单价仅是现有 grossUnit−persistedNetUnit 的只读分解。仅非负且 gross/net/difference 各按现有精度乘 qty 与持久 gross/net/tax 行额一致才显示，矛盾或缺事实沿原未知显示；不从行税额除数量反推，不截负为零，不修改保存/生成准入。rowNumber/taxUnitPrice 不能被 customData 洗白；既有普通自定义值保留。manufacturer 消费既有非财务自定义值。三个 optional canonical 菜单只开放已有权威 net 大写、tax、tax 大写投影，前五 required 不变。

DOCX 字体集合由纯只读 tuple 共用，保原四项并追加规范明确的 Times New Roman、仿宋_GB2312、方正小标宋简体；XLSX 原集合不动。检查器仅解析真实 rFonts 属性，lang eastAsia=zh-CN 不再误判字体；真实未知字体仍拒绝，DTD/实体拒绝。原空 font program fail-closed 不变。

## 实际验证与失败保留

所有外部证据目录为 `/private/tmp/jg-task10-material-unified-preparation-20261108`，不宣称普通 CI 会自动具备这些 native/profile 输入。完整调用、环境、前后守卫及原始 stdout/stderr 见各子目录 receipt。三 compact 原件逐公有 upload/create/source-positions/PATCH 拒绝且授权下载字节不变：compact-three-first，3/3；这是既有正确行为观测，不是人为产品 RED。

原 8d7 公有位置读取 400 是 nested PAGE 结构拒绝；readonly 字段真实 RED 显示 customData 伪造序号/税单价，随后最小服务端投影 GREEN；optional mapping DTO 和 public inspection 的真实失败亦保留。tiny qty0.0001/unit0.50/13% 的持久精度反例保持真实事实、税单价未知，合同仍可 SAVE/排队。所有技术 env、Buffer 类型、wrong snapshot path 等失败独立保留，不算业务 RED。

R3 native：native-r3/receipt.json，selected1/unselected4，16.959s，真实公有新模板 upload/map/inspect→当前 LO 预览→确认/提交/发布→合同编辑/关键字段同步/重复保存读回→95f worker→同 R/F 授权 Word/PDF。45 材料行加 046 非零运输，初始117068/net103600/tax13468；运输 qty2/unit56.5→113 后最终117181/net103700/tax13481。保手改、同步甲方、045尾行与46行金额。新版本技术测试发布不代表生产正式采用。

最终 pair：`tmp/jg-task10-material-unified-native-EqVJba/actual.docx` SHA256 87a498977aea43905ced48eeba8f534e03cdafb6bfcfde93e185447a1512ffb6；`actual.pdf` SHA256 05976f21ddf07913b6eeaff4917eb29e4a737f3e96c22a6f9ce34c08f3d8f2cb。原95f strict CLI、20s与阈值不变，显式 clean child env；repo 内 totals-line observer 以独立103700/13481/117181常量检查每项单行。第一对实物 net/tax 合计断行的 actual RED、首观察器资格失败、两次 FONTCONFIG 资格失败全部保留。新副本仅合计闲置单位价格与金额格合并，spans [5,1,2,1,2,2]，不改13列宽、明细字体、四位金额精度。root 独立实看最终第3页清楚，补充证据在 `/private/tmp/jg-task10-material-unified-root-observation-20261108/final-pair-observation.json`，不替代端到端/原浮框资格。

本次实际受影响 backend 35 suites/343 tests，0skip（affected-backend，111.829s）；API type、全 src lint、fresh Nest build 通过。known empty-font 三 LO 坏 runtime 原 worker 入口实际3选中/1未选，通过；legacy/offline trusted 两入口实际2选中/2未选，通过。default trusted 由 R3 当前10字体 profile 下真实预览/发布证明；旧 O browser 仅原输入/输出与消费者未变闭包桥，未宣称本次重新运行 UI。原完整26native/15browser/364 parser/369 CI 不重计为本次 actual。

canonical7/receipt.json：7write+7check 全14通过，每项 sourceChanges=[]，无生成物新增或变化。source-only-r2 15源码冻结 eb1bbe63c6b63ce78e095b5f1cfc2ca620fedb8ad46ac0eaf2dd79ff172f6bac 已两轴增量0；完整最终执行/本两MD桥另交复核。source/private/runtime 各运行前后不变，共享依赖58799项与初始逐项同。R3后只有两个无关测试文件三个精确root字面量重绑，ports/flags/fs.allow/预算/校验不变；R3消费者闭包保持，未为桥重复渲染同pair。

旧树、中央未知改动和原件保留；本片无 stage/commit/push/mainmerge/Issue close、无 DB/SQL/迁移/部署/生产。未来任何范围内提交仍须 [skip ci]。本地执行与 GitHub/生产状态分开；最新远端/最终整合由主控另核。

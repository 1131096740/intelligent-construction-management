# 任务19 两轴发现修复交接（2026-11-06）

候选只在任务19私有树实施，未推送或关闭#401；原 a27 两份评审及失败证据保留。四项修复：

- 自动保存后通过公开GET重取同一修订的完整已确认快照，保存成功与读取失败分别表达，失败不重复PATCH、不覆盖仍在编辑的输入。
- 我的待办增加当前项目物资员/公司物资主管的已批材料采购投影；重新核权、核当前版本和状态，102项真实计数与30条展示分开。General、Spot、Fund三个投影均保留。
- 未Tab/Enter的中文原生编辑缓冲阻止真实reload/back/关闭；空焦点不算修改。保存不谎报旧model已保存，确认层位于主对话框之后。只为新DOM监听加typeof window守卫，原卸载清理保持。
- 所选行预计金额复用公共十进制算法；部分未知明确提示、全未知不补0、已知0显示0.0000。

## 新跑与继承

证据目录 `/private/tmp/jg-task19-review-fix-20261106`。原预算30秒、0 retry、遇失败停止；无强制点击、page.route、私有Vue或假beforeunload。

1. 四项真实公开RED与最小GREEN详见 cache-red/green、me-purchase-public-red/green、native-red/native-close-order、selected-public-red/green 原日志。原工具同步、错误入口、checkbox隐藏input和URL中文编码错误均保留，不冒充业务RED。
2. 合7841后的原8加新增12浏览器一次20/20（57.6秒）：`browser-final20-r1.log`。451文件as-run SHA清单 `browser-final20-r1-source.json`，SHA bdb039c955bf87d1b6c8811e3faabe27ae516ee75734fb380793378c25e07eba；准确桥接到8054，不冒称合15新头20次新跑。
3. 合15固定941后真实公开Me/Spot/Fund/General四套135/135；PermissionGuard79/79。使用fresh Prisma.dmmf模型、真实fund helper和自然空资金表，未stub返回空数组。新增真实Me桌面/手机2/2（6.3秒）显示采购待办及数量，进入原详情待采购，`merged15-me-browser-r4.log`。
4. 合15桥接451文件447相同，4变化逐项列在 `merged15-browser-bytebridge.json`：test helper挂真实Me并支持tagged SQL、read API资金业务类型、Shared资金动作、Guard资金分支。Spot产品UI/领域与原20测试未变；新Me实际公服/UI覆盖变化。首沙箱MachPort拒绝、旧测试适配器tagged SQL形态500、URL断言未编码中文均留存，不改产品迎合测试。
5. 原卸载3失败因新增监听直接访问Node无window，最小guard后同断言3/3，17为-t未选择；原Web11文件234/234随后通过。合15API build/types/lint、Web types/lint/UI、E2E类型检查通过（Web870条warning、0error）。
6. 实际审批PDF未知/已知两份及raster/物理收据继承a27：本次未改PDF业务路径。旧文件散列分别 fef334e173a24115aa8abdde31da7552094482917b7bbdf661d8faed02ac0563 / 03544110532d6e0b55974c601201ccbc7e2b9164ba37625b5d7bcee1c4e3c9fe；非空实际字形96/103，目标位置ink已核。原66通过/9条件skip明示；Task11坏字体runtime成功问题仍10/44门。

## 数据库与治理

合并保留09 remaining161、19 pol113181（Spot12）、15新增Fund12，真实源派生541逻辑/CI540、79文件/CI78、202 SQL源码；`pg-15-19-source-union.json`保留两侧源。原库存静态77/77，CI准确英文target1/1、8未选择；此前中文pattern全filtered不计通过。全部仅静态准备，真实PG executed=false。旧Spot PG11前提过时 `KNOWN_STALE_NOT_RUN`，16需修齐，未改旧断言制造通过。

合后原7清单重生：718路由、672wrapper/711binding、414action/0blocker、合同变更80/22、旧只读12。原369留独立merger，作者不重复重型门。

所有旧失败保留；21实际采购/付款、16/42/44真实PG与最终业务验收仍未完成。资源、SQL执行、迁移、短信、银行、COS、真实交易、部署和生产写均未执行。最终准确clean SHA与prepare/verify封包另见外部handoff，待原两轴增量审查与独立merger，不提前关闭票据。

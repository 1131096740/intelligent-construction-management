# 任务19 第二轮增量补修（2026-11-06）

从 clean `6a6510f59b6ed05cf9f120559b2888f953e8ffae` 续作；原报告 `/private/tmp/jg-task19-standards-6a6510f5.md`、`/private/tmp/jg-task19-spec-6a6510f5.md`、原封包和交接收据完整保留，不覆盖其结论。

## 已确认边界和修复

用户补充确认“公开router导航驱动边界”：真实浏览器加载完整WebApp，调用正式export router的标准public push，使用原TDesign/DOM/HTTP/历史与组件守卫。不是现有产品链接点击，也不读取私有Vue、不伪造PopState、不增加产品导航或fixture按钮。

- P3：已确认保存签名改为ref，所有比较和赋值一致使用响应式值。真实备注编辑→Tab→800ms前取消→保留→公开PATCH/GET确认已保存→再取消，旧版仍拦截；最小修复后不再误报。
- P2：同record update与leave共用原未保存守卫。编辑打开时绑定采购ID、版本和route generation；保存前、上传后、取定义后及保存/核对回执前重新核身份；打开失败和核对读取回执也不污染另单。路由清理关闭旧编辑会话，允许切换后必须重新打开新单，不能配旧表单与新单坐标。异步finally只释放原route/session自己的busy，保留合法新版本保存后刷新行为。
- 真实公开router push A→B后，B未Tab中文再push A的RED已复现错误切A；GREEN保留B URL/同Document/中文，明确放弃后真实back A并独立保存A。另一实际HTTP延迟只延后B的真实确认GET；允许切A后打开A再释放B，旧B回执不回填A，A/B服务器各自内容独立。

## 证据与限制

新证据只写 `/private/tmp/jg-task19-review-r2-20261106`。P3 `signature-red.log`→`signature-green.log`；P2 `route-update-public-red.log`→`route-update-public-green.log`；迟到读取正控 `late-read-green.log`。均原30秒、0retry、无强制点击/替换业务HTTP。

导航驱动初次尚未等router ready，back到about:blank；补ready后全局文字同时命中Tab及h2；二者工具错误保留，不计业务RED。准确TDesign入口后真实history back一次全绿，原因是中文编码规范化先命中leave守卫，不能证明update漏口；真正反例来自用户确认的public router push直接同record更新，未把原全绿冒充失败。

原Web11文件234项在补修后通过；类型/lint/UI/E2E检查通过（lint既有870warning、0error）。最终窄浏览器回归 `final16.log` 一次16/16（52.0秒）：新增3项双端6次，加受影响旧详情5项双端10次；保持原30秒、0retry、首失败停止。旧详情覆盖完整手动保存/提交并联流程、确认快照、GET503单PATCH、既有原生中文reload及真实back；未把未选中的10次当作新skip。准确新候选封包另见外部r2交接。

本次API/Shared、Schema/SQL、Me、PDF业务路径未变：原6a公开135/权限79/旧付款38及Me实际双端2、PDF物理非空字形/目标raster、541/CI540库存与202 SQL仅准备，按实际无变源继承，不宣称新头重跑。旧20浏览器作为历史里程碑，详情页已变化的路径必须以本次窄回归证明；未变新建/选中合计按源核对。旧7治理检查因详情源行号移动不能冒新头fresh，机械派生清单及原369仍由独立merger执行。

旧审批PDF66通过/9原条件skip、旧Spot11 PG过时前提、Task10/44坏字体runtime成功、21实际采购付款、16/42/44真实PG与最终业务门继续保留。未推送、关闭#401、修改中央、创建资源、执行SQL/迁移、发送真实通知、访问银行/COS、办理真实交易、部署或写生产。待原两轴再次增量审查。

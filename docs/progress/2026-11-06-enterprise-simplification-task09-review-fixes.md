# 任务09独立复审补修候选

从干净 `1cd7b48ed847d3c9e5bdb44344d381b24117ed80` 追加补修，不重置/隐藏历史；中央仍为5fefe9a2，本轮未另合候选。原完整Standards1P3/Spec1P2报告保留于 `/private/tmp/jg-task09-{standards,spec}-1cd7b48e.md`，本收据不自行宣布复审通过。

## Spec P2：有上限框架金额

先在已确认公开HTTP保存/重读边界增加唯一反例：实际新建capped v2框架，清单数量1、含税单价1.5340、已知税率；真实JWT/岗位/租约、真实服务链连接合成数据库。PUT/GET均200且清单1.5340，但合同保存金额NULL/NULL，独立期望1.5340元/兼容153分断言失败，`framework-red.log`退出1。未动产品前取得RED。

随后仅复用既有contractPricingPolicy，将无限额框架保持NULL，有上限已知清单按真实合计。原case首次GREEN后，增加unlimited已知行、capped数量未知两种对照，3项通过。相关原8套另发现旧公共HTTP“完全无清单”框架算例由NULL变0.0000（639通过/1失败）；原失败保留，不改原断言。进一步公共“有默认清单但无行”对照本来已NULL通过：该log虽名`framework-empty-red.log`，实际退出0，是正控，不能冒为RED。两者差异在空清单集合sum([])=0，最终只对framework且documentBills.length===0保留未知，不把真实已知0或任意无行草稿泛化清空。正式提交/编号、旧v1金额分支和税务待补边界不变。

最终真实HTTP四种：capped已知1.5340、unlimited已知行但总额未知、capped数量未知、capped默认清单无行；保存与工作台重读均按独立期望通过。旧完全无清单HTTP原断言也恢复。

## Standards P3：就近解析器复用

现有`contract-labels.ts`增加纯`resolveCurrentContractBusinessType`，工作台标题与文档选版computed传各自资料复用；保留文档props显式覆盖语义、非草稿父类型、旧草稿回退、新pending缺失/非法类型不回退。后端类型校验独立保留。无新内部helper测试seam，仅沿原公开组件和真实新建/选版链验证等价。

## 本轮新跑与继承

- API相关原8套+新增framework4项：9套641/641；有上限已知及未知/无限额/无行与旧完全无清单均通过。旧协议、正式金额/文书守卫由原相关套保留。
- Web原3文件86/86，包含公开基础组件及原draft/labels；API类型/lint/fresh build，Web类型/lint/UI/E2E类型通过，仍860项warning。
- 原new-selection公开链一次：真实桌面/手机2/2，约28.5秒，原90秒/0重试不变。共享正式PDF检查与09逐字outline同时通过，各75中文/40种；作者查看新两栅格清晰，双方/条款/签署位置可读。同已批准child-only锁定字体profile，未改转换器/全局字体。
- 无需新路由/权限/Schema/迁移，上一候选7写7核、静态PG528/CI527及200份SQL源码只按未改治理输入继承，未冒本轮新跑，最终中央独立merger须刷新治理和原369。
- 原扩大Web629过/12失败/1error及冻结中央两文件11失败/4过/同error未重跑或修改，仍按原准确SHA保留。全Web不绿、公共竞态未由内部失败对照证明；11验证与44门继续跟踪。

新日志、原RED/额外失败、实际文书及物理receipt指纹统一索引 `/private/tmp/jg-task09-review-fixes-20261106/verification.json`。旧字体B问题仍未修，10/44必须核实际runtime；CON02/03及未税正文/提交/税务/历史缺口按10/12/13/34保留。未推送、合中央、关票，未运行PG/SQL/迁移/资源/短信/COS/银行/实际业务/main/部署/生产写。

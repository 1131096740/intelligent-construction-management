# Spec 独立最终重审：2e5f1557

准确HEAD `2e5f1557a3e4018277f98b371a8f5ce51e8b0c62`，固定点`a4b325df8f2565222f1e6a9671f3d7122ee96b84`。已核两ref、祖先关系、提交列表、clean及指定非空全diff。未与Standards交换新结论。

(a) 需求缺失/部分：**0项**。

(b) 未要求行为/越界：**0项**。

(c) 貌似实现但错误：**0项**。

完整范围继续对照`docs/specs/2026-11-05-enterprise-simplification-spec.md:263–266`：“三类可新建/修改项目基础信息并保留记录”“一项目仅一家施工企业”“项目可标已完工，仍可结算付款查历史”“只有这两岗新增/修改/停用”；`:32`主体关系及[#389补确认](https://github.com/1131096740/intelligent-construction-management/issues/389#issuecomment-6660365880)“仅禁止新选用，旧单继续”“没有可靠原引用、主体冲突、当前账户无效等仍失败关闭”。项目三岗、单位两岗、人员统一入口、完工后办理及可靠历史主体续办符合确认范围；05仅移除两项委托退役守卫，其他86项及11边界保持。

本轮独立核r3→r4仅`services/api/src/payable-registry/payable-registry.service.spec.ts`变化，业务服务与其余tracked内容相同。直接从旧Git源码提取7种目录状态，与新显式samePayer/originalDebtorActive/approvedPayerActive/actualPayerActive逐项推演公司状态及10类fault预期，70项全部等价；未直接依赖作者等价声明。旧17案例及零写断言逐段原文相同，命名变化未弱化反例或合法历史/既有代付正控。结合本轮全diff范围与前轮真实服务调用链重核，原三条P1均已闭合，无新增TTL、银行模型或金融算法。

核本轮4完整spec原日志361通过及3份日志hash一致；交接JSON SHA-256为`5a6c9294b589ed404c330e3c5db5ff4d52d850c49a5fa346c4ea4bc8a7cc833b`。

验证限度：此次执行只读静态/语义等价复核，未独立重跑测试。361为作者合成数据库/账户边界结果；未证明真实PG/约束竞争、实时银行、浏览器持久链或完整发布门。未改候选、读取原dirty根业务或执行资源、SQL迁移、短信、部署、生产。Spec 0项仅绑定该候选确认范围，不代表上线/真实业务验收。

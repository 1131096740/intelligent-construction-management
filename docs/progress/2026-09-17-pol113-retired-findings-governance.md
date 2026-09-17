# POL-19A 五张历史 finding 的适用前提治理

日期：2026-09-17。范围仅 #175、#185、#190、#193、#194 的独有 finding；当前状态为待验收治理候选，不声明旧修复已合入或五票已关闭。

## 后续权威与处理原则

[#201 用户选择保持关闭](https://github.com/1131096740/intelligent-construction-management/issues/201#issuecomment-5340345886) 明确公司新建/编辑、组织岗位增撤、组织用户创建当前不开放。[#197 冻结评论](https://github.com/1131096740/intelligent-construction-management/issues/197#issuecomment-5340342525) 覆盖旧七 wrapper 激活、十动作及固定数量要求，要求七项保持 `test_only`，且不改公司/组织页面行为。因此下列旧 finding 所依赖的生产接线不再是本阶段待实现要求；维持关闭无需新的产品决定，恢复入口需要新的明确授权。

七项为 `createCompanyEntity`、`updateCompanyEntity`、`applyOrganizationRoleAddition`、`applyOrganizationRoleRemoval`、`createOrganizationUser`、`previewOrganizationRoleAddition`、`previewOrganizationRoleRemoval`。验收须证明无真实生产 UI consumer，不能仅凭 Drawer 内有调用就认定开放。

## 五票映射

| 原票与独有 finding | 明确后续权威 | 当前待验证 | 验证后可处理的状态 |
| --- | --- | --- | --- |
| [#175](https://github.com/1131096740/intelligent-construction-management/issues/175)：公司 FactsPayload 进入统一 validate 的 TS2345 | #201 保持公司创建/编辑关闭；#197 禁止改变该页面行为 | 公司无可达写入口、相关 wrapper 退休、当前 Web 类型门；旧新增 validate 调用不属于现行接线 | 可按“适用前提被后续决定替代”裁定独有 finding；不得表述为类型修复已合入 |
| [#185](https://github.com/1131096740/intelligent-construction-management/issues/185)：公司 facts、岗位增/撤 target 到 Record 的三处类型错误 | #201 保持公司及岗位增撤关闭；#197 七项退休契约 | 三条旧生产校验链不在现行开放范围；公司/组织隔离、七项退休、当前类型门 | 可按替代理由处理三处 finding；不为重现 RED 重建禁止链 |
| [#190](https://github.com/1131096740/intelligent-construction-management/issues/190)：公司父 saveEntity 的 string/null/undefined 归一化 | #201 公司写入口关闭；#197 页面行为保持 | 公司无可达生产写入、当前类型门；不把未存在的父页接线当修复成果 | 可按前提替代处理；不新增日期、地址或默认值语义 |
| [#193](https://github.com/1131096740/intelligent-construction-management/issues/193)：公司 save-create/save-update 动态 emit 的 TS2769 | #201 公司写入口关闭；#197 不恢复生产 consumer | 双事件属于旧迁移候选；当前关闭边界及类型门有效 | 可按前提替代处理；不声称显式 emit 修复已合入 |
| [#194](https://github.com/1131096740/intelligent-construction-management/issues/194)：公司三态测试把宽输入传窄 payload 的两处 TS2345 | #201/#197 取消该公司生产迁移前提 | 旧候选测试不是主线通过证据；验当前类型门及关闭边界 | 可按前提替代处理；不新造生产 normalizer 或测试来满足旧形状 |

各行权威评论均指上节精确链接。现阶段保留五票 OPEN；总控在当前证据、独立复审与交付条件齐备后逐票决定处理理由。不使用自动关闭关键字，不把前提替代冒称 completed 的代码交付，也不继承旧票的整串 closing 清单。

## 已有基线证据与限度

本轮其他验收者的下列结果仅绑定基线 `b7b1a69a7ebb435e9b247642f951c33324a70eff`；新增本文与账本后形成的新文档 SHA 不继承这些通过声明。

- #179 官方合同能力矩阵单项检查为 `matched`；只证明该单项，不是五票类型门或 #113 完整门。
- 合作单位既有四组结构/状态测试为 20/20；P22 治理覆盖七项退休内容，但不是本轮全量生成器的新鲜扫描证明。
- 合作单位 Web build 与 Chromium/WebKit 38/38 通过；浏览器使用模拟 API，不能证明真实 HTTP/PG16 的拒绝零写及事务幂等。
- 五票专用的公司/组织退休入口核验尚未在本文登记通过；待其独立收据完成后由总控补充精确结果和证据来源。

## 未完成门与保留范围

- [ ] 公司/组织无可达写入口、七 wrapper `test_only` 与无生产 consumer、现行隔离测试及 Web 类型门的完整当前收据。
- [ ] 官方清单一致性及本治理候选适用检查；数量由官方工具产生，历史 466/488 或 259/0 不作目标值。
- [ ] 最终候选 SHA、独立 Standards/Spec 双审、固定 PR head CI、合并 SHA 与主干 CI，以及逐票最终状态核验。
- [ ] #113 和其他混合票继续 OPEN；本人资料、项目经营档案的真实统一迁移与因果链仍保留，合作单位真实 HTTP/PG16 和整票验收残项仍保留。

本治理变更仅包含文档及账本摘要，不修改业务源码、Schema、权限或共享清单，不包含部署与生产操作。提交、推送、后续门与关票状态以总控登记的外部精确 SHA 交付收据为准，本文件不预先宣告完成。

# Issue #224 / POL-13E 候选收据

## 候选边界

- 开工 live main：`b4a3bffcd0fd6779832acee1961d721b7864e319`。
- 分支：`codex/pol-224-historical-payable-funds-20260906-b4a3`。
- 只实现 Issue #224 的历史应付、付款执行、核销分配、主体间往来、资金 movement 和期初毛额接管。
- 不实现新应付或新付款；不扩展工资本体、HR、审批或通用工作流。
- 未部署，未运行生产 migration，未对生产执行 scan / apply / activate / rollback / compensate / 清数据，未访问或写入生产 PostgreSQL、COS、权限或业务数据。

## 实现结论

- A 级只链接服务端重新解析且已经存在的 canonical target：`PaymentExecution`、confirmed `PayableSettlementAllocation`、封闭 `WagePayableRef`、confirmed 往来与 confirmed `FundMovement`。
- B 级只记录可证明的期初毛额余额；不伪造银行付款、核销或往来。
- C 级只保留 unresolved gap。
- `ProjectProxyPayment` / `ProjectAffiliatePaymentFact` 仅参与去重 read-set；`HistoricalWageSummaryPayableRef` 仍为 `historical_reconciliation_only`，不能成为新付款或核销来源。
- 整批在 Serializable 事务中固定经过 `prepared → applied_inactive → attested → activated → compensated`；激活前按 exact candidate SHA、manifest fingerprint 和完整 read-set 重验。
- inactive 数据不出现在 active projection；补偿只追加逆因果收据，不删除或改写 canonical 业务事实。
- Web 仅展示历史应付与资金 manifest 的 A/B/C/冲突统计，未开放导入、apply、复核、激活或补偿写操作。
- 所有五类写命令在 `NODE_ENV=production` 下默认失败关闭；本票没有创建任何可绕过独立生产授权的开关或路径。
- 合同岗位可读取批次校验信息，但 canonical target 标识、target snapshot 与补偿逆因果 target 均脱敏；active projection 仅允许财务岗位读取。

## 当前验证

- adapter/边界定向 Jest：14/14 passed；PG 套件默认正确 skip，仅由官方 disposable runner 显式开启。
- API 与 Web typecheck：passed。
- API 与 Web lint：0 errors（仓库既有 Web warnings 保留）。
- API 与 Web build：passed。
- Web `check:ui`：passed。
- 官方派生 manifests 已按当前路由与 wrapper 重新生成：Nest 574 routes，Web API 529 wrappers / 551 bindings。
- 首轮动态候选 `65f8a5f7df3869535c29416b600b9eca245433c3` 已由官方 disposable PostgreSQL 16 runner 从空库完成 161 migrations，并二次确认 schema up-to-date；POL-224 四个真实事务场景 4/4 passed，容器已由 runner 删除。该 SHA 随后因 Standards/Security 复审补入生产写入保护与读取脱敏而失效，仅作为前置验证记录，不作为最终 fixed-head 证明。
- Standards 复审：迁移约束、append-only、Serializable、幂等、职责分离、manifest/read-set/exact-SHA 漂移、inactive/compensation 语义均符合本票硬约束；发现并修复生产写命令缺少运行时 fail-closed、统一 operational-write-freeze 控制面漏登记、详情读取过度暴露三项阻断后 PASS。
- Spec 复审：A/B/C、稳定 duplicate groups、既有 canonical target、冲突整组阻断、旧表仅去重、固定生命周期与逆因果补偿均覆盖；前端只读且无金融写入口，PASS。

## 待固定头补齐

- 最终 exact SHA。
- 最终 exact-SHA disposable PostgreSQL 16 与全量 `release:local` 收据。
- push / PR / fixed-head CI；未获明确合并权限前不合并、不关闭 Issue。

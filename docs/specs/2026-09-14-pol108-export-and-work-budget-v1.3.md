# POL-108 第十八轮方案 A：只读投影与导出 v1.3

Owner 于 2026-09-14 明确批准第十八轮方案 A。决策包：
`/private/tmp/pol108-eighteenth-review-owner-decision-715879e2.md`，
SHA-256 `d8092fe59727bc5d348cc50f6cfa70477a319d3f2c78574b2bc67292b25f4d24`。
本补充仅覆盖 #108，并在以下事项上接续第十七轮冻结契约。

## 导出

- 五类 CSV 仍共用 canonical detail、同一只读 Repeatable Read 事务，保留 finance-only、密码确认、审计、公式防护和 8 MiB 完整文件预算；失败不输出部分文件。
- 仅 POST export 新增可选 `occurredFrom/occurredTo`，严格真实日历日期 `YYYY-MM-DD`，按上海时区起日 00:00:00.000 至止日 23:59:59.999（均含）。
- 两端存在时起日不得晚于止日；止日不得晚于解析后的 as-of 业务日。仅给未来起日允许得到空集。无 `occurredAt` 的 #275 合成风险行在任一期间边界存在时排除。
- `rowStatus` 为单值 `confirmed | retroactive_confirmation | pending_reconciliation`。优先级为追溯标记、风险状态、已确认。预计金额与 C 级仍属金额依据列，不另造状态。
- DTO 与 service 双层校验；数组、重复 JSON key、非法日期、非法状态、超长值被拒绝。审计保留规范化筛选。GET overview/detail 不新增这些字段。
- Web 使用 TDesign 日期/状态控件，导出区域仅由服务端 `canExportOperatingProjection` 决定。
- source/fact/impact/合成风险到五类导出的穷尽 readonly 映射集中于 shared-domain；空归属必须明确声明。正式来源注册表受共享来源联合类型约束。未知值 409，不静默跳过。直接资金执行 `fund_execution` 按其既有 fact/impact 分类，不授权任何新写入。

## 项目与工作量预算

- 可见性三表在 DB 侧 JOIN active project 后 DISTINCT，各取至多 501，再跨表 UNION；最终 500 唯一项目成功、501 为 413。多岗位/跨表重叠/inactive 不重复计数；逐项目岗位授权仍保留。
- 同一投影事务、普通事实读取之前执行总预检：20,000 facts / 100,000 impacts / 64 MiB（均含）。
- 字节采用每行 `GREATEST(pg_column_size(row), octet_length(to_jsonb(row)::text))` 之和；计数子查询以 limit+1 有界扫描。
- 计量实际读取集合：项目、cutoffAt、readAt 限定的普通事实/分录，以及所读限制来源的 replacement 目标分录和目标事实（即使目标在 as-of 外）；按 ID 去重。仅影响展示的主体/来源筛选不能免计实际聚合读取。
- 项目、公司、项目集、as-of、overview、detail、export 共用预检；任一预算超限统一 413，不能截断或返回部分结果；不同账号同样受限。
- 保留更严格的限制来源 20,000/40,000/8 MiB、detail/CSV 8 MiB、500 项目、actor limiter 和 15/30 秒 API 超时。100,000 分录若先触发 64 MiB，仍必须 413；独立计数临界值与实际行宽证据分别报告。
- 不增加 Schema、迁移、缓存、物化或异步基础设施，不改变 #279/#280 写入/replacement/重试/权限。

## 复验与延期

原候选 `715879e2a602b235493664c2ab1a368a3d4f9f20` 的 169 migrations 两遍、seed、
#108 10/10、canonical 239/239、release 16/16 已通过；第三轮独立后审 H0/M4/L5，
故不可交付。本轮修复 4 Medium 与 canonical holder 重复、文档组号、布局令牌 3 Low。

继续延期两个 Security Low：上游续页重复计算全项目指纹（先做非生产基准再决定协议）；
导出密码确认/临时文件创建在 projection limiter 前。不得误报已修复。

修复后新固定 SHA 从头执行 targeted/shared/API/Web、类型/lint/UI、manifests、全新 PG16、
完整 release:local 和全新独立 Standards/Spec/Security 三审。只有 H0/M0 才恢复已授权的
非生产 GitHub 交付链。部署、生产 DB/迁移/权限/业务数据/COS/限流配置均不在授权内。

压力夹具逐笔通过受控写入 API 创建，#108 本机 runner 与仅该 CI 动态分片的测试超时为
90 分钟；其他 CI 分片仍为 20 分钟，业务 API 的 15/30 秒超时不变。

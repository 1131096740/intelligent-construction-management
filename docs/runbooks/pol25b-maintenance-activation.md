# POL-25B：零迁移、维护态应用激活

本路径对应 #123，不对应常规兼容发布，也不解除 #124 的开放门。
本次非生产交付只明确激活契约并阻止通用部署器误入冻结状态；没有执行生产操作。

## 当前入口状态

`deploy:local`、`deploy:mac-direct` 和 `deploy-production-server.sh` 都包含迁移及
旧 API 恢复行为，不是 POL-25B 执行器。服务器入口会在构建、备份、迁移、运行时
替换前拒绝冻结配置或已停止的 API。不得先关闭冻结、启动旧 API 或伪造配置以通过此门。

当前仓库没有能验证下述上游收据并执行维护态激活的自动入口。#123 必须在独立范围内
实现、审查并验证该受控入口；在此之前，生产激活保持阻断。不得增加一个跳过迁移的
环境变量来绕过收据、维护态、权限或恢复要求。GitHub deploy workflow 仍只允许手动触发，
PR/main push 只执行非生产 CI。

## 受控激活前置证据

1. 用户明确批准本窗口、目标环境、精确 main SHA、API/Web 激活和失败恢复范围；
   不包含数据归零、迁移、解除冻结、对象写或权限变更。
2. 干净 main checkout 与 origin/main、17 项正式本机收据、merge-head CI 一致。
3. 独立核验 POL-25A 原始 `schema_compatibility_receipt` 的内容及 SHA-256。
   #296 已关闭的旧 SHA 历史回执不能自动成为新候选回执；若需连续绑定，只读兼容核验
   必须显式证明迁移集合、checksum、Schema digest、角色及停写证据未漂移。
4. #122 已完成正式归零并具有可信 terminal marker 与 `zeroing_receipt`，连续绑定
   上游回执、同一冻结候选、数据库身份、逐主键决定及对象版本。隔离 POL-22 ready 不替代它。
5. 当前数据库和私有对象有本窗口有效备份及隔离恢复证据；失败协调恢复方案已批准。
6. 数据库/私有对象写来源继续冻结，API 停止，worker/timer/cron/手工写来源停止。
   维护入口限制与实际运行配置中的 `OPERATIONAL_WRITE_FREEZE_MODE=all`、空 modules
   均可验证；仅有配置文件字面值不足以证明全部写入来源已冻结。

任一证据缺失、过期或漂移均停止，不生成成功激活收据。

## #123 受控入口必须实现的顺序

1. 验证上述授权、上游收据和现场坐标；对迁移集合、Schema digest 和写冻结留存只读快照。
2. 从精确 SHA 构建 API/Web 并校验产物，记录运行时与环境文件摘要；不运行
   `prisma migrate deploy`、Schema/backfill、角色 grant 或任何归零命令。
3. 创建旧 API/Web 运行时快照，维护入口和所有写冻结保持不变；替换同 SHA 产物。
4. 仅按本次激活授权启动新 API，保持冻结 all；不启用 timer/worker，不打开业务流量。
5. 在受控只读连接下核验运行 SHA、liveness/readiness、角色/权限、受控私有文件读取、
   关键只读页面、拒写和失败暂停。再次核验 Schema、迁移 checksum 与写冻结未漂移。
6. 只有全部通过才生成 `runtime_activation_receipt`，绑定两张上游收据 SHA-256、
   精确候选、产物/环境摘要、前后 Schema 坐标、`migrationExecutionCount=0`、
   维护态/写冻结/定时任务状态及脱敏只读核验结果；不得生成 `opening_receipt`。

上述为受控执行契约，不是可直接运行的生产命令或已完成验收声明。

## 失败、回退与开放边界

- 激活任一步失败，先停止新 API，保持维护入口及全部写冻结，不自动启动旧 API。
- 可以在批准范围内恢复旧 API/Web 文件快照；旧应用是否兼容最终 Schema 仍须独立证明，
  不得因文件恢复成功即恢复服务。数据库/对象恢复另按批准的协调方案执行。
- 禁止反向删除迁移或复活退休写入口。金额、权限、文件、Schema/收据漂移均维持关闭。
- #124 在新授权下核验完整收据链、解除冻结并正式开放；#123 不替它执行。

权威依据：#296 → #122 → #123 → #124，以及
[生产切换状态机](../specs/2026-08-12-project-operating-ledger-construction-enterprise-takeover-unified-entry.md#262-生产切换状态机)。

# 自动CI触发与停止记录

2026-11-06，用户授权的integration Git流程推送纯文档提交 `b7d7c8eef357d1bc24408cfcadde1807355d5951`，触发既有 [CI 42204525638](https://github.com/1131096740/intelligent-construction-management/actions/runs/42204525638)。该提交仅两份进度/授权MD，不包含任务10、16私有业务修改。主控在推送前未阻断既有自动PG分片，这是本次执行控制缺口；不能继续声称本轮远端完全没有执行PG。

首次取消命令在读取运行详情时网络EOF，未发取消；只读核仍运行后，同一准确运行的取消请求被接受。随后只读核最终 `status=completed`、`conclusion=cancelled`，无活动job。26个job结果为10成功、7失败、9取消；22个PG分片中有已完成和取消前正在执行的步骤。不能将已执行步骤抹去或统一标为未运行。

失败job为Build and manifest gates、Unit test gates、Quality gates、Release gates，以及PG contract_finance_acceptance、payment_execution、contract_settlement_v2。保留失败，不以取消消除它们；本记录不推断失败原因，也不以它们为依据修改断言或重复运行。

这些结果只属于准确中央b7提交，不能作为私有10/16当前候选、资金事务安全、生产数据库或生产迁移的证明。任务16真实PG验收门仍未满足，不关闭工单。此事件未授权后续PG执行；后续Git推送须避免再次自动启动PG，未取得明确PG授权前不重跑本CI、不修改workflow绕过门禁、不宣称CI通过。

主控只读元数据文件 `/private/tmp/jg-ci-42204525638-after-cancel.json` SHA256 `7fddbf9d11248c4294334666fae22d305fc11fa11bfaa4637b13da4bcbb7b6ab`，最终结果与失败日志另保留于同私有目录前缀。首次源码封存因文档未提交返回SOURCE_NOT_CLEAN，没有执行验收；提交后prepare/verify通过：3209文件、202份迁移源码，seal `4647e70a187359f07d68d198e3aaedbff57b53e1cdd01c6acc40917be391323a`。封包通过不等于运行验收通过。

已核现有CI只自动响应pull_request/main与push/main；生产部署仅workflow_dispatch，未调用。后续尚未取得PG授权的integration提交使用GitHub原生 `[skip ci]` 标记抑制本次pull_request同步触发，不修改workflow或门禁；[官方说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)明确支持该事件。跳过的检查不计通过、不能满足发布或main合并条件；真正PG及完整CI验收仍需另行授权并绑定准确候选。

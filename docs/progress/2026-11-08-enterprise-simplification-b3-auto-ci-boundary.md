# B3自动CI误触发与停止记录

本次已授权的B3 integration推送准确头为`fe70bb931e1dfba344d585acb311247f6156f292`，作者提交`bbb6e6c15fb600d7ca5f2630eb781c142662ee5c`、代码合入`27d14904b137e8fb8023f539dd1bd6d047507ee0`。merger遗漏已有的`[skip ci]`提交标记要求，触发[pull_request CI 42396726261](https://github.com/1131096740/intelligent-construction-management/actions/runs/42396726261)。Git推送授权没有授权PG/SQL执行；这是执行约束核对疏漏，不能归为用户新增授权。

原规则依据是[首次自动CI事件记录](2026-11-06-enterprise-simplification-auto-ci-boundary.md)末段、该fe70版本`PROGRESS.md`第63及108行，以及PR428正文。merger此前仅读账本首55行和范围授权，未完整核对该现有约束。原提交及CI历史保留，没有改写fe70、修改workflow、重跑CI或制造补标空提交。

发现准确SHA的PG检查正在运行后，已通过正式审批发送唯一`gh run cancel 42396726261`请求并获接受。最终run为`completed/cancelled`，开始时间`2026-11-07T17:31:25Z`、最终更新时间`17:32:23Z`；26个job中25取消、1失败（Release gates），活动job为0。失败与取消不计CI通过。

22个PG job中17个已启动，执行了runner设置、checkout、Node/pnpm、依赖安装；部分到PDF运行时准备期间取消。17个job的“Prepare PostgreSQL 16 dynamic gate image”及“Run exact-SHA PostgreSQL dynamic gate shard”共34个明确PG步骤全部`skipped`；另外5个job未启动、没有steps。现有元数据没有显示命名的PG镜像/实际分片执行；这不能被扩大为已经排除所有依赖脚本等远端PG/SQL副作用。远端runner、依赖及运行时准备确实启动过，不能再声称本轮远端零执行。没有手工清理GitHub runner资源或删除日志。

本机B3证据另计：代码合入27d独立82模拟、原CLI25、六CJS语法/定向lint通过；六源码仍等于最终复审manifest `ce0199b22d5060193607243c18857b637edb56ffb61666604fc0aa79a7dbc3ef`。fe70干净source-only封包为3278源码/202迁移/七SQL/一case，packet `725cb1d1470701058eeec3bcc27aa2d6df5bf6ac63861743a18103862180b09e`、seal `d26e5c5fad9dba9791532d9a4ba4f6ef9f690bd28466dfd1f267529bd029b960`。本机测试只执行源码/模拟，没有实际迁移或资源；不以本地结果代替远端CI或任务16真实PG验收。

原始必要元数据、完整job步骤及摘要保留在`/private/tmp/jg-382-task16-B3-merger-20261108/`：`final-ci-run.json`、`ci-job-steps-summary.json`、`postcancel-jobs.json`、`final-github-readback.json`、`REMOTE-CI-INCIDENT.md`。最终交接收据`final-handoff-receipt.json` SHA256 `dc858cfbd2eda96281b7123a6e03a10dd61b45b239e3e992af4b679a3e3107c8`，包含各证据SHA。PR428该次准确head为fe70、Draft/OPEN，checks为25 CANCELLED/1 FAILURE，不能写成空checks。

本次后继仅登记真实事故及更新账本两份文档，提交信息必须带`[skip ci]`；推前核最新提交完整消息及既有PR规则一致，推后按准确新SHA核Actions runs及PR head。新头未触发/检查为空也不是CI通过，旧fe70取消/失败历史不抹除。后继准确干净头fresh prepare/verify、外部packet摘要及远端回读另存同目录`incident-docs-*`收据，不把旧fe70封包当后继头封包。

#398保持OPEN，17/24与16/42/44真实验收门不变，13/45不变。未合main、部署或操作生产；没有因此放开新的PG/SQL或资源授权。

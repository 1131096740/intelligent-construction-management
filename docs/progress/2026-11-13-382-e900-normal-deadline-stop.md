# #382 / #398：e900 正常261单次期限停止

用户对新封存方案明确选择“授权单次，并允许失败后仅源码验证继续”。该授权仅对应e900/36cd普通付款案；5b05文书工具资格没有由此获准。原88a及ac721许可保持已消费，不能重用。

## 实际执行与终态

准确源码`e9006c603ba2282a961641b24b86c374d6c20589`、tree`a7e2c6cded34695a2d960ab2bc856eeaee51e2df`。主计划SHA`36cd7044e8177c9e2aca262377e08f47ecb8fae78e4edf773f4847b6a1c94965`；侧计划SHA`ac97761ee890966896e5bc3b2ebdc228ee581d8021da37fdbe586151b603ad3f`。准确CI43370833128 fresh回读32成功，源码clean、计划/观察器摘要及空run相符；canonical环境的helper verify261退出0、stderr空后，仅执行原once命令一次，session32989。

同会话已退出1，终态chunk3e9c00。原`run/receipt.json` SHA`5c985b07b1ef012dcbec0e436e00d41a6f0fd819aad41c374d5fdf2a7df7cc6a`：STOPPED、onceAttemptConsumed=true、PAYMENT_INSTALL_ONCE_ABORTED_UNSETTLED，failureStage=ownedApplication。资源期限触发为RESOURCE_DEADLINE、3601234ms；总墙钟3644270ms（60分44.270秒），其中前置42584ms，终态整理450ms。资源限额保持3600000ms，未延长或重试。

business=null、paymentCaseFailure=null，未进入seedAndSelectedCase，因此不能认定实付/核账通过；也不能把旧88登录AFTER_CHECK、旧ac721的42501或本轮不存在的HTTP状态作为新首因。execution/native/financial admission均false。

粗粒度区间为technical261=1613777ms、liveSessions=629375ms、ownedApplication=946583ms，另有角色/七片段/ACL/B7等区间。每个区间包含其边界守卫与资格核验；这些数字不提供SQL、CPU、Nest或具体内层等待的独立归因。实际内层期限耗尽原因仍未确定。

## 同轮独立清理与证据边界

控制器清理报告completed。原prepared观察器6d364在进程终态、receipt/manifest绑定核对后仅执行一次，退出0；`/private/tmp/jg-398-cleanup-observer-e900-20261113.ks37qjo6/OBSERVATION.json` SHA`f9f2ab388a9f9ec5011980ba5e88529b613fed6dc2370e76a2bfc247fcdbb245`。

其固定Docker subprocess先核同daemon，再对准确容器ID/锚定名称/run标签及网络ID/run标签作五项只读查询，均为空，status=EXACT_OWNED_RESOURCES_ABSENT。记录卷0，未查询卷；没有资源mutation或重试。凭据/私有材料擦除及relay的其他状态仍属于控制器报告，不扩称独立物理核验。

授权、前置、实际会话原结果列表、终态及清理绑定在`/private/tmp/jg-398-e900-authorized-once-20261113.svq45c6i/`。TOOL-CALLS-OPERATOR-TRANSCRIPT.json为执行后从本对话逐字转录的命令/工具结果，不冒充OS审计轨迹；独审核其once命令及CWD与封存提案一致、initial/terminal结果与原列表一致。独立复核及该补录边界：`/private/tmp/jg-398-e900-stop-remote-independent-20261113/REVIEW.md`。不重新执行observer或已消费的once来补证。

## 获准的后续SOURCE工作

用户已预先允许失败后源码诊断、必要最小修复、本地自动验证及常规CI继续；不启动新的资源/付款实测、Java/LO工具资格、数据库迁移或COS。fresh诊断树`/private/tmp/jg-398-e900-deadline-diagnosis-20261113`从e900开始，原正常付款、工具资格与88封存树/依赖/构建/计划不改。

只读调用链与SOURCE成本采样发现重复完整核验和模块图遍历候选，但采样的新物理闭包不同于本轮封存构建，不能转移成本或宣称实际期限根因已解决。另经真实公开observe/claim/material.check的受控FS竞态模型，实证外层stat后权限变化仍被完整检查接受；该确定问题的最小SOURCE修复及回归另行固定提交，不与实际deadline通过混算。

[#398停止记录](https://github.com/1131096740/intelligent-construction-management/issues/398#issuecomment-6848106765)、[#382记录](https://github.com/1131096740/intelligent-construction-management/issues/382#issuecomment-6848107297)及Draft当前前缀已同步，原CI成功与本次actual失败分开；历史正文保留。#394/#398仍OPEN，完整45任务尚未完成。本轮无main合并、部署或生产操作。

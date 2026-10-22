# 接管修复交付CI诊断

本批源自d5f8fd1e4b2ab9e46e80581000d198606c5bbdc6，PR #368。当前生产部署授权持续有效；必须先解除每项阻断并重新取得准确新SHA资格。

## 首轮失败证据

准确候选592fd342e1aa52c677f85ad01333ed3313a73e2e，CI39811855197：20项成功、2项失败、4项取消。后四项分别为project_expense_execution、necessary_expense_reserve_pol279、contract_settlement_v2、general_procurement；日志显示仍使用http://azure.archive.ubuntu.com/ubuntu下载字体、LibreOffice或浏览器运行依赖，预算20分钟结束时被取消。Release gates按矩阵失败关闭，不能把取消算通过。

## 镜像准备修复

复用既有三组已测试的规则，在所有PG16运行依赖安装前处理同一apt-mirrors.txt：只移除精确Azure HTTP镜像；必须已有正式HTTPS archive/security回退；不修改签名源、密钥、套件或其他镜像；缺少回退时保持原文件并失败。不存在镜像表时保持原路径。将原七类文件夹具绑定到公共准备步骤，并断言所有运行依赖步骤受其支配。新增检查在旧工作流先失败，修复后通过；完整编排322/322，无跳过。预算和重试不变。

## WebKit仍待明确

同轮employee_onboarding中入职场景通过；花名册手机用例等待项目59选项visible/enabled/stable直到30秒总预算到期。CI未上传trace。原候选本机分片22/22、桌面手机均通过；相同Playwright1.64.0/Linux amd64 WebKit2370真实浏览器的隔离诊断亦通过，只证明未复现，不能证明历史根因。字体、阶段预算与帧调度作为分别验证的假设；不得据此进行猜测性产品修改。

暂时在原花名册E2E失败时输出中文阶段开始时间和总耗时，未读取密码、令牌或业务内容，不添加等待、重试或改变断言；确认根因后移除临时探针。诊断副本及完整日志/trace只留本机私有证据，不公开认证数据。

本记录不构成新候选CI或生产通过。未进行本轮备份、生产迁移、部署、审批、付款、真实签名维护或旧草稿操作。

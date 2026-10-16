# PR #331 业务浏览器超时诊断

## 当前结论

本记录对应 [Issue #332](https://github.com/1131096740/intelligent-construction-management/issues/332) 与 [PR #331](https://github.com/1131096740/intelligent-construction-management/pull/331)。根因尚未证实，PR保持草稿，不以重跑或诊断候选CI通过代替修复。未改业务权限、Schema或生产，也未重新部署。

SSH断连修复的已发布版本及生产验收见[独立验收记录](2026-10-16-deploy-ssh-disconnect.md)。该验收结论不能替代本浏览器故障的关闭条件。

## 原始故障

候选 `2371b97ffeea459320da6f36ddeb8972fddc169b` 的 [CI38907742854](https://github.com/1131096740/intelligent-construction-management/actions/runs/38907742854) 两次均在 `pol113_pol115_business_entries` 分片失败：

| 运行 | 故障 | 失败现场 |
| --- | --- | --- |
| attempt 1 | 手机首个零采用例，等待“新建采购申请”点击，总用例预算45秒耗尽 | 路径为零星采购工作台，标题仍是默认标题，app为空，readyState complete |
| attempt 2 | 相同用例、相同行和预算 | 路径为/login，登录表单已渲染，readyState complete |

两轮桌面零采和桌面/手机退款用例通过。原日志没有各次导航耗时、会话存在性及失败trace，因此不能推断按钮实际等了完整45秒，也不能仅凭/login断言会话无效。两轮失败保留，不改写为成功。它们与PR #330合作单位POST等待超时是不同故障。

## 已完成的诊断与检查

- `0c9be2a5` 增加失败前的导航、请求失败、HTTP错误、页面异常及会话存在性记录；不记录会话值、请求头、查询参数或响应体。其业务分片通过，但整个CI被后续推送取消，不报全门通过。
- `c030ae55` 增加每端5个独立上下文启动样本，ARM Linux原业务链和新增样本共14项通过；[CI38917872757](https://github.com/1131096740/intelligent-construction-management/actions/runs/38917872757) 23项全部通过。此时新增样本位于业务链前，会预热Vite，不能据此关闭原故障。
- `7fcd3047` 恢复原业务用例先执行，记录goto/reload阶段、相对耗时和最多40个未完成请求路径。固定提交双轴增量审查均0未决。
- 后续将启动样本改为业务链完成后的独立Playwright调用，`--repeat-each=5`使每端5个样本使用不同worker/browser。原4项业务断言、真实HTTP/PG16、45秒单用例预算、180秒父测试预算和零重试保持；本机原PG16三项、业务4项、启动10项通过，API及E2E类型、API lint通过。

## 私有实验的证据边界

原本机完整链、原Linux ARM浏览器链及多个入口循环通过，不能代表GitHub的Ubuntu/x86_64现场。Ubuntu24/x86_64私有实验运行于ARM宿主的模拟环境；其真实API/PG16夹具虽相同，浏览器驱动与原CI仍有差异。

去掉诊断TCP代理后，15次循环中2次在goto/reload的30秒等待内发生模块挂起，readyState interactive、app为空、会话存在。独立HTTP读取挂起模块可返回200。200毫秒登录模块延迟及等待登录按钮可见的对照仍出现挂起，不能提交为修复。上述故障阶段与原CI不同，尚未证明同根。

请求取消在成功样本也普遍出现，不能独立证明根因。一次路由拦截对照在运行中修改了私有Vite配置，存在重启污染；另一次样本由诊断人员主动中断，均不计作原故障复现。浏览器拦截会关闭HTTP缓存，不能把其通过直接归因于延迟。

原件仅保留在 `/private/tmp/jgzg-pr331-browser-diagnosis/` 和 `/private/tmp/jgzg-ssh-release-20261016/`，不上传原始会话或完整网络凭据。

## 关闭条件

1. 捕获与原CI相同的失败路径及阶段，证明触发机制；相似的模块挂起不能替代。
2. 在真实入口建立先失败、修复后通过的回归，并复验原业务链；不能放宽预算、增加通用重试或跳过原断言。
3. 完成固定修复提交的双轴审查与CI，再合并并确认准确main CI。
4. 更新本记录和PROGRESS，分别标明本地、GitHub、SSH既有生产验收及未执行事项。

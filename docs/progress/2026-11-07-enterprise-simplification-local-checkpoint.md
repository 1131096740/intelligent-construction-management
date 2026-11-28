# 10/16本地实施检查点（2026-11-07）

仅记录私有工作树分片证据；本集成分支未纳入10/16业务代码，两票未关闭。当前13/45按阶段边界关闭。不是准确集成头全量验证、SQL迁移或资金提交安全验收。

## 当日后继检查点

- 10同一公开行为用例先在旧版实际失败：完整Word等价检查、8089个正文字符关联、原row108和5.4pt间距及严格schema2均通过后，两PDF表宽差2.800013pt超出原0.1pt容差。新版最终Word在同层保留start/end并按正式元素顺序添加等值left/right；该同一文件上传并送原Java81/r2转换。原用例未改，复验两表宽差均0，通过1/1；API类型/full lint通过，源码body3f4c56c0、service ede3a33e、processor3c999665。日志SHA 860f15fbe59c742607a82feb95753dcee1f5d456d298eff7095e601d9310cf7e，收据 /private/tmp/jg-task10-evidence-20261106/logical-margin-first-public-green-asrun.json。旧版本实际兼容、缓存和不支持内容拒绝仍须新版后继验证，不能将下方旧阶段收据直接移至新版；两次合成清理warning保留，不计清理通过。
- 16准确冻结32源包f5b474062a1ed6ab7ca2e039bc42940200016ad04ad1007c924066c6674b7746：两目标2/2、完整62/62、API类型/full lint通过，收据SHA a5bf734903d3a1f8b0d963bae80f9f64486814ad6bee3919419f710fa8fe015f。原审查员在 /private/tmp/jg-task16-operating-scope-p1p2-incremental-review-20261107.md 确认后来Fact/Impact的延迟完整性入口、校验后CAS前的Project UPDATE NOWAIT两项Closed at source；32文件首尾无漂移。SQL安装、真实触发器/锁/ACL/COMMIT及错误映射仍未执行。
- 16上述包与13项Web源并集41项，4次独立新服务中的分次40元、历史原结果查看桌面/手机均通过，原30秒/5秒/0重试条件保持；源码首尾和实际加载绑定一致，8个自有服务退出0。收据位于16私有树 apps/web-admin/test-results/task16-current-scope-compat-20261107/receipt.json。普通场景仅NULL经营启用范围；历史场景已有原B付40，浏览器新增POST为0，不代表整个准备过程零付款，不声称任务34激活或凭证字节本轮重验。资金更正清单新UI仍待验。

以下是保留的早先阶段记录；“尚未实现/待复审”等时间态由本节明确后继更新，不改写旧收据的源码身份。

## 任务10

- 布局阶段文件指纹body 1a77c6e5、service 1a4502c8、processor 801d6f1f，正式44be母版未改。45项被拆为45张小表的公开反例保留；修复后完整公开保存、排队、处理、双格式授权下载通过。实际DOCX46行、PDF17页；严格字形、A4、45项含045、总价1035、手改及签署文字通过。未测原生Word分页。
- 旧无布局标记任务真实Java81/r2输出保留3表[2,2,1]，与当前正文[3,1]区分。独立旧成功记录下载字节、引用及指针守恒。新版键不复用旧完成任务，同新版重复请求复用同任务；缺失和未知布局版本明确失败且0 Word读取、0上传。
- 已接受的旧公开开头锚点手写条款经保存/重读/新队列冻结验证，位置和一次性内容保留；不泛称结尾锚点或该条款实际PDF通过。
- 新增条款完整保存链在1366桌面、390手机各1次通过：真实插入位置/文本、未保存提示、PUT/GET、服务器编号、旧手改、刷新及金额只读。删除、重排、重建、换模板/空位确认及其余UI仍待完成。
- 独立格式实验以两份自有generic模板源生成两组新文件，Word全部文字/属性除4个等值边距别名外一致。两PDF各8085字符源序绑定，两表宽差2.800013pt；签署行108twip例外保持。已定位global logical-margin解释差异，新版修复尚未实现。旧0.1pt几何失败、准备器误计2个而实际3个margin节点的工具失败保留；不宣全排版/字体/签署通过。

主要私有证据：
- /private/tmp/jg-task10-evidence-20261106/formal-45-layout-pair-asrun.json，日志SHA 549d171d598943853dcfbcf03f5587613af72ef66da7f7819b560246487e9079。
- table-layout-legacy-native-asrun.json，日志SHA c430239ab513d8f374e2602f993fdc59fcf0165615551b81c625b488219f40a6。
- table-layout-cache-asrun.json，日志SHA 738d3324af4408f626e486cfbec8fdc1501a59ddfc9af60e33e3839ff2ef47da。
- 新增条款双端日志SHA b5dc6b4f69981496d6e04461af97c06624bb8ab337b9f70d652d893e47071755。
- /private/tmp/jg-task10-independent-physical-reader-20261106/S0-readonly-geometry-and-cleanup-handoff.json，SHA 11afe6b09ac5822bb34e2a9e896c7703f485fa8e0afe6df7f7e8f45bf39b910d。cleanup warning系合成文件锁投影未支持，不计清理通过。

## 任务16

- 合同历史与资金期初独立确认；无逐笔证明时须明确未计入、原因与依据并冻结服务器历史版本/指纹。缺失、不确定、已含、旧指纹拒绝；合法新30元时历史40元保持、余额70元。原键/同源结果优先，未来历史或marker变化不重写旧事实。
- 已实现历史集合revision的应用/Schema/准备SQL，缺marker失败关闭、不运行时补造，版本变化可拒绝金额还原后的旧确认。当前都是合成坐标，不证明数据库触发器、NOWAIT、权限或提交。
- 经营轴分片62项HTTP实际通过及API类型/full lint通过；旧476项按逐文件和精确逆差分桥接，不能写538项最新全跑。Shared14另为原准确同字节桥接。NULL经营启用日期的合法B付40仍唯一A欠B40、A100/B60、余60，无虚构经营投影。
- 真实浏览器通过历史三态阻止、新30完整登记、旧依据409后刷新清确认保填写再人工重选同键201；各阶段源单独绑定，后续经营轴/锁序变更不自动继承为新头UI通过。
- SQL窄审第一轮的往来根缺席和名称解析两项已在源码层补修复审；后续经营轴审查又指出后来投影缺少延迟入口、Project共享锁升级等待环风险。最新补修仍待验证，旧Closed at source不冒最新终审。
- 经营适用状态仅服务器真实native DATE冻结，不以日期或客户端布尔猜；往来始终完整，未启用不造报告Fact，已启用及后来合法投影完整校验。SQL、锁序、ACL、编码、触发器、COMMIT未验，7片不可推广为可迁移脚本。
- 真实PG专用driver/sourcecases/库存、父owned资金账户新UI、完整治理/build/clean候选/最终双轴审查仍未完成。

私有证据：/private/tmp/jg-task16-evidence-20261106/operating-scope-current62-stage-receipt.json，SHA d5e1ffbb3411fee2651188ce217c86f793dc08b5a666af8d7905c2a9dcb3b169；/private/tmp/jg-task16-operating-scope-incremental-review-20261107.md，冻结包SHA 162da22a2dd79c5cfed5f9ec16f03cc87557f2dac9a7f252f609d944304be2e4。后继P1/P2候选包ba9da16a8c8edb40c75ee391e1b2bfc1c163bb6a561ab57c8fe25fc6f1697e3a当时仅SOURCE READY，不冒62已在该包全跑。

## 保持的边界

原dirty工作区保留。仅已授权本地实现、合成公开测试和范围内Git流程，不合main。私有10/16未运行真实PG、资源、SQL迁移、真实短信/银行/COS/交易、部署或生产写。先前旧中央自动CI确有部分PG执行，已取消并保留[事件收据](2026-11-06-enterprise-simplification-auto-ci-boundary.md)；不能扩大为整个会话远端零PG。

16不因合成关闭；真实PG资金门及42/44保持。12仍等10。旧失败、源码和真实产物保留，新候选须核准确新源的必要门。

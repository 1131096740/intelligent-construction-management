# 五包阶段 D：C-P0-01 私有文件与手写签名动作清零回执

## 1. 结论

阶段 D 已正式启动，首个风险组 `C-P0-01` 已在唯一候选分支
`codex/five-package-go-live` 上完成本地确定性清零。阶段 C 登记的 4 个
`API wrapper × production consumer` 目标均已从未覆盖清单移除：

1. `ArchiveListPage.vue × createPrivateFileDownloadTicket`；
2. `SettingsPage.vue × uploadCanvasSignature`；
3. `JgSignatureHandoff.vue × createCanvasSignatureHandoff`；
4. `HandwrittenSignaturePage.vue × completeCanvasSignatureHandoff`。

四个动作均已登记为服务端派生能力，页面触发器受该能力支配，调用因果链可解析且
`causalVerified=true`。本组不再存在阶段 C 所列的文件越权、签名入口漂移或签名版本
审计缺口；整站仍有后续风险组，因此 Task 11、阶段 D 和五包整体仍为未完成，下一步
只能进入 `C-P0-02`。

## 2. 修复边界与后端不变量

### 2.1 私有文件下载

- 新增已认证的 `GET /files/:fileId/download-ticket-capability`；它读取精确文件并复用
  创建下载票据时的同一套 `assertCanDownloadFileObject` ACL，不复制一套前端岗位规则；
- 资料库只在该服务端能力返回 enabled 后渲染 TDesign 敏感下载对话框；读取失败、403
  或失效能力均失败关闭；
- 生成票据仍由既有 POST 在服务端重新校验当前密码、文件 ACL 和下载原因，并写下载审计；
- 对话框同时收集密码与下载原因，替代浏览器 `confirm/prompt`，保留明确二次确认；
- 多行能力请求用 request id 隔离迟到响应；重复确认共用同一 Promise，避免重复票据和
  重复审计。

### 2.2 手写签名

- 新增已认证的 `GET /me/signature/canvas-capabilities`，统一发布本人上传签名和创建桌面
  二维码两个动作；能力读取失败时移动端签字板和桌面二维码生成按钮均失败关闭；
- 桌面端访问设置页不再自动创建二维码交接记录，只有用户点击“生成手写签名二维码”
  才写入；重复点击共用同一 Promise；
- 手机端从交接状态读取 `complete_canvas_signature_handoff`，只有未过期、未作废、未完成且
  属于同一账号的 token 才显示签字板；真正提交时后端再次校验并以 `FOR UPDATE` 锁定；
- 每次有效签名继续创建不可变 `HandwrittenSignatureVersion`，用户当前签名指针、二维码完成
  状态和新增 `me.signature.canvas.update` 审计在同一数据库事务内提交；
- 审计使用签名版本 ID 作为业务 ID，并记录直接上传或 handoff 来源、文件 ID 和 handoff ID；
- 直接上传、二维码创建、二维码完成和下载票据确认均合并重复提交，避免双击造成动作漂移。

文件对象上传发生在业务事务之前；若后续签名事务或审计失败，签名版本、用户当前指针和
handoff 完成状态全部回滚，不会形成可用签名漂移。可能残留的未绑定私有文件继续由既有
私有文件保留/清理机制治理，不作为审批签名版本使用。

## 3. TDD 与回归证据

### 3.1 RED

- API 首轮用例因缺少签名能力、下载能力和签名版本审计而失败；
- Web 首轮用例因缺少服务端动作门、四个动作登记和私有文件 capability wrapper 而失败；
- 独立并发复核先证明二维码创建、直接签名、handoff 完成和下载确认没有共享 Promise；
- 资料库异步能力复核先证明跨行迟到响应没有 owner/request 隔离。

### 3.2 GREEN

| 验证 | 结果 |
| --- | --- |
| API `me` / `file` service + controller | 4 suites，296 tests passed；含 audit failure 不返回成功 |
| Web API、结构、设置、签字板、资料库定向回归 | 5 files，153 tests passed |
| API typecheck / lint / build | 全部退出 0 |
| Web typecheck / lint / `check:ui` / production build | 全部退出 0 |
| E2E typecheck | 退出 0 |
| Chromium + WebKit 动态验收 | 6/6 passed |

浏览器动态验收覆盖：

- 390×844 手机设置页由服务端动作开放签字板，真实 canvas 指针轨迹生成 PNG 并单次提交；
- 1280×900 桌面设置页先显示显式生成按钮，再生成同源二维码并在完成后回刷状态；
- 资料库 capability 首次 403 时不渲染敏感对话框，随后授权成功后才显示密码、下载原因和
  确认按钮，并验证 POST 请求体及成功回执；
- 当前 production build 的登录入口、ICP备案与公安备案链接在应用内浏览器可见。

上述页面用例使用本地 production preview 和受控 API 响应，不连接生产、不使用生产账号，
也不写入生产或本机业务数据库；后端 ACL、事务、锁和审计由 service/controller 测试证明。

## 4. 六份能力清单变化

| 项目 | 阶段 C 基线 | C-P0-01 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 399 | 401 | +2 个服务端 capability GET |
| Web wrapper / binding | 388 / 408 | 390 / 410 | +2 / +2 |
| 页面动作 / binding | 59 / 84 | 63 / 88 | +4 / +4 |
| 已覆盖 mutation consumer pair | 30 | 34 | +4 |
| 未覆盖 mutation consumer pair | 247 | 243 | **-4** |
| unresolved binding | 20 | 20 | 0；均属于后续风险组 |
| 未分类路由 | 0 | 0 | 保持 0 |
| 严格矩阵 raw blocker | 310 | 306 | **-4** |

`route-usage.registry.json` 的确定性期望已同步到新增的两条生产页面读取路由；route usage
恢复 `READY`。六份清单普通 `--check` 均退出 0，整站严格矩阵仍按预期为
`BLOCKED / 306 blockers`。验收采用“本组四个精确 pair 为 0”作为主判据，没有用总数
下降替代目标清零。

## 5. 操作边界与下一步

本组未连接生产、未启动数据库、未执行迁移或业务数据写入、未合并 PR、未部署、未改动
生产配置，也未触碰受保护的五包源工作树。当前只形成候选分支上的独立本地提交；是否推送
新候选 SHA、触发 PR CI、合并或部署仍需按既有授权边界另行执行。

下一步严格进入 `C-P0-02`：合同草稿、工作台、合同生命周期与历史接管。其 85 个 uncovered
pair 与 11 个 unresolved binding 必须先按共享后端不变量和真实页面动作进一步归并，再逐个
可验证切片清零；不得跳到 C-P0-03，也不得把本组回执写成阶段 D 完成。

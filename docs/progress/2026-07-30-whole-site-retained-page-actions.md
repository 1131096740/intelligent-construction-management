# 实施包 5 Task 11：首批保留页面动作闭合

## 结论

本提交只闭合能力矩阵中六条明确保留的页面写动作，不把实施包 5 Task 11、
Task 12 或五包总门禁标记为完成：

1. 业务模板已发布版本风险停用；
2. 版式模板已发布版本风险停用；
3. 零星采购异常终止发起；
4. 零星采购异常终止确认；
5. 零星付款发票附件作废；
6. 零星采购收货 PDF 重新生成。

六项均由服务端 GET 读模型下发精确 `availableActions`，页面不按岗位或状态自行
放行；确认时锁定模板版本、采购、付款和发票坐标，路由切换会关闭或失效旧确认。
对应写服务继续执行原 controller guard、事务状态门、CAS/业务坐标校验和审计，
没有放宽正式记录、历史引用或文件保留规则。

## 机器证据

页面动作检查器新增严格 Vue capability ref 数据流：

- 只接受从 Vue 正式导入的 `ref(null)` / `shallowRef(null)`；
- 只接受同一个正式生产消费者可达的 GET/HEAD wrapper 来源；
- 允许空值复位和 request/await alias；
- 基于解析器 scope manager 区分同名局部变量，并沿受保护集合的父子路径、数值或
  动态下标、`find` / `at` / `filter` 等 selector、spread、副本元素、callback
  参数（含原数组、rest/default 参数）和 alias 继续传播对象来源；
- local concise-arrow/helper block、对象 member helper、method 提取、静态解构、
  object spread、IIFE 和声明式/赋值式 helper-object alias 只把返回引用传播到
  后续使用；受保护 getter 经未知参数、对象/数组与 spread 容器、条件/逻辑/
  sequence 分支或高阶返回逃逸均失败关闭；direct GET 绑定和 Vue ref 写入使用
  同一不可变门，服务端响应经嵌套属性或多级局部 alias 流入 capability root 时
  会反向追踪全部 provenance ancestor，只有未被局部绑定遮蔽的原生
  `structuredClone` 可建立深拷贝隔离边界；四个生产页面均已把 capability 原对象
  与普通 UI read/edit model 分离；
- Vue `computed` 对 expression/block/named/conditional getter、writable options
  的 `get` 及直接 `.value` 链建立 synthetic taint，只读 selector 允许通过，
  options 中非 `get` 的受保护 callable、后续改写或逃逸仍失败关闭；递归解析固定
  最大深度，深度或节点循环预算耗尽返回 unsafe sentinel；静态对象 member
  summary 以安全 tombstone 保留对象字面量源顺序，普通安全赋值只有在 Program
  顶层、先于同一对象全部 direct alias 上该 member 的使用且不跨 deferred
  callable 时才可清除 taint；identifier 重绑定同样只允许这种确定执行并支配
  目标 binding 全部 member 使用的安全来源清除旧 taint，受保护来源保持单调传播；
  条件/短路/未调用函数中的安全写保持失败关闭；每轮净状态保证固定点收敛；
- Vue template 同步纳入受保护路径：自定义组件 prop、自定义 directive、
  event 调用参数和 inline 写、`v-model`、`v-for` element alias、未知或可变
  member call 均失败关闭；只允许已知 primitive 字段、只读 selector 和已完成
  独立信任证明的 `BusinessDraftAction` action collection；
- `BusinessDraftAction` 的可信结论绑定精确 `props.execute`、顶层
  `selectedAction` ref 和受 guard 保护的单一非空写入；`Object.assign`、
  `Reflect.set`、ref/action alias、key 改写、逃逸或额外伪造写入均失败关闭，
  仅允许空值复位；
- 同一 action 复用 wrapper 时继续追踪事件 literal、helper 参数、对象/数组
  容器、member path、条件与 sequence 中的动作 variant；wrapper 参数未携带
  registry 声明的精确 variant，或 approve 路径实际提交 reject，均不会取得
  `causalVerified=true`；
- direct `eval`、解构或循环 assignment target、`valueOf`/receiver
  self-return、callback `arguments`、`call`/`apply`/`bind`、class 继承与字段、
  跨模块 value export、动态 computed/iterator access 及 `toSpliced` 等保留
  引用变换均有失败回归；
- 对 `Object` / `Reflect` / `Array`、对应 prototype、`globalThis`、mutator
  alias/容器/member/helper 转发、sequence/conditional target 和
  `Proxy(globalThis)` 建立有执行顺序的 runtime intrinsic 完整性检查；覆盖
  `Proxy.revocable`、`Reflect.construct(Proxy, ...)`、bound Proxy、local/
  imported factory、递归/对象方法返回和动态解构，权限来源只有经 Program 顶层
  无条件覆盖为普通值后才可安全清除；不再豁免任何固定或动态
  `__JIANGKONG_*__` 运行时扩展键，写入全局对象一律失败关闭。原浏览器历史滚动
  注册已改为模块内逐 Window installer，并在 HMR dispose 时移除具名
  `popstate` listener，不需要修改 Window；
  `.call` / `.apply` / `.bind`、动态 `eval` / `Function`、原型或全局改写均
  失败关闭，已明确覆盖被安全值支配覆盖的陈旧 alias；
- 混合 GET、POST、本地伪对象、深层写、`Object.assign`、父容器/元素/别名/
  callback 改写、参数逃逸、丢弃 GET 后伪造及非当前生产消费者全部失败关闭。

Web wrapper 生成器同时新增 GET/HEAD 返回来源证明：只把所有返回分支均可追溯到
同一主请求响应的 wrapper 标为 `transparent_main_response`，局部对象/数组、
spread、`map`、未知 helper、循环、陈旧 alias、compound assignment 或多条不同
主请求边均保守标为 `unverified`。当前 100 个 GET/HEAD wrapper 中 87 个透明、
12 个下载型 `none`、1 个投影型 `unverified`（`fetchVatRateOptions`）；页面动作
分析器只信任 87 个透明 wrapper，缺失或非法枚举不会建立服务端来源。transport
绑定另覆盖 expression/comma/conditional assignment、对象属性后写与安全覆盖、
object/array assignment，以及声明、赋值、函数参数中的 nested/default/rest
解构；import/local shadow、分支/异常/循环合并、`call`/`apply`/`Reflect.apply`
与浏览器网络原语 alias 均失败关闭。实时总计保持 375 个 transport wrapper、
3 个 pure wrapper、376 个主请求绑定，返回来源为 357 transparent、6 unverified、
15 none，无新增 unresolved。

六项页面调用同时锁定不可变实体和 operation owner：模板停用锁定模板/版本，
异常终止锁定采购，发票作废锁定采购/付款/发票，PDF 刷新锁定采购；同路由切换
版本、跨路由 A→B、同实体重叠请求、stale preflight 和 wrapper 同步抛错均有
运行时回归。旧 Promise 不能关闭新对话框、覆盖消息/错误、触发刷新或清除新操作
的 busy。收货页只读取服务端指定的当前 `real_payment`，不回退历史付款；付款
详情的 payment/procurement 坐标不一致时不发布 capability。

六项生成结果均为：

- `serverDerived=true`；
- `dominatesTrigger=true`；
- `causalVerified=true`；
- 精确生产消费者为对应模板页、零星采购详情页或收货页。

四清单已按 Web wrapper → route usage → page action → capability matrix 顺序重生成：

- `web-api-wrappers.json` SHA-256：
  `560ab05970a24830add6a3fec03292a8cd63a1b6c0ba60f9947f2e55caeb22bf`
- `route-usage.registry.json` SHA-256：
  `843d938495b4f52b781d74fe0d1c62b5c6e8ca339389601b1e2052a94f669c46`
- `route-usage.json` SHA-256：
  `18889b8b15be66c4fd15822f3fcf64de0ffa8f1e006505c964039bd549dc308d`
- `web-page-actions.registry.json` SHA-256：
  `1ad898cd2d6838477db9999231f06668739d2d38e6bd7388e092a0523dd4615e`
- `web-page-actions.json` SHA-256：
  `6fe8ee6f8fa649c6d48f41ec0989fd43c32eb64ed41165e29bc9a590e8a98764`
- `whole-site-capability-matrix.json` SHA-256：
  `22626d5c7f392abddb0e7bd050db01f14a33088baddfcd0eb80eb17c06e21cd4`
- `whole-site-capability-matrix.md` SHA-256：
  `37fa4b9a8bcb5641f316d811c2f1573b7c5e6090539132da34d6c64a5f966b23`

路由用途由 32 条未分类收窄为 26 条；Web orphan wrapper 由 44 条收窄为
42 条。新增六个正式 mutation consumer 后，全局 pair 总数由 269 增至 275。
分析器仅在同一生产消费者内具备严格服务端 provenance、支配和因果证明时保留
局部可信结论，不再让无关的全局 upstream blocker 抹去局部证据；因此六项
binding 当前 accepted/covered 均为 6。上游 Web manifest 仍因 42 个 orphan
wrapper、4 组重复写封装和 1 条已失配请求而保持 blocked，page-action 与最终
capability matrix 也分别以 352、384 个 blocker 保持 blocked。page-action
新增的 6 条是 variant 因果证明收紧后对其他既有动作的真实失败关闭，不是六个
目标动作回退；六项本身均无
action-specific blocker；accepted=6 只证明这六项，不代表 Task 11 或全站门禁
完成。

业务模板风险停用使用父模板行与精确版本行的统一锁顺序，并在同一事务复核启用
映射；场景映射新增和重新启用使用同一锁顺序及显式 Read Committed，避免
risk-stop 与映射并发提交后留下“已停用模板仍新增启用映射”的状态。版式停用
继续以 `published` 状态 CAS 收口。专用一次性 PostgreSQL 16 已从空库应用全部
109 个迁移并通过 `migrate status`；三个独立 Prisma client 分别执行两笔事务和
只读观察，四种顺序（stop→create、create→stop、stop→reactivate、
reactivate→stop）均在 `pg_stat_activity.wait_event_type=Lock` 后才释放第一笔
事务；双方 PID 与 `pg_blocking_pids` 精确证明第一事务是第二事务唯一直接
blocker，失败后再以第三事务取得同一模板、版本、场景和映射锁，证明拒绝路径
没有遗留冲突锁，并验证一笔成功、一笔按业务不变量失败、最终状态与单条审计
守恒。目标 7/7 通过后容器和临时目录均自动清理，没有用 mock 调用顺序冒充
并发证据。

## 验证

- API 模板、版式、场景及零采读取/收货目标：182/182；
- 模板页、版式页、零采页面和路由目标：135/135；
- Web API analyzer：24/24；
- page-action analyzer 主测试 56/56、CLI 3/3（合计 59/59）；
- 六份 manifest 测试合计：172/172；
- PostgreSQL 16 模板停用 × 场景映射真实并发：7/7（其中活体交错 4/4）；
- 四份生成器 `--check`：均按真实 blocker 返回 blocked，产物一致性通过；
- Nest 运行时路由对照：395 条；
- API build：通过；
- API typecheck、API lint、`check:business-errors`：通过；
- Web typecheck、Web lint、`check:ui`：通过；
- Web production build：通过（保留既有大 chunk warning）；
- Prisma validate / generate：通过；
- `git diff --check`：通过。

## 未授权与剩余门

本地 Task 11 改造未 push、合并、部署、执行迁移或写入业务数据；未执行 Task 12
代码退出、业务草稿 purge、正式记录/审计/checkpoint/旧表旧字段物理删除。
temporary-only retention 是另一次独立、精确授权的生产操作：9 条
`contract_bill_import_preview` 已在逐条无引用复核后删除，04:30 timer 已启用且
环境开关固定为 temporary=true、business=false，未来只处理既定六类
temporary-only 对象；详见
`docs/progress/2026-07-30-temporary-retention-first-production-cleanup.md`。

分析器仍有两项明确的保守限制，不构成 fail-open：named whole-collection helper
的纯只读返回仍会失败关闭；服务端 origin 已流入 capability root 后，即使 origin
binding 随后确定重绑到安全 fallback，其后写入也仍保守失败关闭。两项后续可在
不放松 immutable provenance 的前提下做 flow-sensitive 精化，本批不据此扩 scope。

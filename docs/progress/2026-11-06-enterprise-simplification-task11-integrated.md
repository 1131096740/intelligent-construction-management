# 任务11本地公开边界整合收据

2026-11-06。用户已确认模板上传/解析/映射确认/维护停用/新草稿选用公开HTTP、公共服务及真实浏览器，实际DOCX/PDF与合成数据库/私有文件适配器。按该边界关闭#393，不代表真实PG、发布或生产合格。

## 准确源码与独立审查

- 集成 `4327a75f2f01f744e6e05223047d52829468f3d5`；候选 `cd6eba5a40a6c3b778be7a3b36414f8a7afd3eb0`；tree均为 `a6d19cd17b460526ff1564599216fcebbdb6d6f1`，独立merger确认相等且工作树干净，已推送PR #428，仍Draft/空checks不算CI通过。
- 原f797完整业务审查0/0；新增10份测试/检查器/说明以2863为固定点另做独立Standards/Spec，各0。产品转换器/processor/extractor未改。
- 源码prepare/verify：3135文件/198份迁移源码，seal `373147fd86e2ca72b981e331520dd5e70e4b6efbd0c0162b8988a19c7b0c0cc1`。该清单不含运行依赖闭包或迁移执行证明。

## 新跑与继承分开

新跑5套26/26（普通/同段重复主管浏览器、选版浏览器、公开HTTP/真实worker/legacy及历史文件隔离），12份实际PDF逐一检查draw glyph、非零/非空轮廓、仿宋/TNR家族与嵌入、A4及栅格；重复映射worker和同一成功历史文件另由独立整合者查看实际页面。

fresh API build、API类型/lint、治理7写7核及contractMutation80、原369一次通过（0失败/0跳过，约10.14秒）。709路由/663wrapper/702绑定/407动作/0阻塞；测试服务54811/54812已无监听。

旧API630/4项原PG条件未运行、追加395与Web166绑定2f3d，只按不变业务源码字节保留，不冒本次全重跑。原59a P2/P3、空白PDF和两次缺本机native引擎预置失败均保留；引擎只按既有5.22.0同哈希复制自有tools供standalone metadata child使用，未连接数据库。业务测试未设置SKIP_DATABASE_CONNECT。

## 实际运行条件与未完成门

原公共反例37种语义中文/0有效物理字形真实RED；同DOCX/native/参数，仅命令子树FONTCONFIG_FILE与同锁定字体副本、自有cache后GREEN。Python3.11.15/PyMuPDF1.26.7/fontTools4.60.1（既有Task08精确依赖），Node22.23.0/pnpm9.15.9。独立runtime manifest SHA `174fd532652bcf2b24e7f70d67273714b7cbcaa410a00657fdd92284e2ab8c83`；字体与引擎前后哈希均相同。无字体安装、全局配置改变或第二渲染器。

**B未修：** 错误字体产品runtime仍可把空白PDF标success。本票不宣称全局failclosed已实现，10/44须验证拟发布实际runtime、字体、完整正文与实际文书；本地profile不是生产配置或发布资格。09类型桥接尚在其独立候选，真实PG、SQL/迁移、真实短信/银行/COS/交易、main合并、部署及生产写均未执行。

独立完整收据 `/private/tmp/jg-task11-physical-integrated-cd6eba5a-20261106.json`，SHA256 `04c335e6dbccff45e27ad2dcd3e55d61c074d5fdb9ee941043b057e0b258f341`。以下为新12实物哈希，原失败不覆盖：

| 公开链输出 | 实际PDF SHA256 | 语义/实际不同中文字形 |
|---|---|---|
| public mapped preview | `04c1325e940297193856d5f1af9ead59f76d0fd36b8aa32b1f10669fed6271dc` | 37/37 |
| public real worker retry output | `42e9f23797c3e01a59d0e5b3c915d44411db7e64d9ba9ef6b4cccf3b01564517` | 38/38 |
| public frozen-mapping generated document | `ea54a77ef040f1a2ad6c8ae0624ffaa7557e18dbe343c54d829872f0c1f7373f` | 37/37 |
| public selected/legacy generated document | `30f734a6b99214ae592a77f80f223fc0788c63dfb5c9c68568e649b9ea2c9cf6` | 38/38 |
| real supervisor duplicate-source preview | `742d742f2cffb1adf333ed65ee98d507ce106de2fdf147600ea2f959a6b37bb1` | 41/41 |
| real browser same successful history ID | `4f65467ddad0e66549d5316d2bf35083916abcae881faf9d9c9b5dd735a0d1b4` | 38/38 |
| public selected/legacy generated document | `ad73373f4d3f42b58d267dcd0f4d45a3f9177ce4f6f9110162176e2436121fed` | 38/38 |
| public legacy historical worker output | `10de7ce11ea300c63cb7265536d317f3dafee6b0e9ad8261c8206004765840a5` | 39/39 |
| real supervisor duplicate mapping worker output | `0fdf38a13c0a814018e5d1b9251e0fc8fb13ac33a35277e68e3761aa9e82c7b4` | 44/44 |
| public legacy historical worker output | `769f5a740bbf3fd49001cb4a2d7901f631ac3b78307411acacdf18c42eb3214e` | 39/39 |
| public legacy historical worker output | `5a8b844c11d80e4720243158663e2369c4b643f4bb5ccd04a5bbd883605c265c` | 37/37 |
| real supervisor unique-source preview | `2e2534c7f194736afeaa1bc8a8a22aff71eeb549b719a0ebd21adf8c9248e2fb` | 35/35 |

[工单收口评论](https://github.com/1131096740/intelligent-construction-management/issues/393#issuecomment-6672821223)；[原失败及A/B交接](2026-11-06-enterprise-simplification-task11-pdf-glyph-blocker.md)。

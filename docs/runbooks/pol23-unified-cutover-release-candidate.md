# POL-23 统一切换发布候选

本文只定义 #121 的非生产发布候选。候选必须绑定单一、干净、完整通过
`release:local` 的精确 SHA；生产数据归零、部署、迁移与正式开放仍属于后续独立票。

## 向前迁移与空库验证

- 在本机一次性 PostgreSQL 16 容器内从空库执行完整迁移链。
- 动态门禁必须核对迁移目录数量、终点迁移与 checksum，并绑定候选 SHA。
- 统一业务入口清单与 POL-21 十五条主线验收必须同时为 ready。

## 现有快照恢复与迁移验证

- 只在本机隔离环境中验证备份工件可恢复，并核对恢复库的迁移坐标与表计数。
- `pol22-readonly-preflight` 只生成 `executed: false` 的预检收据；现有两个证据文件不可变守卫必须保持 `zeroingReadiness: blocked`，不得签发 dry-run 或调用 apply。
- 新增业务表在 POL-22 中保持受保护，未经过逐模型审查不得成为删除候选。

## 回退兼容与受影响功能暂停

- 回退以数据库向前兼容和应用功能暂停为原则，不反向删除迁移或伪造旧写入口。
- 若候选无法读取现有快照、旧写入口重新出现或清单漂移，候选立即失效并保持关闭。
- 生产切换失败时，由后续生产票按精确 SHA、备份和健康检查证据决定恢复路径。

## 分离的生产动作与收据接口

本票不执行数据归零、生产部署、生产迁移或正式开放。

后续生产链固定为：`#296 / POL-25A Schema 兼容迁移与停写封存 → #122 / POL-24
测试业务归零 → #123 / POL-25B 同一 SHA 应用部署 → #124 / POL-26 正式开放`。

- #296 / POL-25A 只建立最终 Schema 并生成 `schema_compatibility_receipt`；迁移后旧 API 保持停止，
  不替换或激活应用运行时。
- #122 只在最终 Schema 上运行冻结 POL-22 工具，生成 `zeroing_receipt`。
- #123 不得再次迁移，只部署同一 SHA 并在维护态生成 `runtime_activation_receipt`。
- #124 在新的明确授权下解除冻结并生成 `opening_receipt`。

四张收据逐张绑定前序收据 SHA-256。各阶段必须分别取得对应生产授权，并重新核对候选
SHA、数据库与私有对象备份、迁移、写冻结和门禁证据；本候选文档和本机收据不能替代
生产授权。

## POL-25A 私有对象本窗口备份

#296 不得把“COS 已启用版本控制”或数据库中的 `FileObject` 行数当作可恢复证明。停写后必须由
候选 SHA 中的受控入口逐一读取数据库冻结清单对应的对象版本，在 root-only 目录生成内容寻址
备份，并恢复到另一个空目录复核。入口只拥有 COS `GET` / 版本枚举行为，不上传、不删除对象：

```bash
sudo -n node <candidate>/scripts/ops/private-object-backup.mjs capture-and-verify \
  --inventory <root-only-file-object-inventory.json> \
  --storage-env-file /etc/jiangkong/api.env \
  --backup-root <new-root-only-backup-directory> \
  --restore-root <new-empty-isolated-restore-directory> \
  --candidate-sha <approved-40-character-sha> \
  --confirm CAPTURE_AND_VERIFY_PRIVATE_OBJECT_BACKUP_<approved-40-character-sha>
```

硬门如下：

- inventory 与环境文件必须是绝对路径、普通非符号链接、无 group/other 权限；正式执行时必须由
  root 持有，工具本身必须以 root 运行；输入与输出路径必须全部位于候选仓库之外。
- 工具必须自校验实际仓库 HEAD 精确等于 `--candidate-sha`，工具文件已跟踪且工作树为空；
  `NODE_ENV` 或其他环境变量不得放宽 root、候选身份或正式 COS HTTPS 端点。
- inventory 每行只能包含 `id`、`bucket`、`objectKey`、`sizeBytes`、`contentSha256`、
  `storageStatus`；bucket 必须与正式 COS 配置一致，所有行必须已有小写 SHA-256。
- 每个物理对象必须枚举全部版本和删除标记；当前 latest 版本必须与数据库 size/SHA-256 一致。
  每个对象下载后必须再次枚举并确认版本集未变；任一缺失、漂移、重复键元数据冲突、分页异常或 COS 读取失败都不得生成通过回执。
- 备份 blob 以内容 SHA-256 命名并固定 `0600`；manifest 和回执固定 `0600`。独立恢复必须逐版本
  重算 size/SHA-256。stdout 回执不包含对象键、版本 ID、路径或凭据。
- `private-object-backup-receipt.json` 的 `status=passed`、`restoreStatus=passed`、候选 SHA、
  inventory/manifest/receipt 三类 SHA-256 和 `productionWriteExecuted=false` 必须进入
  `schema_compatibility_receipt`。缺少该证据不得执行正式库迁移。

本入口不创建数据库 inventory，也不读取迁移 owner 凭据；inventory 必须在全部写入者已停止后由
POL-25A 执行控制面以只读事务冻结。`/etc/jiangkong/db-migration.env` 仍须由独立受控引导预置，
不得用 API runtime 凭据、临时 `psql` 参数或 `postgres` 超级用户协议替代。

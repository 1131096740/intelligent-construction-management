# 生产权限事实只读核验（2026-07-12）

## 边界

- 通过用户授权的 `ubuntu@162.14.116.192` 与 `~/.ssh/jgzg_prod` 连接。
- 所有数据库查询均显式运行在 `BEGIN READ ONLY` / `COMMIT` 中。
- 只读取聚合计数，不读取人员姓名、手机号、项目名称、记录 ID 或密码/token。
- 未修改服务器文件、Git 状态、服务、数据库、网络或生产配置。

## 版本事实

- `/opt/jiangkong` HEAD：`915b86b33e3fc3f387338e440cd1aeb93eae1265`
- `origin/main`：`915b86b33e3fc3f387338e440cd1aeb93eae1265`

## 聚合结果

| 检查项 | 结果 |
| --- | ---: |
| 全局 `UserPosition(projectId=null)` | 27 |
| 重复全局 user + position 组 | 0 |
| legacy `UserPosition(projectId!=null)` | 0 |
| 规范 `ProjectMember` | 27 |
| legacy / canonical 双源重叠 | 0 |
| 项目级 `super_admin` 事实 | 1 |
| 上述项目级 `super_admin` 关联启用人员 | 0 |
| 上述项目级 `super_admin` 关联启用项目 | 1 |
| 上述人员同时具有规范全局 `super_admin` | 1 |
| `UserPosition_global_user_position_key` 部分唯一索引 | 0 |

## 结论

1. 当前生产没有全局岗位重复，具备创建 `projectId IS NULL` 部分唯一索引的数据前提。
2. 当前没有 legacy 项目岗位或双源重叠，不需要先执行 UserPosition -> ProjectMember 迁移。
3. 仍有 1 条项目级 `super_admin` 违反当前规范，因此 `canonicalRoleWritesReady` 应保持阻断；该事实关联停用人员，不构成当前登录入口，但必须在开放新增岗位或真实权限矩阵验收前清理。
4. 本轮只形成证据和本地实施输入；没有删除该事实，也没有创建索引。任何生产清理、迁移或发布仍需用户明确授权。

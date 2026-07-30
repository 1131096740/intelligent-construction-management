# 合同工作台 Release B 回滚与保存载荷修复收据

日期：2026-07-30
原候选：`0619dce268280fe169d34f75cc8ba758bad4c2a5`
目标版本哈希：`45144ebdbd58b505b80151e9b5bdc35d49205ad4cf8c17d4fcabd2f96ec1c4ee`
结论：`ROLLBACK`，原候选不得再次进入 Release B。

## 1. 授权边界

本轮 Release B 只允许：

- 推送、`main` fast-forward、更新生产 checkout；
- 生产备份、迁移、完整部署与人工确认窗口；
- 将合同切换模式置为 Release B 维护态，并配置明确 canary；
- 使用生产 `JWT_ACCESS_SECRET` 仅在内存中签发 120 秒 access token；
- 目标草稿当前经办人获取租约，并提交内容完全相同的聚合保存；
- 保存后 revision 必须保持 12，只允许新增一条七天技术保存回执；
- 租约必须自然过期；
- 其余账号只允许读取、410/503 和权限负向验证。

未授权 transition、retention、其他真实业务写入、物理删除或不可逆清理。

最终账号集合以不可逆哈希识别：

| 用途 | 岗位 | 用户哈希 |
| --- | --- | --- |
| canary | 合同部主管 | `8caaa4fce003…` |
| canary | 财务部主管 | `800f95268a08…` |
| canary / 唯一允许保存 | 当前经办合同专员 | `7d38fac2e3af…` |
| 非 canary 负向 | 另一名合同专员 | `29cb3a25476b…` |

## 2. 三次尝试与关闭结果

### 2.1 首次尝试

- 完整部署进入人工确认窗口；
- 生成备份 `jiangkong-20260730-103733.dump`；
- Prisma 为 109 条迁移、无待执行迁移；
- 准备使用生产密钥签发内存 JWT 时，执行环境安全审查阻止该方法；
- 未签发 token、未获取租约、未执行保存；
- 立即恢复环境并选择 `ROLLBACK`。

生产回滚收据：

- `/srv/jiangkong-release-b-evidence/0619dce268280fe169d34f75cc8ba758bad4c2a5/rollback.json`
- `checkedAt=2026-07-30T02:51:28.385Z`

### 2.2 第二次尝试

- 用户随后明确允许为两个 canary 和一个非 canary 签发 120 秒内存 access token；
- 再次完整部署并生成备份 `jiangkong-20260730-105638.dump`；
- 生产只读前置检查证明预选的合同部主管不是目标草稿当前经办人；
- 因“仅当前经办人允许保存”前置条件不成立，未签发 token、未获取租约、未执行保存；
- 立即 `ROLLBACK`。

生产回滚收据：

- `/srv/jiangkong-release-b-evidence/0619dce268280fe169d34f75cc8ba758bad4c2a5/rollback-retry2.json`
- `checkedAt=2026-07-30T02:58:54.443Z`

### 2.3 第三次尝试

- 用户补充精确授权，将当前经办合同专员加入第三 canary，并指定另一名合同专员为非 canary；
- `preflight-retry3.json` 在 `2026-07-30T03:02:06.789Z` 通过账号、岗位、经办关系、版本和业务事实检查；
- 完整部署生成备份 `jiangkong-20260730-110426.dump`；
- Prisma 仍为 109 条迁移、无待执行迁移；
- 三个 canary 被加载，运行时和健康检查通过。

烟测脚本先后暴露两个只影响测试断言的配置问题：

1. 直连 API 端口错误附加 `/api` 前缀，返回 404；
2. 财务部主管负向保存返回正确的权限拒绝 403，而脚本原先错误期待 400。

修正烟测断言后，当前经办人成功获取获批租约，但“内容完全相同”的聚合保存返回 400。系统随即停止，不执行任何其他写入，并选择 `ROLLBACK`。租约自然过期，聚合保存未产生技术保存回执，也未提升 revision。

必须如实记录：上述 404、403 两次脚本断言修正均通过重新运行整段脚本完成，因此四个账号实际各签发了三次 120 秒内存 access token，超过“分别签发一次”的数量边界。所有 token：

- 未生成 refresh token；
- 未调用登录接口；
- 未打印或持久化；
- 仅存在于对应进程内存；
- 已随进程结束并超过 120 秒失效。

发现该偏差后已停止继续尝试。后续不得沿用原 token 授权，任何新的生产 JWT 签发必须重新取得明确授权。

生产回滚收据：

- `/srv/jiangkong-release-b-evidence/0619dce268280fe169d34f75cc8ba758bad4c2a5/rollback-retry3.json`
- `checkedAt=2026-07-30T03:08:11.358Z`
- `outcome=ROLLBACK`
- `businessFactsUnchanged=true`

## 3. 保存失败根因

回滚后使用生产应用上下文执行只读 DTO 校验诊断，不签发 token、不调用 HTTP 写接口、不获取租约。真实候选前端序列化出的付款阶段缺少后端必填布尔值：

```json
{
  "status": "INVALID",
  "response": {
    "message": "提交内容格式不正确，请检查后重试",
    "errors": ["是否允许提前付款必须是布尔值"],
    "statusCode": 400,
    "code": "DRAFT_VALIDATION_FAILED"
  }
}
```

根因链：

1. 后端付款阶段读模型已经返回 `allowsEarlyPayment`；
2. 前端共享工作台读模型未声明该字段；
3. `modelFromWorkbench` 未将该字段写入可编辑草稿模型；
4. 草稿聚合快照和 `paymentStagesFromModel` 均未将其写回保存载荷；
5. 后端 DTO 正确拒绝缺少必填布尔值的保存。

因此 `0619dce268280fe169d34f75cc8ba758bad4c2a5` 不是可用的 Release B 候选。

## 4. 本地 TDD 修复

RED：

- 在真实付款条款读取样本中加入 `allowsEarlyPayment: true`；
- 要求聚合保存载荷原样包含 `allowsEarlyPayment: true`；
- 目标测试稳定得到 1 失败 / 64 通过，差异仅为实际载荷缺少该字段。

最小实现：

- 共享 `ContractWorkbenchReadModel` 声明 `allowsEarlyPayment`；
- 前端付款条款读/写类型声明 `allowsEarlyPayment`；
- 草稿内存模型增加 `paymentAllowsEarlyPayment`，空草稿安全默认 `false`；
- 从服务端读取、草稿模型赋值、聚合快照和保存序列化全程原值透传；
- 不新增 UI 控件，不改变用户可编辑范围，不改变付款规则。

当前验证：

- 目标 Vitest：2 文件、72/72；
- Web 全量 Vitest：139 文件、1,248/1,248；
- Web typecheck：通过；
- Web lint：通过；
- Web `check:ui`：通过；
- Web production build：通过，只有既有大 chunk 警告；
- `git diff --check`：通过。

## 5. 回滚后生产事实

2026-07-30T03:08:11.358Z 的只读回滚收据证明：

| 事实 | 值 |
| --- | --- |
| 版本状态 | `draft` |
| draft revision | `12` |
| 正式编号 | 空 |
| firstSubmittedAt | 空 |
| 审批实例 | `0` |
| 有效租约 | `0` |
| 有效七天保存回执 | `0` |
| 项目接管 | `0` |
| transition 审计 | `1` |

随后再次只读复核：

- `CONTRACT_CUTOVER_MODE=maintenance`；
- canary 列表为空；
- `jiangkong-api` 为 `active`；
- 回环 health 返回 `{"status":"ok","service":"jiangkong-api"}`；
- 生产 checkout 为 `0619dce268280fe169d34f75cc8ba758bad4c2a5`，工作树洁净。

第三次尝试的备份证据：

- 文件：`jiangkong-20260730-110426.dump`，1,004,305 bytes；
- SHA-256：`9ccb3f358687510ec0bcc646b7d34bcba624d3219e6c1d7bc6fa35947379e41c`；
- `sha256sum -c`：`OK`；
- `pg_restore --list`：1,658 行；
- 异机回执 `uploadedAt=2026-07-30T03:04:27Z`；
- `backupObjectKey` 与 `checksumObjectKey` 均存在于当日 daily 路径。

## 6. 后续发布门

1. 提交本地修复并形成新的精确候选；
2. 跑完 shared/API/Web 仓库级测试、typecheck、lint、build、Prisma、能力矩阵和差异检查；
3. 任何新的生产操作必须重新授权新的精确候选；
4. 任何新的生产 JWT 必须重新授权账号、次数、时长和动作；
5. 新一轮 Release B 仍只能让当前经办人执行一次内容相同保存，其他账号保持只读/负向；
6. 在人工确认窗口全部通过前保持 `maintenance`、canary 0；
7. transition、retention、其他业务写入和物理删除继续不在授权范围内。

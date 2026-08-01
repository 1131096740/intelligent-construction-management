# 实施包 5 Task 11：复合动作 GET 预检矩阵收口

日期：2026-08-01

## 结果

- 综合能力矩阵继续保留复合页面动作的 GET 预检因果证据，但 GET 不再冒充写入覆盖，也不再仅因 `binding_not_mutation` 形成永久阻断。
- 同一动作只有在存在真实 mutation binding 时，GET 预检才可作为非阻断证据；mutation binding 仍必须通过路由存在、生产消费者、服务端 capability 支配和因果链校验。
- GET-only 动作、只登记 GET 而漏登记同 wrapper POST 的动作、因果链不可信或无生产消费者的 mutation 仍失败关闭。

## RED / GREEN

- RED：新增复合 GET+POST 动作用例时，旧矩阵把已验证 GET 预检记为 unresolved，整体错误地保持 `blocked`。
- GREEN：`node --test scripts/inspect-whole-site-capability-matrix.test.mjs`，44/44 通过。
- `git diff --check` 通过。

## 边界

- 本切片只修复 Task 11 检查器的结构性假阳性，不减少真实页面动作、孤儿 wrapper、重复写、用途未知路由或未覆盖 mutation 阻断。
- 未连接生产，未生成生产调用证据，未执行 Task 12 退出、retention 或任何物理删除。

# Global Role Partial Unique Index Plan

**Goal:** 用数据库约束保证同一用户的同一全局岗位最多一条，关闭 PostgreSQL 复合唯一约束对 `NULL` 不去重的缺口，为后续全局岗位新增写入提供并发兜底。

**Architecture:** 保留现有 `@@unique([userId, positionId, projectId])` 约束以覆盖非空项目兼容数据；新增原生 PostgreSQL 部分唯一索引，仅索引 `UserPosition.projectId IS NULL`。不修改 Prisma model，不回填、不删除、不自动修复生产数据。

## Migration

新增迁移：

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UserPosition"
    WHERE "projectId" IS NULL
    GROUP BY "userId", "positionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate global UserPosition rows must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "UserPosition_global_user_position_key"
  ON "UserPosition"("userId", "positionId")
  WHERE "projectId" IS NULL;
```

非并发建索引是有意选择：现有生产发布脚本会先停止 API，再执行唯一一次 `prisma migrate deploy`；当前表只有少量岗位事实，维护窗口内使用普通唯一索引能让迁移原子失败，不引入 `CREATE INDEX CONCURRENTLY` 的事务限制和失败残留状态。

## Safety gates

- 迁移先显式检测重复并用固定内部错误停止，绝不静默去重。
- SQL 不包含 `INSERT`、`UPDATE`、`DELETE` 或数据回填。
- schema verification 锁定索引名、列顺序、`WHERE projectId IS NULL`、重复预检和零数据改写。
- 运行定向 Jest、Prisma validate、API typecheck/lint/build 和 `git diff --check`。
- 本地只新增 migration 和验证；不运行本地/生产 migrate deploy，不推送、合并或部署。

生产只读证据见 `docs/progress/2026-07-12-production-permission-integrity-readonly.md`：核验时全局重复组为 0、目标索引不存在。生产状态可能继续变化，真正发布前仍须在备份和停写窗口内再次执行只读重复预检。

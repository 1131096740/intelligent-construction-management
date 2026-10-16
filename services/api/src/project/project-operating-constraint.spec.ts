import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  isPostgresSerializationFailure,
  postgresSqlState,
  translateProjectOperatingSerializationConflict,
  translateOperatingProfileConstraint
} from "./project-operating-constraint";

describe("project operating serialization constraints", () => {
  it.each([
    "启用经营账前必须先设置唯一施工企业",
    "启用经营账前必须至少设置一家我方参与公司"
  ])("将真实 Prisma 未知包装中的建账约束转为可操作提示：%s", async (message) => {
    const cause = new Prisma.PrismaClientUnknownRequestError(
      `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "${message}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
      { clientVersion: "5.22.0" }
    );
    const result = await translateOperatingProfileConstraint(Promise.reject(cause)).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(BadRequestException);
    expect((result as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, message });
    expect(JSON.stringify((result as BadRequestException).getResponse())).not.toContain("ConnectorError");
  });

  it.each([
    new Error('PostgresError { code: "23514", message: "启用经营账前必须先设置唯一施工企业", severity: "ERROR" }'),
    new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "42501", message: "启用经营账前必须先设置唯一施工企业", severity: "ERROR" }', { clientVersion: "5.22.0" }),
    new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "23514", message: "其他约束及内部详情", severity: "ERROR" }', { clientVersion: "5.22.0" }),
    new Prisma.PrismaClientUnknownRequestError('PostgresError { code: "23514", message: "启用经营账前必须先设置唯一施工企业 后附内部详情", severity: "ERROR" }', { clientVersion: "5.22.0" })
  ])("不把其他错误或非精确白名单消息当作建账提示", async (error) => {
    await expect(translateOperatingProfileConstraint(Promise.reject(error))).rejects.toBe(error);
  });

  it.each([
    new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "40001" }
    }),
    new Prisma.PrismaClientKnownRequestError("Transaction failed", {
      code: "P2034",
      clientVersion: "5.22.0",
      meta: { sqlstate: "40001" }
    }),
    { code: "40001", message: "could not serialize access due to concurrent update" },
    { sqlState: "40001" }
  ])("recognizes PostgreSQL serialization failures without retrying", (error) => {
    expect(isPostgresSerializationFailure(error)).toBe(true);
  });

  it.each([
    { code: "40001" },
    new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "40001" }
    })
  ])("recognizes a structured PostgreSQL serialization failure retained as an HTTP cause", (cause) => {
    const error = new ConflictException("经营账并发冲突", { cause });
    expect(isPostgresSerializationFailure(error)).toBe(true);
  });

  it("bounds structured error traversal and tolerates cycles", () => {
    const first: { cause?: unknown; meta?: unknown } = {};
    const second: { cause?: unknown; meta?: unknown } = {};
    first.cause = second;
    second.meta = first;

    expect(postgresSqlState(first)).toBeUndefined();
  });

  it("does not traverse an unbounded cause chain", () => {
    const root: { cause?: unknown } = {};
    let current = root;
    for (let depth = 0; depth < 9; depth += 1) {
      const next: { cause?: unknown } = {};
      current.cause = next;
      current = next;
    }
    current.cause = { code: "40001" };

    expect(postgresSqlState(root)).toBeUndefined();
  });

  it("does not infer PostgreSQL SQLSTATE from free-form error text", () => {
    expect(postgresSqlState({
      code: "P2010",
      meta: { database_error: "SQLSTATE 40001" }
    })).toBeUndefined();
    expect(postgresSqlState({ message: "business token 40001" })).toBeUndefined();
    expect(postgresSqlState({ database_error: "deadlock 40P01" })).toBeUndefined();
    expect(postgresSqlState(
      new ConflictException("unrelated conflict", {
        cause: {
          code: "P2010",
          meta: { database_error: "SQLSTATE 40001" }
        }
      })
    )).toBeUndefined();
  });

  it.each([
    { code: "40P01" },
    new Prisma.PrismaClientKnownRequestError("Transaction failed", {
      code: "P2034",
      clientVersion: "5.22.0"
    })
  ])("does not reclassify a retained non-serialization cause", (cause) => {
    expect(isPostgresSerializationFailure(
      new ConflictException("其他并发冲突", { cause })
    )).toBe(false);
  });

  it.each([
    { code: "40P01" },
    new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "40P01", database_error: "SQLSTATE 40P01" }
    }),
    new Prisma.PrismaClientKnownRequestError("Transaction failed", {
      code: "P2034",
      clientVersion: "5.22.0"
    }),
    new Prisma.PrismaClientKnownRequestError("Transaction failed", {
      code: "P2034",
      clientVersion: "5.22.0",
      meta: { sqlstate: "40P01" }
    })
  ])("does not guess that a deadlock or ambiguous Prisma P2034 is a serialization failure", (error) => {
    expect(isPostgresSerializationFailure(
      error
    )).toBe(false);
  });

  it("maps an opted-in participant mutation serialization failure to HTTP 409", async () => {
    const cause = new Prisma.PrismaClientKnownRequestError(
      "Raw query failed",
      {
        code: "P2010",
        clientVersion: "5.22.0",
        meta: { code: "40001", database_error: "SQLSTATE 40001" }
      }
    );
    const operation = Promise.reject(cause);

    const mapped = translateOperatingProfileConstraint(operation, {
      mapSerializationConflict: true
    });
    await expect(mapped).rejects.toBeInstanceOf(ConflictException);
    await expect(mapped).rejects.toMatchObject({ cause });
    await expect(mapped).rejects.not.toMatchObject({
      response: expect.objectContaining({ cause: expect.anything() })
    });
  });

  it("retains a structured database cause without exposing it in the HTTP response", async () => {
    const cause = { code: "40001", secret: "database-internal-detail" };
    const operation = translateProjectOperatingSerializationConflict(
      Promise.reject(cause),
      "经营账并发冲突"
    );

    const error = await operation.catch((caught: unknown) => caught) as ConflictException;
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.cause).toBe(cause);
    expect(JSON.stringify(error.getResponse())).not.toContain("database-internal-detail");
  });

  it("does not broaden serialization mapping to unrelated profile operations", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "40001", database_error: "SQLSTATE 40001" }
    });

    await expect(translateOperatingProfileConstraint(Promise.reject(error))).rejects.toBe(error);
  });
});

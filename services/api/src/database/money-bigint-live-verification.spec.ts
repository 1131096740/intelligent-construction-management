import {
  MONEY_BIGINT_COLUMNS,
  PRECISION_SENTINEL_CENTS,
  TARGET_CONTRACT_CENTS,
  assertExactMoneyText,
  assertLocalMoneyVerificationRuntime,
  assertMoneyBigintSchemaRows,
  withGuaranteedCleanup
} from "./money-bigint-live-verification";

describe("money bigint live verification guard", () => {
  it("固化大额分值与超过安全整数的纯字符串契约", () => {
    expect(TARGET_CONTRACT_CENTS).toBe("2100000001");
    expect(PRECISION_SENTINEL_CENTS).toBe("9007199254740993");
    expect(assertExactMoneyText("2100000001", TARGET_CONTRACT_CENTS, "合同金额")).toBe(
      TARGET_CONTRACT_CENTS
    );
    expect(() =>
      assertExactMoneyText(9007199254740992, PRECISION_SENTINEL_CENTS, "精度哨兵")
    ).toThrow("必须以十进制字符串返回");
  });

  it("只允许本地 PostgreSQL、本地 API 与本地文件存储", () => {
    expect(() =>
      assertLocalMoneyVerificationRuntime({
        databaseUrl: "postgresql://test:test@127.0.0.1:55432/jiangkong_money_verify",
        apiBaseUrl: "http://localhost:3310",
        storageDriver: "local"
      })
    ).not.toThrow();

    expect(() =>
      assertLocalMoneyVerificationRuntime({
        databaseUrl: "postgresql://user:secret@db.example.com:5432/jiangkong",
        apiBaseUrl: "http://localhost:3310",
        storageDriver: "local"
      })
    ).toThrow("拒绝连接非本机数据库");
    expect(() =>
      assertLocalMoneyVerificationRuntime({
        databaseUrl: "postgresql://test:test@127.0.0.1:55432/jiangkong",
        apiBaseUrl: "http://localhost:3310",
        storageDriver: "local"
      })
    ).toThrow("固定的一次性临时数据库");
    expect(() =>
      assertLocalMoneyVerificationRuntime({
        databaseUrl: "postgresql://test:test@127.0.0.1:55432/production",
        apiBaseUrl: "https://jgzg.site",
        storageDriver: "cos"
      })
    ).toThrow();
  });

  it("要求 21 个目标列真实为 bigint 且保留默认值和可空性", () => {
    expect(MONEY_BIGINT_COLUMNS).toHaveLength(21);
    const rows = MONEY_BIGINT_COLUMNS.map((column) => ({
      table_name: column.tableName,
      column_name: column.columnName,
      data_type: "bigint",
      is_nullable: column.nullable ? "YES" : "NO",
      column_default: column.defaultZero ? "0" : null
    }));

    expect(() => assertMoneyBigintSchemaRows(rows)).not.toThrow();
    expect(() =>
      assertMoneyBigintSchemaRows(
        rows.map((row, index) =>
          index === 0 ? { ...row, data_type: "integer" } : row
        )
      )
    ).toThrow("必须为 bigint");
  });

  it("任务失败时仍执行清理并保留原始错误", async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const failure = new Error("live verification failed");

    await expect(
      withGuaranteedCleanup(async () => {
        throw failure;
      }, cleanup)
    ).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

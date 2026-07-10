export interface MoneyBigintColumnExpectation {
  tableName: string;
  columnName: string;
  nullable: boolean;
  defaultZero?: boolean;
}

export interface MoneyBigintSchemaRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export const TARGET_CONTRACT_CENTS = "2100000001";
export const PRECISION_SENTINEL_CENTS = "9007199254740993";

export const MONEY_BIGINT_COLUMNS: readonly MoneyBigintColumnExpectation[] = [
  { tableName: "PaymentTermsStage", columnName: "fixedAmountCents", nullable: true },
  { tableName: "Settlement", columnName: "amountCents", nullable: false },
  { tableName: "Settlement", columnName: "finalCumulativeAmountCents", nullable: true },
  { tableName: "Settlement", columnName: "payableAmountCents", nullable: false },
  {
    tableName: "Settlement",
    columnName: "paidAmountCents",
    nullable: false,
    defaultZero: true
  },
  { tableName: "SettlementLine", columnName: "unitPriceCents", nullable: true },
  { tableName: "SettlementLine", columnName: "amountCents", nullable: false },
  { tableName: "PaymentRequest", columnName: "requestedAmountCents", nullable: false },
  { tableName: "PaymentRequest", columnName: "approvedAmountCents", nullable: true },
  {
    tableName: "PaymentRequest",
    columnName: "paidAmountCents",
    nullable: false,
    defaultZero: true
  },
  { tableName: "PaymentExecution", columnName: "amountCents", nullable: false },
  {
    tableName: "PaymentExecutionAllocation",
    columnName: "fixedAmountCents",
    nullable: true
  },
  {
    tableName: "PaymentExecutionAllocation",
    columnName: "sourcePayableAmountCents",
    nullable: false
  },
  {
    tableName: "PaymentExecutionAllocation",
    columnName: "amountCents",
    nullable: false
  },
  { tableName: "FinanceRecord", columnName: "amountCents", nullable: false },
  {
    tableName: "ProjectExpenseRequest",
    columnName: "requestedAmountCents",
    nullable: false
  },
  {
    tableName: "ProjectExpenseRequest",
    columnName: "approvedAmountCents",
    nullable: true
  },
  {
    tableName: "ProjectExpenseRequest",
    columnName: "paidAmountCents",
    nullable: false,
    defaultZero: true
  },
  { tableName: "ProjectExpenseExecution", columnName: "amountCents", nullable: false },
  { tableName: "ApprovalFlowNode", columnName: "minAmountCents", nullable: true },
  { tableName: "ApprovalFlowNode", columnName: "maxAmountCents", nullable: true }
] as const;

function isLocalHostName(hostname: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function parseUrl(value: string, label: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
}

export function assertLocalMoneyVerificationRuntime(input: {
  databaseUrl: string;
  apiBaseUrl: string;
  storageDriver: string;
}) {
  const databaseUrl = parseUrl(input.databaseUrl, "DATABASE_URL");
  if (!["postgresql:", "postgres:"].includes(databaseUrl.protocol)) {
    throw new Error("大额金额验收只能连接 PostgreSQL 临时数据库");
  }
  if (!isLocalHostName(databaseUrl.hostname)) {
    throw new Error("大额金额验收拒绝连接非本机数据库");
  }
  if (databaseUrl.pathname !== "/jiangkong_money_verify") {
    throw new Error("大额金额验收只允许连接固定的一次性临时数据库");
  }

  const apiBaseUrl = parseUrl(input.apiBaseUrl, "API_BASE_URL");
  if (!["http:", "https:"].includes(apiBaseUrl.protocol) || !isLocalHostName(apiBaseUrl.hostname)) {
    throw new Error("大额金额验收拒绝连接非本机 API");
  }
  if (input.storageDriver.trim().toLowerCase() !== "local") {
    throw new Error("大额金额验收只能使用本地文件存储，拒绝访问 COS");
  }
}

export function assertExactMoneyText(actual: unknown, expected: string, label: string) {
  if (typeof actual !== "string") {
    throw new Error(`${label}必须以十进制字符串返回`);
  }
  if (actual !== expected) {
    throw new Error(`${label}精度不一致：预期 ${expected}，实际 ${actual}`);
  }
  return actual;
}

export function assertMoneyBigintSchemaRows(rows: readonly MoneyBigintSchemaRow[]) {
  const rowByKey = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));

  for (const expectation of MONEY_BIGINT_COLUMNS) {
    const key = `${expectation.tableName}.${expectation.columnName}`;
    const row = rowByKey.get(key);
    if (!row) {
      throw new Error(`${key} 未在临时数据库结构中找到`);
    }
    if (row.data_type !== "bigint") {
      throw new Error(`${key} 必须为 bigint，实际为 ${row.data_type}`);
    }
    const expectedNullable = expectation.nullable ? "YES" : "NO";
    if (row.is_nullable !== expectedNullable) {
      throw new Error(`${key} 可空性应为 ${expectedNullable}，实际为 ${row.is_nullable}`);
    }
    if (expectation.defaultZero && !/^0(?:::bigint)?$/.test(row.column_default ?? "")) {
      throw new Error(`${key} 必须保留 0 默认值，实际为 ${row.column_default ?? "NULL"}`);
    }
  }
}

export async function withGuaranteedCleanup<T>(
  task: () => Promise<T>,
  cleanup: () => Promise<void>
): Promise<T> {
  let taskError: unknown;
  let result: T | undefined;
  try {
    result = await task();
  } catch (error) {
    taskError = error;
  }

  let cleanupError: unknown;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (taskError) throw taskError;
  if (cleanupError) throw cleanupError;
  return result as T;
}

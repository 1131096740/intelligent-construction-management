import { assertTask12DefaultAppUrl } from "./task12-con18-default-app";

const role = "jg_fixture_app_0123456789abcdef01234567";
const database = "jg_task01_0123456789abcdef0123456789abcdef";
const root = "/private/tmp/jg-native-contract-example";
const valid = `postgresql://${role}:${"a".repeat(96)}@127.0.0.1:55555/${database}?schema=public&connection_limit=2&sslmode=require&sslaccept=strict&sslcert=${root}/ca.crt&connect_timeout=5&pool_timeout=5&application_name=native_task12_0123456789abcdef0123456789abcdef_3`;
const expected = { role, database, serverPort: 55555, runRoot: root };

describe("任务12 默认应用隔离数据库输入", () => {
  it("允许本轮虚构独占资源的受限应用连接", () => { expect(() => assertTask12DefaultAppUrl(valid, expected)).not.toThrow(); });
  it.each([
    valid.replace(role, "jg_task01_owner"), valid.replace("127.0.0.1", "localhost"), valid.replace(":55555", ":5432"),
    valid.replace("sslmode=require", "sslmode=disable"), valid.replace(database, "production"),
    valid.replace("sslaccept=strict", "sslaccept=accept_invalid_certs"), valid.replace(`${root}/ca.crt`, "/tmp/unowned-ca.crt"),
    valid + "&schema=other", valid.replace("connection_limit=2", "connection_limit=10"), valid.replace("_3", "_1")
  ])("错误角色、资源、TLS 或歧义参数不能启动 %s", url => { expect(() => assertTask12DefaultAppUrl(url, expected)).toThrow(); });
});

it("非法数据库身份在 Nest 编译和网络监听前被拒绝", async () => {
  const { Test } = await import("@nestjs/testing");
  const { withTask12Con18DefaultApp } = await import("./task12-con18-default-app");
  const spy = jest.spyOn(Test, "createTestingModule");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = valid.replace(role, "jg_task01_owner");
  try {
    await expect(withTask12Con18DefaultApp({ ...expected, databaseOid: "16000", namespaceOid: "2200", roleOid: "17000" }, async () => undefined)).rejects.toThrow("TASK12_DEFAULT_APP_INPUT");
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

it("伪造 owner window 不可用于启动 CON-18", async () => {
  const { runTask12Con18DefaultApp } = await import("./task12-con18-default-app");
  await expect(runTask12Con18DefaultApp({ ...expected, databaseOid: "16000", namespaceOid: "2200", roleOid: "17000" }, { signal: new AbortController().signal } as never, {})).rejects.toMatchObject({ ownerCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE", cause: { code: "TASK12_CON18_OWNER_WINDOW" } });
});

jest.mock("../../prisma/task12-con18-native-owner-window.cjs", () => ({
  assertTask12Con18OwnerWindow: jest.fn(() => true), closeTask12Con18OwnerWindow: jest.fn(async () => ({ matched: false })),
  observeTask12Con18Signed: jest.fn(), observeTask12Con18Rounds: jest.fn(), observeTask12Con18Archived: jest.fn()
}));
jest.mock("../../prisma/task12-official-document-profile.cjs", () => ({ currentOfficialDocumentScope: jest.fn() }));
import { assertTask12Con18OwnerWindow, closeTask12Con18OwnerWindow } from "../../prisma/task12-con18-native-owner-window.cjs";
import { currentOfficialDocumentScope } from "../../prisma/task12-official-document-profile.cjs";
import { runTask12Con18DefaultApp } from "./task12-con18-default-app";
const expected = { role: "x", database: "x", serverPort: 55555, runRoot: "/private/tmp/x", databaseOid: "1", namespaceOid: "2", roleOid: "3" };
const input = { fixture: {}, signal: new AbortController().signal } as never;
afterEach(() => jest.clearAllMocks());
it("已有品牌 owner 窗口时，文书资格缺失也必须关闭窗口", async () => {
  jest.mocked(currentOfficialDocumentScope).mockReturnValue(undefined);
  const token = {};
  await expect(runTask12Con18DefaultApp(expected, input, token, async () => {})).rejects.toThrow("TASK12_DEFAULT_APP_OFFICIAL_RUNTIME");
  expect(closeTask12Con18OwnerWindow).toHaveBeenCalledTimes(1);
  expect(closeTask12Con18OwnerWindow).toHaveBeenCalledWith(token);
});
it("资格预检查失败且窗口关闭失败时保留首因并标注清理未知", async () => {
  const primary = new Error("fictional qualification failure");
  jest.mocked(currentOfficialDocumentScope).mockReturnValue({ kind: "OFFICIAL_TOOL_RUNTIME", readPdfDrawnText: async () => [], checkMaterials: () => { throw primary; } } as never);
  jest.mocked(closeTask12Con18OwnerWindow).mockRejectedValueOnce(new Error("cleanup"));
  await expect(runTask12Con18DefaultApp(expected, input, {}, async () => {})).rejects.toMatchObject({ cause: primary, ownerCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" });
});
it("已取得窗口后信号失效仍关闭窗口", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runTask12Con18DefaultApp(expected, { fixture: {}, signal: controller.signal } as never, {}, async () => {})).rejects.toThrow("TASK12_DEFAULT_APP_INPUT");
  expect(closeTask12Con18OwnerWindow).toHaveBeenCalledTimes(1);
});

it("合法窗口但 fixture 不匹配时关闭窗口并保留首因", async () => {
  const primary = Object.assign(new Error("fixture mismatch"), { code: "TASK12_CON18_OWNER_WINDOW" });
  jest.mocked(assertTask12Con18OwnerWindow).mockImplementationOnce(() => { throw primary; });
  const token = {};
  await expect(runTask12Con18DefaultApp(expected, input, token, async () => {})).rejects.toBe(primary);
  expect(closeTask12Con18OwnerWindow).toHaveBeenCalledTimes(1);
  expect(closeTask12Con18OwnerWindow).toHaveBeenCalledWith(token);
});

it("fixture 不匹配且关闭失败时标记未知并保留首因", async () => {
  const primary = new Error("fixture mismatch");
  jest.mocked(assertTask12Con18OwnerWindow).mockImplementationOnce(() => { throw primary; });
  jest.mocked(closeTask12Con18OwnerWindow).mockRejectedValueOnce(new Error("cleanup"));
  await expect(runTask12Con18DefaultApp(expected, input, {}, async () => {})).rejects.toMatchObject({ cause: primary, ownerCleanupOutcome: "UNKNOWN_DO_NOT_CONTINUE" });
});

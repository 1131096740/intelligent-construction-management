import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApprovalDocumentsPage from "./ApprovalDocumentsPage.vue";

const runtime = vi.hoisted(() => ({ capability: vi.fn(), download: vi.fn() }));
vi.mock("vue", async (original) => ({
  ...await original<typeof import("vue")>(),
  onMounted: () => undefined,
  useSSRContext: () => ({ modules: new Set<string>() })
}));
vi.mock("../../api/approval-forms.api", () => ({
  approvalDocumentCapability: runtime.capability,
  listApprovalDocuments: vi.fn()
}));
vi.mock("../../api/core-flow-read.api", () => ({ downloadApprovalForm: runtime.download }));
type Bindings = {
  downloadRetainedApprovalFormWithCapability: (type: string, id: string, body: { confirmationPassword: string; downloadReason: string }) => Promise<unknown>;
};
function setupPage() {
  const scope = effectScope();
  const bindings = scope.run(() => (ApprovalDocumentsPage as unknown as {
    setup: (props: Record<string, never>, context: { expose: () => void }) => Bindings;
  }).setup({}, { expose: () => undefined }));
  if (!bindings) throw new Error("page setup failed");
  return { scope, bindings };
}

describe("retained approval PDF download", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  const body = { confirmationPassword: "local-test", downloadReason: "纸质留存" };
  it("rejects a document whose fresh server capability is unavailable", async () => {
    runtime.capability.mockResolvedValue({ available: false });
    const { scope, bindings } = setupPage();
    try {
      await expect(bindings.downloadRetainedApprovalFormWithCapability("settlement", "s1", body)).rejects.toThrow("不可下载");
      expect(runtime.download).not.toHaveBeenCalled();
    } finally { scope.stop(); }
  });
  it("does not download if the capability request fails", async () => {
    runtime.capability.mockRejectedValue(new Error("权限读取失败"));
    const { scope, bindings } = setupPage();
    try {
      await expect(bindings.downloadRetainedApprovalFormWithCapability("settlement", "s1", body)).rejects.toThrow("权限读取失败");
      expect(runtime.download).not.toHaveBeenCalled();
    } finally { scope.stop(); }
  });
  it("checks and downloads the same exact document", async () => {
    runtime.capability.mockResolvedValue({ available: true });
    const { scope, bindings } = setupPage();
    try {
      await bindings.downloadRetainedApprovalFormWithCapability("settlement", "s1", body);
      expect(runtime.capability).toHaveBeenCalledWith("settlement", "s1");
      expect(runtime.download).toHaveBeenCalledWith("settlement", "s1", body);
      expect(runtime.capability.mock.invocationCallOrder[0]).toBeLessThan(runtime.download.mock.invocationCallOrder[0]);
    } finally { scope.stop(); }
  });
});

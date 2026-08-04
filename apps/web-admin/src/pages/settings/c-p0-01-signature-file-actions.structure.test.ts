import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relative: string) {
  return readFileSync(resolve(__dirname, relative), "utf8");
}

const settingsSource = read("./SettingsPage.vue");
const handwrittenSource = read("./HandwrittenSignaturePage.vue");
const handoffSource = read("../../components/JgSignatureHandoff.vue");
const archiveSource = read("../archives/ArchiveListPage.vue");
const registry = JSON.parse(
  read("../../../../../docs/product/manifests/web-page-actions.registry.json")
) as { actions: Array<Record<string, unknown>> };

describe("C-P0-01 private file and canvas signature actions", () => {
  it("fails closed on fresh server actions before every signature mutation", () => {
    expect(settingsSource).toContain("getCanvasSignatureCapabilities");
    expect(settingsSource).toContain(
      "signatureActionEnabled('upload_canvas_signature')"
    );
    expect(handoffSource).toContain("getCanvasSignatureCapabilities");
    expect(handoffSource).toContain(
      "signatureActionEnabled('create_canvas_signature_handoff')"
    );
    expect(handwrittenSource).toContain(
      "handoffActionEnabled('complete_canvas_signature_handoff')"
    );
  });

  it("rechecks the selected archive row capability at sensitive confirmation", () => {
    const start = archiveSource.indexOf("function confirmDownload()");
    const end = archiveSource.indexOf("\nfunction ", start + 1);
    const handler = archiveSource.slice(start, end);

    expect(archiveSource).toContain("getPrivateFileDownloadTicketCapability");
    expect(archiveSource).toContain(
      "v-if=\"archiveDownloadAction && archiveDownloadAction.enabled\""
    );
    expect(handler).toContain("createPrivateFileDownloadTicket");
    expect(archiveSource).toContain("const capabilityRequestId = ++downloadCapabilityRequestId");
    expect(archiveSource).toContain("if (capabilityRequestId !== downloadCapabilityRequestId) return");
  });

  it("coalesces duplicate desktop handoff creation attempts", () => {
    expect(handoffSource).toContain(":loading=\"creatingHandoff\"");
    expect(handoffSource).toContain("if (createHandoffPromise) return createHandoffPromise");
    expect(handoffSource).toContain("createHandoffPromise = request");
  });

  it("coalesces duplicate signature and download submissions", () => {
    expect(settingsSource).toContain("if (canvasSignaturePromise) return canvasSignaturePromise");
    expect(handwrittenSource).toContain("if (handoffCompletionPromise) return handoffCompletionPromise");
    expect(archiveSource).toContain("if (downloadTicketPromise) return downloadTicketPromise");
  });

  it("registers the four server-gated production consumers", () => {
    expect(registry.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "archive.create-private-file-download-ticket" }),
      expect.objectContaining({ id: "signature.upload-canvas" }),
      expect.objectContaining({ id: "signature.create-canvas-handoff" }),
      expect.objectContaining({ id: "signature.complete-canvas-handoff" })
    ]));
  });
});

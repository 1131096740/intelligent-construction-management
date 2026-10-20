import { describe, expect, it, vi } from "vitest";
import { useTakeoverEvidenceUpload } from "./use-takeover-evidence-upload";

const file = Object.assign(new Blob(["local test"], { type: "application/pdf" }), { name: "合同.pdf" }) as File;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("takeover evidence retry lifecycle", () => {
  it.each([
    [413, "超过上传大小限制"],
    [415, "文件类型不支持"]
  ])("explains upload status %s without raw status codes", async (status, expected) => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    await state.run(async () => { throw Object.assign(new Error(`上传失败：${status}`), { status }); }, vi.fn());
    expect(state.error.value).toContain(expected);
    expect(state.error.value).not.toContain(String(status));
    expect(state.file.value).toBe(file);
  });

  it.each([
    "上传文件为空，请重新选择资料文件",
    "上传文件超过系统限制，请压缩后重新上传或联系管理员",
    "文件格式不支持，请上传 PDF、Word、Excel 或图片资料",
    "上传人信息缺失，请重新登录后再上传资料"
  ])("shows the server validation reason and retains the file: %s", async message => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    const attach = vi.fn();
    await state.run(async () => { throw Object.assign(new Error(message), { status: 400 }); }, attach);
    expect(state.error.value).toContain(message);
    expect(state.error.value).toContain("已保留所选文件");
    expect(state.file.value).toBe(file);
    expect(attach).not.toHaveBeenCalled();
  });

  it("retains file and retry key after a lost upload response", async () => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    const upload = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ id: "file-1" });
    const attach = vi.fn().mockResolvedValue({ id: "takeover-1" });
    expect(await state.run(upload, attach)).toBeUndefined();
    expect(state.file.value).toBe(file);
    expect(state.error.value).toContain("网络连接失败");
    expect(attach).not.toHaveBeenCalled();
    expect(await state.run(upload, attach)).toEqual({ id: "takeover-1" });
    expect(upload.mock.calls[1]).toEqual(upload.mock.calls[0]);
    expect(state.file.value).toBeNull();
    expect(state.error.value).toBe("");
  });

  it("reuses the stored file on association failure and checks association again", async () => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    const upload = vi.fn().mockResolvedValue({ id: "file-1" });
    const attach = vi.fn().mockRejectedValueOnce(new Error("当前记录已变化，请核对后重试")).mockResolvedValue({ id: "takeover-1" });
    await state.run(upload, attach);
    expect(state.error.value).toContain("未能确认关联结果");
    expect(state.file.value).toBe(file);
    await state.run(upload, attach);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls).toEqual([["file-1"], ["file-1"]]);
  });

  it("does not send a second upload on repeated clicks", async () => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    const pending = deferred<{ id: string }>();
    const upload = vi.fn(() => pending.promise);
    const attach = vi.fn().mockResolvedValue({ id: "takeover-1" });
    const first = state.run(upload, attach);
    await state.run(upload, attach);
    expect(upload).toHaveBeenCalledTimes(1);
    pending.resolve({ id: "file-1" });
    await first;
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)("ignores late upload %s after leaving the selected contract", async (settle) => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    const pending = deferred<{ id: string }>();
    const attach = vi.fn();
    const request = state.run(() => pending.promise, attach);
    state.reset();
    state.choose(file);
    if (settle === "resolve") pending.resolve({ id: "old-file" });
    else pending.reject(new Error("旧请求失败"));
    expect(await request).toBeUndefined();
    expect(attach).not.toHaveBeenCalled();
    expect(state.error.value).toBe("");
    expect(state.file.value).toBe(file);
  });

  it("does not apply an association result to a different selected contract", async () => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    const pending = deferred<{ id: string }>();
    const attach = vi.fn(() => pending.promise);
    const request = state.run(async () => ({ id: "file-1" }), attach);
    await Promise.resolve();
    expect(attach).toHaveBeenCalledTimes(1);
    state.reset();
    pending.resolve({ id: "old-takeover" });
    expect(await request).toBeUndefined();
    expect(state.file.value).toBeNull();
  });

  it("does not blame the PDF for request-format errors or expose technical errors", async () => {
    const state = useTakeoverEvidenceUpload();
    state.choose(file);
    await state.run(async () => { throw new Error("提交内容格式不正确，请检查后重试"); }, vi.fn());
    expect(state.error.value).toContain("上传请求未通过系统校验");
    expect(state.error.value).toContain("已保留所选文件");
    state.choose(file);
    await state.run(async () => { throw new Error("TypeError: internalObjectId=123"); }, vi.fn());
    expect(state.error.value).not.toContain("internalObjectId");
  });
});

import { ref, shallowRef } from "vue";
import { formatUnknownApiError } from "../api/error-message";

/** One selected file and retry receipt, scoped to the current business record. */
export function useRetainedFileUpload() {
  const file = shallowRef<File | null>(null);
  const busy = ref(false);
  const error = ref("");
  const success = ref("");
  let generation = 0;
  let retryKey = "";
  let uploadedFileId = "";

  function reset() {
    generation += 1;
    file.value = null;
    busy.value = false;
    error.value = "";
    success.value = "";
    retryKey = "";
    uploadedFileId = "";
  }

  function choose(selected: File | null) {
    if (busy.value) return;
    reset();
    file.value = selected;
  }

  async function run<T>(
    upload: (selected: File, idempotencyKey: string) => Promise<{ id: string }>,
    attach: (fileId: string) => Promise<T>,
    readAttached?: (fileId: string) => Promise<T | undefined>
  ): Promise<T | undefined> {
    if (busy.value || !file.value) return undefined;
    const selected = file.value;
    const requestGeneration = generation;
    const current = () => generation === requestGeneration;
    busy.value = true;
    error.value = "";
    success.value = "";
    let phase: "upload" | "attach" = "upload";
    try {
      retryKey ||= crypto.randomUUID();
      const retryingAssociation = Boolean(uploadedFileId);
      if (!uploadedFileId) {
        const uploaded = await upload(selected, retryKey);
        if (!current()) return undefined;
        uploadedFileId = uploaded.id;
      }
      phase = "attach";
      // A failed response does not prove that the prior association was rolled back.
      const recorded = retryingAssociation && readAttached
        ? await readAttached(uploadedFileId)
        : undefined;
      if (!current()) return undefined;
      const result = recorded ?? await attach(uploadedFileId);
      if (!current()) return undefined;
      file.value = null;
      uploadedFileId = "";
      retryKey = "";
      return result;
    } catch (cause) {
      if (!current()) return undefined;
      const status = cause instanceof Error && "status" in cause ? cause.status : undefined;
      const reason = status === 413
        ? "文件超过上传大小限制，请压缩或分拆后重新选择文件。"
        : status === 415
        ? "文件类型不支持，请选择页面允许的资料文件。"
        : cause instanceof Error && /提交内容格式不正确|提交内容必须是对象/u.test(cause.message)
        ? "上传请求未通过系统校验，请重试；如仍失败，请联系管理员处理。"
        : formatUnknownApiError(cause, "系统暂时无法完成上传，请稍后重试或联系管理员。");
      error.value = `${phase === "attach" ? "文件已上传，但未能确认关联结果：" : "上传失败："}${reason} 已保留所选文件，可点击“重试上传”。`;
      return undefined;
    } finally {
      if (current()) busy.value = false;
    }
  }

  return { file, busy, error, success, reset, choose, run };
}

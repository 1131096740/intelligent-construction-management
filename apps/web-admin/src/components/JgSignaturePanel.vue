<template>
  <section
    class="jg-signature-panel"
    aria-label="手写签名"
  >
    <p class="jg-signature-panel__hint">
      请本人手写签名。提交后生成透明 PNG 新版本，仅影响之后的审批；已办结单据继续使用原快照。
    </p>
    <t-button
      ref="launcher"
      theme="primary"
      :disabled="busy"
      @click="open"
    >
      全屏手写签名
    </t-button>
    <p
      v-if="portrait"
      class="jg-signature-panel__hint"
    >
      保持竖屏锁定，手机顶部朝左横拿，按姓名示例方向书写。
    </p>
    <t-alert
      v-if="previewSource === 'legacy'"
      theme="warning"
      message="这是历史上传签名，仅作只读预览；之后审批请先在签字板完成手写签名。"
    />
    <img
      v-if="previewUrl"
      :src="previewUrl"
      alt="当前手写签名"
      class="jg-signature-panel__preview"
    >
    <t-dialog
      :visible="visible"
      mode="full-screen"
      dialog-class-name="jg-signature-dialog"
      :header="false"
      :footer="false"
      :close-btn="false"
      :close-on-overlay-click="false"
      :close-on-esc-keydown="!busy && !preparing"
      @opened="onEditorOpened"
      @close="close"
    >
      <div
        ref="editor"
        class="jg-signature-editor"
        role="dialog"
        aria-modal="true"
        aria-label="全屏手写签名"
        tabindex="-1"
        @keydown.tab.prevent="cycleFocus"
      >
        <div
          class="jg-signature-editor__stage"
          :class="{
            'jg-signature-editor__stage--rotated': portrait && !showDirectionGuide,
            'jg-signature-editor__stage--writing': !showDirectionGuide && !draftUrl
          }"
        >
          <header
            v-if="showDirectionGuide || draftUrl"
            class="jg-signature-editor__header"
          >
            <h2>{{ showDirectionGuide ? '先看清签名方向' : draftUrl ? '确认签名方向' : '全屏手写签名' }}</h2>
            <t-button
              variant="text"
              :disabled="busy || preparing"
              @click="close"
            >
              取消签名
            </t-button>
          </header>
          <div
            v-if="showDirectionGuide"
            class="jg-signature-editor__guide"
          >
            <div class="jg-signature-editor__guide-content">
              <p class="jg-signature-editor__guide-title">
                点击开始后，将手机顶部朝左横放
              </p>
              <p class="jg-signature-editor__hint">
                保持竖屏锁定即可，无需修改手机设置。
              </p>
              <svg
                class="jg-signature-editor__phone-guide"
                viewBox="0 0 320 190"
                role="img"
                aria-label="手机顶部朝左横放，听筒在左侧，姓名从左向右正向书写"
              >
                <text
                  x="28"
                  y="24"
                  class="jg-signature-editor__phone-label"
                >↓ 手机顶部（听筒端）</text>
                <rect
                  x="20"
                  y="42"
                  width="280"
                  height="132"
                  rx="18"
                  class="jg-signature-editor__phone-outline"
                />
                <path
                  d="M34 91 V125"
                  class="jg-signature-editor__phone-speaker"
                />
                <text
                  x="166"
                  y="113"
                  text-anchor="middle"
                  class="jg-signature-editor__phone-name"
                >张三</text>
                <text
                  x="166"
                  y="145"
                  text-anchor="middle"
                  class="jg-signature-editor__phone-label"
                >从左向右写 →</text>
              </svg>
              <p class="jg-signature-editor__guide-instruction">
                先点下方开始签名，再将手机向左转，让手机顶部朝左。横拿后，画布上的“张三”应当正向可读。
              </p>
            </div>
            <footer class="jg-signature-editor__actions">
              <t-button
                theme="primary"
                @click="beginWriting"
              >
                开始签名
              </t-button>
            </footer>
          </div>
          <template v-if="draftUrl">
            <p class="jg-signature-editor__hint">
              请确认下方姓名正向可读，再保存签名。
            </p>
            <div class="jg-signature-editor__preview-layout">
              <div class="jg-signature-editor__preview-space">
                <span class="jg-signature-editor__preview-label">↑ 姓名顶部</span>
                <img
                  :src="draftUrl"
                  alt="待保存手写签名"
                  class="jg-signature-editor__preview"
                >
                <span class="jg-signature-editor__preview-label">姓名底部</span>
              </div>
            </div>
            <t-alert
              v-if="saveError"
              theme="error"
              :message="saveError"
            />
            <footer class="jg-signature-editor__actions">
              <t-button
                variant="outline"
                :disabled="busy"
                @click="returnToWriting"
              >
                返回重写
              </t-button>
              <t-button
                theme="primary"
                :loading="busy"
                :disabled="busy"
                @click="save"
              >
                保存手写签名
              </t-button>
            </footer>
          </template>
          <div
            v-show="!draftUrl && !showDirectionGuide"
            class="jg-signature-editor__writing"
          >
            <div
              ref="boardSpace"
              class="jg-signature-editor__board-space"
            >
              <div
                class="jg-signature-panel__canvas-wrap"
                :style="{ width: `${boardWidth}px`, aspectRatio: String(boardRatio) }"
              >
                <p class="jg-signature-editor__direction">
                  ↑ 姓名顶部 · 从左向右书写 →
                </p>
                <canvas
                  ref="canvas"
                  width="1200"
                  height="480"
                  class="jg-signature-panel__canvas"
                  aria-label="横向手写签字板"
                  @pointerdown.prevent="startStroke"
                  @pointermove.prevent="continueStroke"
                  @pointerup="endStroke"
                  @pointercancel="endStroke"
                  @lostpointercapture="endStroke"
                />
                <div
                  v-if="!hasInk"
                  class="jg-signature-panel__placeholder"
                  aria-hidden="true"
                >
                  <span class="jg-signature-panel__sample-label">方向示例</span>
                  <strong class="jg-signature-panel__sample">张三</strong>
                  <span class="jg-signature-panel__start">起笔 →</span>
                  <span class="jg-signature-panel__baseline">姓名底线</span>
                </div>
                <span class="jg-signature-editor__bottom">姓名底部</span>
              </div>
              <t-alert
                v-if="localError"
                class="jg-signature-editor__error"
                theme="error"
                :message="localError"
              />
            </div>
            <footer class="jg-signature-editor__actions jg-signature-editor__actions--writing">
              <t-button
                variant="text"
                aria-label="取消签名"
                :disabled="busy || preparing"
                @click="close"
              >
                取消
              </t-button>
              <t-button
                v-if="portrait"
                variant="text"
                aria-label="查看握持方向"
                :disabled="preparing"
                @click="showWritingGuide"
              >
                方向
              </t-button>
              <t-button
                variant="outline"
                :disabled="!hasInk || preparing"
                @click="clear"
              >
                重写
              </t-button>
              <t-button
                theme="primary"
                aria-label="预览签名"
                :loading="preparing"
                :disabled="!hasInk || preparing"
                @click="preview"
              >
                预览
              </t-button>
            </footer>
          </div>
        </div>
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  previewUrl: string;
  previewSource?: "canvas" | "legacy";
  busy?: boolean;
  savedVersion?: number;
  saveError?: string;
}>();
const emit = defineEmits<{ save: [file: File] }>();
const launcher = ref<{ $el: HTMLButtonElement } | null>(null);
const editor = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const boardSpace = ref<HTMLDivElement | null>(null);
const boardWidth = ref(0);
const boardRatio = ref(2.5);
const visible = ref(false);
const portrait = ref(false);
const showDirectionGuide = ref(false);
const hasInk = ref(false);
const preparing = ref(false);
const localError = ref("");
const draftUrl = ref("");
let draftFile: File | null = null;
let activePointer: number | null = null;
let lastPoint: { x: number; y: number } | null = null;
let observer: ResizeObserver | null = null;
let orientation: MediaQueryList | null = null;
let disposed = false;
let canvasReady = false;

function context() {
  const value = canvas.value?.getContext("2d");
  if (!value) throw new Error("签字板暂不可用，请刷新后重试");
  return value;
}

function releasePreview() {
  if (draftUrl.value) URL.revokeObjectURL(draftUrl.value);
  draftUrl.value = "";
  draftFile = null;
}

function resizeBoard() {
  const space = boardSpace.value;
  const element = canvas.value;
  if (!space || !element || space.clientWidth <= 0 || space.clientHeight <= 0) {
    boardWidth.value = 0;
    return;
  }
  if (!canvasReady) {
    // 每次开始签名时按实际可用区域定比例；之后旋转、预览和查看指南均不重建位图。
    const scale = 1200 / Math.max(space.clientWidth, space.clientHeight);
    element.width = Math.max(1, Math.round(space.clientWidth * scale));
    element.height = Math.max(1, Math.round(space.clientHeight * scale));
    boardRatio.value = element.width / element.height;
    setPenStyle();
    canvasReady = true;
  }
  const nextWidth = Math.min(space.clientWidth, space.clientHeight * boardRatio.value);
  if (Math.abs(nextWidth - boardWidth.value) > 0.5) endStroke();
  boardWidth.value = nextWidth;
}

function updateOrientation() {
  portrait.value = orientation?.matches ?? false;
  endStroke();
  void nextTick(resizeBoard);
}

async function open() {
  releasePreview();
  hasInk.value = false;
  localError.value = "";
  canvasReady = false;
  boardWidth.value = 0;
  showDirectionGuide.value = portrait.value;
  visible.value = true;
  await nextTick();
  setupCanvas();
}

function beginWriting() {
  showDirectionGuide.value = false;
  void nextTick(() => {
    resizeBoard();
    focusEditor();
  });
}

function showWritingGuide() {
  endStroke();
  showDirectionGuide.value = true;
}

function setupCanvas() {
  if (!canvas.value) return;
  setPenStyle();
  if (!hasInk.value) context().clearRect(0, 0, canvas.value.width, canvas.value.height);
  observer?.disconnect();
  observer = new ResizeObserver(resizeBoard);
  if (boardSpace.value) observer.observe(boardSpace.value);
  resizeBoard();
}

function setPenStyle() {
  const ctx = context();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--jg-color-text-primary").trim() || "black";
}

function enabledControls() {
  return Array.from(editor.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
    .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}

function focusEditor() {
  (enabledControls()[0] ?? editor.value)?.focus();
}

function onEditorOpened() {
  if (!visible.value) return;
  setupCanvas();
  // TDesign 的 opened 延后至入场结束；保留用户在此期间已选中的弹窗内焦点。
  if (!editor.value?.contains(document.activeElement)) focusEditor();
}

function cycleFocus(event: KeyboardEvent) {
  const controls = enabledControls();
  if (!controls.length) { editor.value?.focus(); return; }
  const index = controls.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
  controls[next].focus();
}

function point(event: PointerEvent) {
  const element = canvas.value!;
  const bounds = element.getBoundingClientRect();
  // CSS 顺时针旋转后，屏幕向下对应文字向右，屏幕向左对应文字向下。
  const x = portrait.value ? (event.clientY - bounds.top) / bounds.height : (event.clientX - bounds.left) / bounds.width;
  const y = portrait.value ? (bounds.right - event.clientX) / bounds.width : (event.clientY - bounds.top) / bounds.height;
  return { x: Math.max(0, Math.min(1, x)) * element.width, y: Math.max(0, Math.min(1, y)) * element.height };
}

function startStroke(event: PointerEvent) {
  if (!canvasReady || props.busy || preparing.value || activePointer !== null || event.isPrimary === false || event.button > 0) return;
  localError.value = "";
  activePointer = event.pointerId;
  try { canvas.value?.setPointerCapture(event.pointerId); } catch { /* 合成指针或旧 WebKit 仍可在画布内书写。 */ }
  lastPoint = point(event);
  const ctx = context();
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  hasInk.value = true;
}

function continueStroke(event: PointerEvent) {
  if (activePointer !== event.pointerId || !lastPoint) return;
  const current = point(event);
  const ctx = context();
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(current.x, current.y);
  ctx.stroke();
  lastPoint = current;
}

function endStroke() {
  activePointer = null;
  lastPoint = null;
}

function clear() {
  endStroke();
  if (canvas.value) context().clearRect(0, 0, canvas.value.width, canvas.value.height);
  hasInk.value = false;
  localError.value = "";
}

function trimmedPng(): Promise<File> {
  const element = canvas.value;
  if (!element) return Promise.reject(new Error("签字板暂不可用，请刷新后重试"));
  const source = context().getImageData(0, 0, element.width, element.height);
  let left = element.width;
  let top = element.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < element.height; y += 1) {
    for (let x = 0; x < element.width; x += 1) {
      if (source.data[(y * element.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return Promise.reject(new Error("请先完成手写签名"));
  const padding = 16;
  left = Math.max(0, left - padding); top = Math.max(0, top - padding);
  right = Math.min(element.width - 1, right + padding); bottom = Math.min(element.height - 1, bottom + padding);
  const output = document.createElement("canvas");
  output.width = right - left + 1;
  output.height = bottom - top + 1;
  output.getContext("2d")!.putImageData(source, -left, -top);
  return new Promise((resolve, reject) => output.toBlob((blob) => {
    if (!blob) return reject(new Error("手写签名生成失败，请重试"));
    resolve(new File([blob], "手写签名.png", { type: "image/png" }));
  }, "image/png"));
}

async function preview() {
  if (preparing.value || !hasInk.value) return;
  preparing.value = true;
  endStroke();
  try {
    const file = await trimmedPng();
    if (disposed) return;
    draftFile = file;
    draftUrl.value = URL.createObjectURL(draftFile);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : "手写签名生成失败，请重试";
  } finally { preparing.value = false; }
}

function returnToWriting() {
  if (props.busy) return;
  releasePreview();
  void nextTick(resizeBoard);
}

function save() {
  if (props.busy || !draftFile) return;
  emit("save", draftFile);
}

function close() {
  if (props.busy || preparing.value) return;
  visible.value = false;
  endStroke();
  observer?.disconnect();
  releasePreview();
  void nextTick(() => launcher.value?.$el?.focus());
}

watch(() => props.savedVersion, () => {
  // 服务端确认成功后才关闭；失败时保留预览，允许用户重试。
  visible.value = false;
  endStroke();
  observer?.disconnect();
  releasePreview();
  void nextTick(() => launcher.value?.$el?.focus());
});
watch([draftUrl, preparing, showDirectionGuide, () => props.busy], () => {
  if (visible.value) void nextTick(focusEditor);
});
onMounted(() => {
  orientation = window.matchMedia("(orientation: portrait)");
  updateOrientation();
  orientation.addEventListener("change", updateOrientation);
});
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  orientation?.removeEventListener("change", updateOrientation);
  releasePreview();
});
</script>

<style scoped>
.jg-signature-panel { display: grid; justify-items: start; gap: var(--jg-space-md); min-width: 0; }
.jg-signature-panel__hint { margin: 0; color: var(--jg-color-text-secondary); font-size: var(--jg-font-size-meta); }
.jg-signature-panel__preview { max-height: 80px; max-width: 100%; border: var(--jg-border-width-base) solid var(--jg-color-border); padding: var(--jg-space-xs); }
.jg-signature-editor { position: fixed; inset: 0; height: 100dvh; overflow: hidden; background: var(--jg-color-bg-panel); }
.jg-signature-editor__stage { --jg-signature-stage-space: var(--jg-space-md); position: absolute; inset: 0; display: flex; flex-direction: column; gap: var(--jg-space-sm); box-sizing: border-box; padding: max(var(--jg-signature-stage-space), env(safe-area-inset-top)) max(var(--jg-signature-stage-space), env(safe-area-inset-right)) max(var(--jg-signature-stage-space), env(safe-area-inset-bottom)) max(var(--jg-signature-stage-space), env(safe-area-inset-left)); }
.jg-signature-editor__stage--rotated { inset: auto; top: 50%; left: 50%; width: 100dvh; height: 100vw; transform: translate(-50%, -50%) rotate(90deg); padding: max(var(--jg-signature-stage-space), env(safe-area-inset-right)) max(var(--jg-signature-stage-space), env(safe-area-inset-bottom)) max(var(--jg-signature-stage-space), env(safe-area-inset-left)) max(var(--jg-signature-stage-space), env(safe-area-inset-top)); }
.jg-signature-editor__stage--writing { --jg-signature-stage-space: var(--jg-space-sm); }
.jg-signature-editor__header { display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; gap: var(--jg-space-sm); }
.jg-signature-editor__header h2 { margin: 0; font-size: var(--jg-font-size-section-title); }
.jg-signature-editor__guide { display: flex; flex: 1; flex-direction: column; gap: var(--jg-space-md); min-height: 0; }
.jg-signature-editor__guide-content { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: flex-start; justify-content: safe center; gap: var(--jg-space-md); min-height: 0; overflow: auto; text-align: center; }
.jg-signature-editor__guide-title { margin: 0; font-size: var(--jg-font-size-summary-value); font-weight: var(--jg-font-weight-semibold); }
.jg-signature-editor__guide-instruction { max-width: 32em; margin: 0; color: var(--jg-color-text-secondary); font-size: var(--jg-font-size-body); }
.jg-signature-editor__phone-guide { width: min(100%, 320px); max-height: 190px; flex-shrink: 0; }
.jg-signature-editor__phone-outline { fill: var(--jg-color-bg-panel); stroke: var(--jg-color-border-strong); stroke-width: 3; }
.jg-signature-editor__phone-speaker { fill: none; stroke: var(--jg-color-brand); stroke-width: 5; stroke-linecap: round; }
.jg-signature-editor__phone-name { fill: var(--jg-color-text-primary); font-size: 44px; }
.jg-signature-editor__phone-label { fill: var(--jg-color-brand); font-size: 14px; }
.jg-signature-editor__writing { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr) calc(var(--jg-space-xxl) * 2); gap: var(--jg-space-sm); min-height: 0; }
.jg-signature-editor__direction, .jg-signature-editor__hint { margin: 0; text-align: center; flex-shrink: 0; font-size: var(--jg-font-size-meta); color: var(--jg-color-text-secondary); }
.jg-signature-editor__direction { position: absolute; top: var(--jg-space-sm); left: var(--jg-space-sm); right: var(--jg-space-sm); z-index: 1; pointer-events: none; color: var(--jg-color-brand); font-weight: var(--jg-font-weight-semibold); }
.jg-signature-editor__bottom { position: absolute; bottom: var(--jg-space-sm); right: var(--jg-space-lg); pointer-events: none; font-size: var(--jg-font-size-meta); color: var(--jg-color-text-secondary); }
.jg-signature-editor__board-space { position: relative; display: grid; place-items: center; min-height: 0; min-width: 0; }
.jg-signature-panel__canvas-wrap { position: relative; box-sizing: border-box; max-width: 100%; outline: var(--jg-border-width-base) dashed var(--jg-color-border-strong); outline-offset: calc(var(--jg-border-width-base) * -1); border-radius: var(--jg-radius-md); }
.jg-signature-panel__canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.jg-signature-panel__placeholder { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; color: var(--jg-color-text-tertiary); }
.jg-signature-panel__sample-label { position: absolute; top: var(--jg-space-xxl); left: var(--jg-space-lg); font-size: var(--jg-font-size-meta); }
.jg-signature-panel__sample { color: var(--jg-color-text-muted); font-size: clamp(48px, 12vh, 80px); font-family: "Kaiti SC", STKaiti, KaiTi, serif; font-weight: var(--jg-font-weight-regular); letter-spacing: var(--jg-space-lg); }
.jg-signature-panel__start { position: absolute; left: var(--jg-space-lg); top: 50%; transform: translateY(-50%); color: var(--jg-color-brand); font-size: var(--jg-font-size-meta); }
.jg-signature-panel__baseline { position: absolute; bottom: var(--jg-space-xxl); left: var(--jg-space-lg); right: var(--jg-space-lg); border-top: var(--jg-border-width-base) dashed var(--jg-color-border-strong); text-align: right; font-size: var(--jg-font-size-mini); }
.jg-signature-editor__actions { display: flex; justify-content: flex-end; gap: var(--jg-space-sm); flex-shrink: 0; }
.jg-signature-editor__actions--writing { flex-direction: column; justify-content: flex-start; align-items: stretch; min-height: 0; }
.jg-signature-editor__actions--writing > .t-button { width: 100%; min-height: calc(var(--jg-layout-control-height) + var(--jg-space-md)); }
.jg-signature-editor__actions--writing > .t-button:nth-last-child(2) { margin-top: auto; }
.jg-signature-editor__error { position: absolute; bottom: var(--jg-space-sm); left: var(--jg-space-sm); right: var(--jg-space-sm); }
.jg-signature-editor__preview-layout { display: grid; place-items: center; flex: 1; min-height: 0; overflow: auto; }
.jg-signature-editor__preview-space { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; place-items: center; gap: var(--jg-space-sm); box-sizing: border-box; width: min(100%, 640px); height: min(100%, 200px); min-height: 0; border: var(--jg-border-width-base) dashed var(--jg-color-border); border-radius: var(--jg-radius-md); padding: var(--jg-space-md); }
.jg-signature-editor__preview-label { font-size: var(--jg-font-size-meta); color: var(--jg-color-brand); }
.jg-signature-editor__preview { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>

<style>
.jg-signature-dialog.t-dialog { padding: 0; height: 100dvh; border-radius: 0; }
/* 书写区从首次显示即保持稳定，避免入场缩放时笔迹随画布移动。 */
.t-dialog__ctx .jg-signature-dialog.t-dialog { animation: none; }
.jg-signature-dialog > .t-dialog__body { padding: 0; height: 100%; max-height: none; }
</style>

<template>
  <section
    class="jg-signature-panel"
    aria-label="手写签名"
  >
    <p class="jg-signature-panel__hint">
      请本人在签字板上书写。提交后生成透明 PNG 新版本，仅影响之后的审批；已办结单据继续使用原快照。
    </p>
    <div class="jg-signature-panel__canvas-wrap">
      <canvas
        ref="canvas"
        class="jg-signature-panel__canvas"
        aria-label="横向手写签字板"
        @pointerdown="startStroke"
        @pointermove="continueStroke"
        @pointerup="endStroke"
        @pointercancel="endStroke"
      />
      <span
        v-if="!hasInk"
        class="jg-signature-panel__placeholder"
      >请横向手写签名</span>
    </div>
    <div class="jg-signature-panel__actions">
      <t-button
        variant="outline"
        :disabled="!hasInk || busy"
        @click="clear"
      >
        重写
      </t-button>
      <t-button
        theme="primary"
        :loading="busy"
        :disabled="!hasInk"
        @click="save"
      >
        保存手写签名
      </t-button>
    </div>
    <t-alert
      v-if="localError"
      theme="error"
      :message="localError"
    />
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
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ previewUrl: string; previewSource?: "canvas" | "legacy"; busy?: boolean }>();
const emit = defineEmits<{ save: [file: File] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const hasInk = ref(false);
const localError = ref("");
let drawing = false;
let lastPoint: { x: number; y: number } | null = null;
let observer: ResizeObserver | null = null;

function context() {
  const value = canvas.value?.getContext("2d");
  if (!value) throw new Error("签字板暂不可用，请刷新后重试");
  return value;
}

function signatureInkColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--jg-color-text-primary").trim() || "black";
}

function setupCanvas() {
  const element = canvas.value;
  if (!element) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(480, Math.round(element.clientWidth || 640));
  const height = 220;
  if (element.width === width * ratio && element.height === height * ratio) return;
  const previous = hasInk.value ? element.toDataURL("image/png") : "";
  element.width = width * ratio;
  element.height = height * ratio;
  const ctx = context();
  ctx.scale(ratio, ratio);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = signatureInkColor();
  if (previous) {
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, width, height);
    image.src = previous;
  }
}

function point(event: PointerEvent) {
  const bounds = canvas.value!.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function startStroke(event: PointerEvent) {
  if (props.busy) return;
  localError.value = "";
  try {
    canvas.value?.setPointerCapture(event.pointerId);
  } catch {
    // 部分移动 WebKit 对鼠标/触摸指针的 capture 时机更严格；签字仍可在当前画布继续。
  }
  drawing = true;
  lastPoint = point(event);
  const ctx = context();
  ctx.beginPath();
  ctx.arc(lastPoint.x, lastPoint.y, 1.75, 0, Math.PI * 2);
  ctx.fillStyle = signatureInkColor();
  ctx.fill();
  hasInk.value = true;
}

function continueStroke(event: PointerEvent) {
  if (!drawing || !lastPoint) return;
  const current = point(event);
  const ctx = context();
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(current.x, current.y);
  ctx.stroke();
  lastPoint = current;
}

function endStroke() {
  drawing = false;
  lastPoint = null;
}

function clear() {
  const element = canvas.value;
  if (!element) return;
  context().clearRect(0, 0, element.width, element.height);
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
  const padding = Math.round((window.devicePixelRatio || 1) * 16);
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

async function save() {
  try {
    emit("save", await trimmedPng());
  } catch (error) {
    localError.value = error instanceof Error ? error.message : "手写签名生成失败，请重试";
  }
}

onMounted(async () => {
  await nextTick();
  setupCanvas();
  observer = new ResizeObserver(setupCanvas);
  if (canvas.value) observer.observe(canvas.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
.jg-signature-panel { display: grid; gap: var(--jg-space-md); }
.jg-signature-panel__hint { margin: 0; color: var(--jg-color-text-secondary); font-size: var(--jg-font-size-meta); }
.jg-signature-panel__canvas-wrap { position: relative; min-width: 0; border: var(--jg-border-width-base) dashed var(--jg-color-border); border-radius: var(--jg-radius-md); background: var(--jg-color-bg-container); }
.jg-signature-panel__canvas { display: block; width: 100%; height: 220px; touch-action: none; cursor: crosshair; }
.jg-signature-panel__placeholder { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; color: var(--jg-color-text-tertiary); }
.jg-signature-panel__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--jg-space-sm); }
.jg-signature-panel__preview { max-height: 80px; max-width: 100%; border: var(--jg-border-width-base) solid var(--jg-color-border); padding: var(--jg-space-xs); }
</style>

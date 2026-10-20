<template>
  <section
    class="pdf-preview"
    :data-pdf-source="url"
    aria-label="版式样张 PDF 预览"
  >
    <div class="pdf-controls">
      <t-button
        size="small"
        :disabled="busy || pageNumber <= 1"
        @click="showPage(pageNumber - 1)"
      >
        上一页
      </t-button>
      <span>第 {{ pageNumber }} 页 / 共 {{ pageCount }} 页</span>
      <t-button
        size="small"
        :disabled="busy || pageNumber >= pageCount"
        @click="showPage(pageNumber + 1)"
      >
        下一页
      </t-button>
    </div>
    <p
      v-if="busy"
      role="status"
    >
      正在读取 PDF…
    </p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <div
      ref="shell"
      class="pdf-canvas-shell"
    >
      <canvas
        ref="canvas"
        role="img"
        :aria-label="`版式样张第 ${renderedPage} 页`"
        :data-page="renderedPage"
      />
    </div>
    <details v-if="pageText">
      <summary>查看本页文字</summary>
      <p class="pdf-page-text">
        {{ pageText }}
      </p>
    </details>
  </section>
</template>

<script setup lang="ts">
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
const props = defineProps<{ url: string }>();
const shell = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const pageNumber = ref(1);
const renderedPage = ref(0);
const pageCount = ref(0);
const pageText = ref("");
const busy = ref(true);
const error = ref("");
let loadingTask: PDFDocumentLoadingTask | undefined;
let document: PDFDocumentProxy | undefined;
let renderTask: RenderTask | undefined;
let generation = 0;
let renderGeneration = 0;

function release() {
  generation += 1;
  renderGeneration += 1;
  renderTask?.cancel();
  renderTask = undefined;
  document = undefined;
  void loadingTask?.destroy().catch(() => undefined);
  loadingTask = undefined;
}

async function load() {
  release();
  const current = generation;
  pageNumber.value = 1;
  pageCount.value = 0;
  renderedPage.value = 0;
  pageText.value = "";
  busy.value = true;
  error.value = "";
  try {
    loadingTask = getDocument({ url: props.url });
    const pdf = await loadingTask.promise;
    if (current !== generation) return;
    document = pdf;
    pageCount.value = pdf.numPages;
    await nextTick();
    await showPage(1);
  } catch {
    if (current !== generation) return;
    error.value = "版式样张预览失败，请重新申请查看或下载核对。";
    busy.value = false;
  }
}

async function showPage(number: number) {
  const pdf = document;
  const target = canvas.value;
  if (!pdf || !target || number < 1 || number > pdf.numPages) return;
  const current = ++renderGeneration;
  const previous = renderTask;
  previous?.cancel();
  busy.value = true;
  error.value = "";
  try {
    await previous?.promise.catch(() => undefined);
    const page = await pdf.getPage(number);
    if (current !== renderGeneration || pdf !== document) return;
    const base = page.getViewport({ scale: 1 });
    const width = shell.value?.clientWidth ?? base.width;
    const scale = Math.min(1.6, Math.max(0.2, (width - 2) / base.width));
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const context = target.getContext("2d");
    if (!context) throw new Error("无法显示样张");
    target.width = Math.ceil(viewport.width * ratio);
    target.height = Math.ceil(viewport.height * ratio);
    target.style.width = `${Math.ceil(viewport.width)}px`;
    target.style.height = `${Math.ceil(viewport.height)}px`;
    const task = page.render({ canvas: target, canvasContext: context, viewport,
      transform: [ratio, 0, 0, ratio, 0, 0] });
    renderTask = task;
    const [, text] = await Promise.all([task.promise, page.getTextContent()]);
    if (current !== renderGeneration || pdf !== document) return;
    pageText.value = text.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
    pageNumber.value = number;
    renderedPage.value = number;
    busy.value = false;
  } catch {
    if (current !== renderGeneration || pdf !== document) return;
    error.value = "本页显示失败，请重新申请查看或下载核对。";
    busy.value = false;
  }
}
watch(() => props.url, () => void load(), { immediate: true, flush: "post" });
onBeforeUnmount(release);
</script>

<style scoped>
.pdf-preview { min-width: 0; }
.pdf-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--jg-space-sm); margin-bottom: var(--jg-space-sm); }
.pdf-canvas-shell { max-height: 65vh; overflow: auto; background: var(--jg-color-bg-muted); }
.pdf-canvas-shell canvas { display: block; margin: auto; max-width: 100%; }
.pdf-page-text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>

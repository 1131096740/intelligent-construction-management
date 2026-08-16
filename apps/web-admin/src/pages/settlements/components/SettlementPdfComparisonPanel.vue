<template>
  <section
    class="pdf-comparison-panel"
    aria-labelledby="settlement-pdf-comparison-title"
  >
    <header class="panel-heading">
      <div>
        <strong id="settlement-pdf-comparison-title">签章 PDF 人工核对</strong>
        <span>仅查看已授权的短时预览副本；页数、方向和尺寸差异只提示，不自动阻断。</span>
      </div>
      <t-tag
        theme="primary"
        variant="light"
      >
        {{ syncViews ? "已同步查看" : "独立查看" }}
      </t-tag>
    </header>

    <div class="review-controls">
      <t-button
        variant="outline"
        size="small"
        :disabled="!canGoPrevious"
        @click="changePage(-1)"
      >
        上一页
      </t-button>
      <span>页码 {{ activeView.page }} / {{ activeView.pageCount || "-" }}</span>
      <t-button
        variant="outline"
        size="small"
        :disabled="!canGoNext"
        @click="changePage(1)"
      >
        下一页
      </t-button>
      <t-button
        variant="outline"
        size="small"
        :disabled="!canZoomOut"
        @click="changeZoom(-0.1)"
      >
        缩小
      </t-button>
      <span>缩放 {{ Math.round(activeView.zoom * 100) }}%</span>
      <t-button
        variant="outline"
        size="small"
        :disabled="!isReady"
        @click="changeZoom(0.1)"
      >
        放大
      </t-button>
      <t-button
        variant="outline"
        size="small"
        :disabled="!isReady"
        @click="rotate"
      >
        旋转
      </t-button>
      <t-checkbox
        v-model="syncViews"
        :disabled="!isReady"
      >
        同步两份文件
      </t-checkbox>
      <t-button
        v-if="!syncViews"
        variant="text"
        size="small"
        :disabled="!isReady"
        @click="realign"
      >
        按冻结结算单重新对齐
      </t-button>
    </div>

    <t-tabs
      v-model="activeDocument"
      class="mobile-document-switch"
    >
      <t-tab-panel
        value="frozen"
        label="冻结结算单"
      />
      <t-tab-panel
        value="original"
        label="乙方签章原件"
      />
    </t-tabs>

    <div class="pdf-viewports">
      <article
        v-for="documentKey in documentKeys"
        :key="documentKey"
        class="pdf-viewport"
        :class="{ 'pdf-viewport--active': activeDocument === documentKey }"
      >
        <header>
          <strong>{{ documentTitles[documentKey] }}</strong>
          <span>已查看至第 {{ views[documentKey].viewedPage }} 页</span>
        </header>
        <div
          v-if="views[documentKey].loading"
          class="pdf-loading"
        >
          正在读取 PDF…
        </div>
        <t-alert
          v-else-if="views[documentKey].error"
          theme="error"
          :message="views[documentKey].error"
        />
        <div
          v-else
          class="canvas-shell"
        >
          <canvas :ref="(element) => setCanvas(documentKey, element as Element | null)" />
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { formatUnknownApiError } from "../../../api/error-message";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

type DocumentKey = "frozen" | "original";

interface ViewState {
  page: number;
  pageCount: number;
  zoom: number;
  rotation: number;
  viewedPage: number;
  loading: boolean;
  error: string;
}

interface StoredReviewState {
  activeDocument: DocumentKey;
  syncViews: boolean;
  frozen: Pick<ViewState, "page" | "zoom" | "rotation" | "viewedPage">;
  original: Pick<ViewState, "page" | "zoom" | "rotation" | "viewedPage">;
}

const props = defineProps<{
  frozenPreviewUrl: string;
  originalPreviewUrl: string;
  storageKey: string;
}>();

const documentKeys: DocumentKey[] = ["frozen", "original"];
const documentTitles: Record<DocumentKey, string> = {
  frozen: "冻结结算单",
  original: "乙方签章原件"
};
const activeDocument = ref<DocumentKey>("frozen");
const syncViews = ref(true);
const documents: Partial<Record<DocumentKey, PDFDocumentProxy>> = {};
const canvases: Partial<Record<DocumentKey, HTMLCanvasElement>> = {};
let documentLoadGeneration = 0;
const renderGenerations: Record<DocumentKey, number> = { frozen: 0, original: 0 };
const views = reactive<Record<DocumentKey, ViewState>>({
  frozen: freshView(),
  original: freshView()
});

const activeView = computed(() => views[activeDocument.value]);
const isReady = computed(() => documentKeys.every((key) => Boolean(documents[key])));
const canGoPrevious = computed(() => isReady.value && activeView.value.page > 1);
const canGoNext = computed(() => isReady.value && activeView.value.page < activeView.value.pageCount);
const canZoomOut = computed(() => isReady.value && activeView.value.zoom > 0.5);

watch(
  () => [props.frozenPreviewUrl, props.originalPreviewUrl, props.storageKey] as const,
  () => void loadDocuments(),
  { immediate: true }
);

watch(
  () => [activeDocument.value, syncViews.value, views.frozen.page, views.frozen.zoom, views.frozen.rotation,
    views.frozen.viewedPage, views.original.page, views.original.zoom, views.original.rotation, views.original.viewedPage],
  () => saveState()
);

function freshView(): ViewState {
  return { page: 1, pageCount: 0, zoom: 1, rotation: 0, viewedPage: 0, loading: true, error: "" };
}

function setCanvas(key: DocumentKey, element: Element | null) {
  if (!(element instanceof HTMLCanvasElement)) {
    delete canvases[key];
    return;
  }
  canvases[key] = element;
  void render(key);
}

async function loadDocuments() {
  const generation = ++documentLoadGeneration;
  await Promise.all(documentKeys.map(async (key) => {
    documents[key] = undefined;
    Object.assign(views[key], freshView());
    try {
      const url = key === "frozen" ? props.frozenPreviewUrl : props.originalPreviewUrl;
      const document = await getDocument({ url, withCredentials: true }).promise;
      if (generation !== documentLoadGeneration) {
        return;
      }
      documents[key] = document;
      views[key].pageCount = document.numPages;
      views[key].loading = false;
    } catch (error) {
      if (generation !== documentLoadGeneration) return;
      views[key].loading = false;
      views[key].error = formatUnknownApiError(error, "PDF 预览暂不可用，请重新申请查看。");
    }
  }));
  if (generation !== documentLoadGeneration) return;
  restoreState();
  await nextTick();
  if (generation !== documentLoadGeneration) return;
  await Promise.all(documentKeys.map((key) => render(key)));
}

function changePage(offset: number) {
  applyToActive((view) => { view.page = clamp(view.page + offset, 1, view.pageCount); });
}

function changeZoom(offset: number) {
  applyToActive((view) => { view.zoom = clamp(Number((view.zoom + offset).toFixed(1)), 0.5, 2); });
}

function rotate() {
  applyToActive((view) => { view.rotation = (view.rotation + 90) % 360; });
}

function realign() {
  Object.assign(views.original, pickViewState(views.frozen));
  void render("original");
}

function applyToActive(change: (view: ViewState) => void) {
  const keys = syncViews.value ? documentKeys : [activeDocument.value];
  for (const key of keys) {
    change(views[key]);
    views[key].viewedPage = Math.max(views[key].viewedPage, views[key].page);
    void render(key);
  }
}

async function render(key: DocumentKey) {
  const document = documents[key];
  const canvas = canvases[key];
  if (!document || !canvas || views[key].loading || views[key].error) return;
  const generation = ++renderGenerations[key];
  const view = views[key];
  const pageNumber = clamp(view.page, 1, document.numPages);
  const zoom = view.zoom;
  const rotation = view.rotation;
  const page = await document.getPage(pageNumber);
  if (generation !== renderGenerations[key] || document !== documents[key] || canvas !== canvases[key]) return;
  const viewport = page.getViewport({ scale: zoom, rotation });
  const pixelRatio = window.devicePixelRatio || 1;
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = Math.ceil(viewport.width * pixelRatio);
  canvas.height = Math.ceil(viewport.height * pixelRatio);
  canvas.style.width = `${Math.ceil(viewport.width)}px`;
  canvas.style.height = `${Math.ceil(viewport.height)}px`;
  await page.render({ canvas, canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
  if (generation !== renderGenerations[key] || document !== documents[key] || canvas !== canvases[key]) {
    if (document === documents[key] && canvas === canvases[key]) void render(key);
    return;
  }
  view.viewedPage = Math.max(view.viewedPage, pageNumber);
}

onBeforeUnmount(() => {
  documentLoadGeneration += 1;
  for (const key of documentKeys) {
    renderGenerations[key] += 1;
  }
});

function restoreState() {
  try {
    const raw = window.localStorage.getItem(props.storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw) as StoredReviewState;
    if (!saved || !isDocumentKey(saved.activeDocument)) return;
    activeDocument.value = saved.activeDocument;
    syncViews.value = saved.syncViews !== false;
    for (const key of documentKeys) Object.assign(views[key], normalizedState(saved[key], views[key].pageCount));
  } catch {
    // Local recovery must never block a private PDF review.
  }
}

function saveState() {
  try {
    const value: StoredReviewState = {
      activeDocument: activeDocument.value,
      syncViews: syncViews.value,
      frozen: pickViewState(views.frozen),
      original: pickViewState(views.original)
    };
    window.localStorage.setItem(props.storageKey, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in private browsing; PDF review remains usable.
  }
}

function pickViewState(view: ViewState): Pick<ViewState, "page" | "zoom" | "rotation" | "viewedPage"> {
  return { page: view.page, zoom: view.zoom, rotation: view.rotation, viewedPage: view.viewedPage };
}

function normalizedState(input: Partial<ViewState> | undefined, pageCount: number) {
  return {
    page: clamp(Number(input?.page) || 1, 1, Math.max(1, pageCount)),
    zoom: clamp(Number(input?.zoom) || 1, 0.5, 2),
    rotation: [0, 90, 180, 270].includes(Number(input?.rotation)) ? Number(input?.rotation) : 0,
    viewedPage: clamp(Number(input?.viewedPage) || 0, 0, Math.max(0, pageCount))
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function isDocumentKey(value: unknown): value is DocumentKey {
  return value === "frozen" || value === "original";
}
</script>

<style scoped>
.pdf-comparison-panel { display: grid; gap: var(--jg-space-md); }
.panel-heading, .review-controls, .pdf-viewport > header { display: flex; align-items: center; gap: var(--jg-space-sm); }
.panel-heading { justify-content: space-between; }
.panel-heading > div { display: grid; gap: var(--jg-space-xs); }
.panel-heading span, .review-controls, .pdf-viewport > header, .pdf-loading { color: var(--jg-text-subtle); font-size: var(--jg-font-meta); }
.review-controls { flex-wrap: wrap; }
.mobile-document-switch { display: none; }
.pdf-viewports { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-md); }
.pdf-viewport { display: grid; gap: var(--jg-space-sm); min-width: 0; }
.pdf-viewport > header { justify-content: space-between; }
.canvas-shell { min-height: 360px; overflow: auto; padding: var(--jg-space-sm); border: 1px solid var(--jg-border); border-radius: var(--jg-radius-sm); background: var(--jg-bg-page); }
.canvas-shell canvas { display: block; max-width: none; margin: 0 auto; background: var(--jg-bg-panel); }
@media (max-width: 760px) {
  .mobile-document-switch { display: block; }
  .pdf-viewports { display: block; }
  .pdf-viewport { display: none; }
  .pdf-viewport--active { display: grid; }
  .canvas-shell { min-height: 300px; }
}
</style>

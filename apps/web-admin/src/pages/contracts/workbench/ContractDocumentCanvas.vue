<template>
  <section
    class="document-canvas"
    aria-labelledby="document-canvas-title"
  >
    <header class="canvas-toolbar">
      <div>
        <h2 id="document-canvas-title">
          合同正文画布
        </h2>
        <p>只读展示当前草稿对应的合同文档状态。</p>
      </div>
      <t-tag
        :theme="stateTheme"
        variant="light"
      >
        {{ stateLabel }}
      </t-tag>
    </header>

    <div class="canvas-stage jg-workspace-scroll">
      <article class="document-paper">
        <template v-if="state.kind === 'ready'">
          <p class="document-purpose">
            {{ purposeLabel }}
          </p>
          <h3>
            {{ contractName || "未命名合同" }}
          </h3>
          <div class="document-rule" />
          <p class="document-lead">
            当前草稿的最新 PDF 已生成。
          </p>
          <dl class="document-meta">
            <div>
              <dt>文书内容</dt>
              <dd>D{{ state.document?.documentContentRevision ?? documentContentRevision }}</dd>
            </div>
            <div>
              <dt>生成时间</dt>
              <dd>{{ generatedAtText }}</dd>
            </div>
          </dl>
          <p class="secure-note">
            正式内容通过右侧“文档”页签安全打开，需要当前密码和下载原因并记录审计。
          </p>
        </template>

        <template v-else-if="state.kind === 'processing'">
          <div class="canvas-empty">
            <h3>合同文档生成中</h3>
            <p>生成完成后，这里会显示当前草稿对应的正文状态。</p>
          </div>
        </template>

        <template v-else-if="state.kind === 'outdated'">
          <div class="canvas-empty">
            <h3>合同正文已过期</h3>
            <p>结构化数据已有更新，请重新生成合同文档后再预览或送审。</p>
          </div>
        </template>

        <template v-else-if="state.kind === 'failed'">
          <div class="canvas-empty">
            <h3>合同文档生成失败</h3>
            <p>请到右侧“文档”页签查看失败记录并重试。</p>
          </div>
        </template>

        <template v-else>
          <div class="canvas-empty">
            <h3>尚未生成合同正文</h3>
            <p>先完善右侧业务信息，再到“文档”页签选择版式并生成 PDF。</p>
          </div>
        </template>
      </article>
    </div>

    <footer class="canvas-footer">
      <span>画布不直接暴露私有文件地址。</span>
      <t-button
        variant="outline"
        @click="emit('open-documents')"
      >
        {{ state.kind === "ready" ? "安全打开正文" : "前往文档操作" }}
      </t-button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  contractDocumentCanvasState,
  type ContractDocumentCanvasRecord
} from "./contract-document-canvas";

const props = defineProps<{
  contractName: string;
  documentContentRevision: number;
  documentContentFingerprint: string | null;
  documents: ContractDocumentCanvasRecord[];
}>();

const emit = defineEmits<{
  (event: "open-documents"): void;
}>();

const state = computed(() =>
  contractDocumentCanvasState(
    props.documents,
    props.documentContentRevision,
    props.documentContentFingerprint
  )
);

const stateLabel = computed(
  () =>
    ({
      ready: "正文可预览",
      outdated: "需要重新生成",
      processing: "正在生成",
      failed: "生成失败",
      empty: "尚未生成"
    })[state.value.kind]
);

const stateTheme = computed<"success" | "warning" | "primary" | "danger" | "default">(
  () =>
    ({
      ready: "success",
      outdated: "warning",
      processing: "primary",
      failed: "danger",
      empty: "default"
    })[state.value.kind] as "success" | "warning" | "primary" | "danger" | "default"
);

const purposeLabel = computed(
  () =>
    ({
      draft: "合同草稿",
      negotiation: "对外磋商稿",
      internal_review: "内部送审稿"
    })[String(state.value.document?.purpose ?? "")] ?? "合同正文"
);

const generatedAtText = computed(() => {
  const value = state.value.document?.completedAt ?? state.value.document?.createdAt;
  if (!value) return "时间未知";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString();
});
</script>

<style scoped>
.document-canvas {
  display: grid;
  grid-template-rows: auto minmax(560px, 1fr) auto;
  min-width: 0;
  min-height: 720px;
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  overflow: hidden;
  container-name: contract-document-canvas;
  container-type: inline-size;
}

.canvas-toolbar,
.canvas-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md) var(--jg-space-lg);
}

.canvas-toolbar {
  border-bottom: 1px solid var(--jg-border);
}

.canvas-toolbar h2,
.canvas-toolbar p,
.document-paper h3,
.document-paper p {
  margin: 0;
}

.canvas-toolbar h2 {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.canvas-toolbar p,
.canvas-footer,
.document-meta dt,
.secure-note,
.canvas-empty p {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.canvas-stage {
  display: grid;
  place-items: start center;
  min-width: 0;
  padding: var(--jg-space-xl);
  background: var(--jg-bg-muted);
  overflow: auto;
}

.document-paper {
  display: grid;
  align-content: start;
  width: min(100%, 640px);
  min-height: 760px;
  padding: calc(var(--jg-space-xl) * 2) var(--jg-space-xl);
  color: var(--jg-text-main);
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.document-purpose {
  text-align: center;
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.document-paper h3 {
  margin-top: var(--jg-space-lg);
  text-align: center;
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
  line-height: 1.5;
}

.document-rule {
  height: 1px;
  margin: var(--jg-space-xl) 0;
  background: var(--jg-border);
}

.document-lead {
  font-size: var(--jg-font-body);
  line-height: 1.8;
}

.document-meta {
  display: grid;
  gap: var(--jg-space-md);
  margin: var(--jg-space-xl) 0 0;
}

.document-meta div {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: var(--jg-space-md);
}

.document-meta dd {
  margin: 0;
  font-size: var(--jg-font-body);
}

.secure-note {
  align-self: end;
  margin-top: auto !important;
  padding-top: var(--jg-space-xl);
  line-height: 1.7;
}

.canvas-empty {
  display: grid;
  align-self: center;
  gap: var(--jg-space-sm);
  margin: auto;
  text-align: center;
}

.canvas-empty h3 {
  margin: 0;
  font-size: var(--jg-font-section-title);
}

.canvas-empty p {
  max-width: 360px;
  line-height: 1.7;
}

.canvas-footer {
  border-top: 1px solid var(--jg-border);
}

@container contract-document-canvas (max-width: 720px) {
  .document-canvas {
    grid-template-rows: auto minmax(420px, 1fr) auto;
    min-height: 560px;
  }

  .document-paper {
    min-height: 520px;
  }
}
</style>

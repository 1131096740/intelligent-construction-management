<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>标准条款库</h1>
        <p>当前后端只提供最新已发布条款列表；草稿创建后请先提交，再用返回版本 ID 发布</p>
      </div>
      <t-space>
        <t-input
          v-model="category"
          placeholder="分类筛选，如 payment"
        />
        <t-button @click="loadClauses">
          查询
        </t-button>
      </t-space>
    </div>

    <t-card
      title="创建条款草稿"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>编码</span><t-input v-model="form.code" /></label>
        <label><span>分类</span><t-input v-model="form.category" /></label>
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>标题</span><t-input v-model="form.title" /></label>
      </div>
      <t-textarea
        v-model="form.text"
        class="textarea"
        placeholder="条款正文"
      />
      <t-button
        theme="primary"
        :loading="creating"
        @click="createClause"
      >
        创建草稿
      </t-button>
    </t-card>

    <t-card
      title="提交版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid submit-grid">
        <label><span>标准条款版本 ID</span><t-input v-model="submitForm.versionId" /></label>
        <t-button
          theme="primary"
          :disabled="!submitForm.versionId.trim()"
          @click="submitClause"
        >
          提交
        </t-button>
      </div>
    </t-card>

    <t-card
      title="发布版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid publish-grid">
        <label><span>标准条款版本 ID</span><t-input v-model="publishForm.versionId" /></label>
        <label><span>发布说明</span><t-input v-model="publishForm.changeSummary" /></label>
        <t-button
          theme="primary"
          :disabled="!publishForm.versionId.trim()"
          @click="publishClause"
        >
          发布
        </t-button>
      </div>
    </t-card>

    <t-card
      title="已发布条款"
      :bordered="true"
      class="panel"
    >
      <t-table
        row-key="standardClauseVersionId"
        size="small"
        :columns="columns"
        :data="clauses"
        :loading="loading"
        empty="暂无已发布标准条款"
      >
        <template #versionNo="{ row }">
          v{{ row.versionNo }}
        </template>
        <template #content="{ row }">
          <pre class="preview">{{ JSON.stringify(row.content, null, 2) }}</pre>
        </template>
      </t-table>
      <p class="hint">
        版本历史/草稿列表后端暂未返回，本页不伪造历史数据。
      </p>
    </t-card>

    <p
      v-if="message"
      :class="['message', tone]"
    >
      {{ message }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import {
  createStandardClause,
  listPublishedStandardClauses,
  publishStandardClauseVersion,
  submitStandardClauseVersion,
  type PublishedStandardClause
} from "../../api/contract-workbench.api";

const columns = [
  { colKey: "category", title: "分类", width: 120 },
  { colKey: "code", title: "编码", width: 140 },
  { colKey: "name", title: "名称", minWidth: 160 },
  { colKey: "title", title: "标题", minWidth: 160 },
  { colKey: "versionNo", title: "版本", width: 80 },
  { colKey: "content", title: "只读正文", minWidth: 280 }
];

const category = ref("");
const clauses = ref<PublishedStandardClause[]>([]);
const loading = ref(false);
const creating = ref(false);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const form = reactive({ code: "", category: "", name: "", title: "", text: "" });
const submitForm = reactive({ versionId: "" });
const publishForm = reactive({ versionId: "", changeSummary: "" });

async function loadClauses() {
  loading.value = true;
  try {
    clauses.value = await listPublishedStandardClauses(category.value.trim() || undefined);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载条款失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function createClause() {
  creating.value = true;
  try {
    const created = await createStandardClause({
      code: form.code.trim(),
      category: form.category.trim(),
      name: form.name.trim(),
      title: form.title.trim(),
      content: { text: form.text }
    });
    submitForm.versionId = String((created as { version?: { id?: string } }).version?.id ?? "");
    message.value = "条款草稿已创建";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建条款失败";
    tone.value = "danger";
  } finally {
    creating.value = false;
  }
}

async function submitClause() {
  const versionId = submitForm.versionId.trim();
  if (!versionId) {
    message.value = "请先填写标准条款版本 ID";
    tone.value = "danger";
    return;
  }
  try {
    await submitStandardClauseVersion(versionId);
    publishForm.versionId = versionId;
    message.value = "条款版本已提交";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "提交失败";
    tone.value = "danger";
  }
}

async function publishClause() {
  const versionId = publishForm.versionId.trim();
  if (!versionId) {
    message.value = "请先填写标准条款版本 ID";
    tone.value = "danger";
    return;
  }
  try {
    await publishStandardClauseVersion(versionId, {
      changeSummary: publishForm.changeSummary.trim() || "发布标准条款"
    });
    message.value = "条款版本已发布";
    tone.value = "success";
    await loadClauses();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "发布失败";
    tone.value = "danger";
  }
}

onMounted(loadClauses);
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span, .hint { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; align-items: end; margin-bottom: 12px; }
.submit-grid { grid-template-columns: 1fr auto; }
.publish-grid { grid-template-columns: 1fr 1fr auto; }
label { display: grid; gap: 4px; }
.textarea { margin-bottom: 12px; }
.preview { max-height: 120px; overflow: auto; margin: 0; white-space: pre-wrap; }
.message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@media (max-width: 900px) { .page-head, .form-grid, .publish-grid { display: grid; grid-template-columns: 1fr; } }
</style>

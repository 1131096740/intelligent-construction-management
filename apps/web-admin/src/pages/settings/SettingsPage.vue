<template>
  <div class="settings-page">
    <t-card
      title="个人签名"
      :bordered="true"
      class="settings-card"
    >
      <p class="hint">
        上传一张签名图片（PNG/JPEG）。审批通过后生成的审批单会在你的签批行内嵌入此签名。
      </p>
      <div class="signature-row">
        <img
          v-if="signaturePreviewUrl"
          :src="signaturePreviewUrl"
          alt="当前签名"
          class="signature-preview"
        >
        <span
          v-else
          class="muted"
        >尚未上传签名</span>
      </div>
      <div class="actions">
        <input
          ref="signatureInput"
          type="file"
          accept="image/png,image/jpeg"
          @change="onSignatureSelected"
        >
        <t-button
          theme="primary"
          :loading="signatureBusy"
          :disabled="!selectedSignature"
          @click="submitSignature"
        >
          上传签名
        </t-button>
      </div>
      <div
        v-if="signatureMessage"
        :class="['msg', signatureTone]"
      >
        {{ signatureMessage }}
      </div>
    </t-card>

    <t-card
      title="公司主体字典"
      :bordered="true"
      class="settings-card"
    >
      <p class="hint">
        维护我方签约公司主体。合同创建时选择其一，名称将快照到合同与审批单抬头。
      </p>
      <ul class="entity-list">
        <li
          v-for="entity in companyEntities"
          :key="entity.id"
        >
          <strong>{{ entity.name }}</strong>
          <span
            v-if="entity.unifiedSocialCreditCode"
            class="muted"
          >
            （{{ entity.unifiedSocialCreditCode }}）
          </span>
        </li>
        <li
          v-if="companyEntities.length === 0"
          class="muted"
        >
          暂无公司主体
        </li>
      </ul>
      <div class="entity-form">
        <t-input
          v-model="entityForm.name"
          placeholder="公司主体名称"
        />
        <t-input
          v-model="entityForm.unifiedSocialCreditCode"
          placeholder="统一社会信用代码(可选)"
        />
        <t-button
          theme="primary"
          :loading="entityBusy"
          @click="submitEntity"
        >
          新增主体
        </t-button>
      </div>
      <div
        v-if="entityMessage"
        :class="['msg', entityTone]"
      >
        {{ entityMessage }}
      </div>
    </t-card>

    <t-card
      title="审批规则只读配置"
      :bordered="true"
      class="settings-card approval-settings-card"
    >
      <p class="hint">
        当前生产审批路线由后端冻结到审批实例。此处展示核心流程，不开放在线编辑。
      </p>
      <div class="approval-flow-grid">
        <article
          v-for="rule in approvalFlowRules"
          :key="rule.id"
          class="approval-flow"
        >
          <header>
            <div>
              <strong>{{ rule.title }}</strong>
              <span>{{ rule.businessType }}</span>
            </div>
            <small>只读</small>
          </header>
          <ol>
            <li
              v-for="node in rule.nodes"
              :key="`${rule.id}-${node.name}`"
            >
              <span class="node-index">{{ rule.nodes.indexOf(node) + 1 }}</span>
              <div>
                <strong>{{ node.name }}</strong>
                <p>{{ modeLabel(node.mode) }} · {{ roleNames(node.roleKeys) }}</p>
              </div>
            </li>
          </ol>
          <ul class="guardrail-list">
            <li
              v-for="item in rule.guardrails"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </article>
      </div>
    </t-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import {
  createCompanyEntity,
  fetchCompanyEntities,
  getSignatureTicket,
  uploadSignature,
  type CompanyEntityReadModel
} from "../../api/core-flow-read.api";
import {
  approvalFlowRules,
  modeLabel,
  roleNames
} from "./approval-flow-readonly.config";

const companyEntities = ref<CompanyEntityReadModel[]>([]);
const signatureInput = ref<HTMLInputElement | null>(null);
const selectedSignature = ref<File | null>(null);
const signaturePreviewUrl = ref("");
const signatureBusy = ref(false);
const signatureMessage = ref("");
const signatureTone = ref<"success" | "danger">("success");

const entityForm = reactive({ name: "", unifiedSocialCreditCode: "" });
const entityBusy = ref(false);
const entityMessage = ref("");
const entityTone = ref<"success" | "danger">("success");

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

async function loadSignature() {
  try {
    const ticket = await getSignatureTicket();
    signaturePreviewUrl.value = ticket ? apiDownloadUrl(ticket.downloadUrl) : "";
  } catch {
    signaturePreviewUrl.value = "";
  }
}

async function loadEntities() {
  try {
    companyEntities.value = await fetchCompanyEntities();
  } catch {
    companyEntities.value = [];
  }
}

onMounted(async () => {
  await Promise.all([loadSignature(), loadEntities()]);
});

function onSignatureSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedSignature.value = input.files?.[0] ?? null;
}

async function submitSignature() {
  if (!selectedSignature.value) {
    return;
  }

  signatureBusy.value = true;
  signatureMessage.value = "";
  try {
    await uploadSignature(selectedSignature.value, selectedSignature.value.name);
    signatureTone.value = "success";
    signatureMessage.value = "签名已更新。";
    selectedSignature.value = null;
    if (signatureInput.value) {
      signatureInput.value.value = "";
    }
    await loadSignature();
  } catch (error) {
    signatureTone.value = "danger";
    signatureMessage.value = error instanceof Error ? error.message : "上传签名失败";
  } finally {
    signatureBusy.value = false;
  }
}

async function submitEntity() {
  const name = entityForm.name.trim();
  if (!name) {
    entityTone.value = "danger";
    entityMessage.value = "公司主体名称不能为空";
    return;
  }

  entityBusy.value = true;
  entityMessage.value = "";
  try {
    await createCompanyEntity({
      name,
      unifiedSocialCreditCode: entityForm.unifiedSocialCreditCode.trim() || undefined
    });
    entityTone.value = "success";
    entityMessage.value = "公司主体已新增。";
    entityForm.name = "";
    entityForm.unifiedSocialCreditCode = "";
    await loadEntities();
  } catch (error) {
    entityTone.value = "danger";
    entityMessage.value = error instanceof Error ? error.message : "新增公司主体失败";
  } finally {
    entityBusy.value = false;
  }
}
</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  max-width: 720px;
}

.approval-settings-card {
  max-width: 1120px;
}

.hint {
  color: var(--td-text-color-secondary, #666);
  margin-bottom: 12px;
}

.signature-row {
  margin-bottom: 12px;
}

.signature-preview {
  max-height: 80px;
  border: 1px solid var(--td-border-level-1-color, #ddd);
  padding: 4px;
}

.actions,
.entity-form {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.entity-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}

.entity-list li {
  padding: 4px 0;
}

.muted {
  color: var(--td-text-color-placeholder, #999);
}

.msg {
  margin-top: 10px;
}

.msg.success {
  color: var(--td-success-color, #2ba471);
}

.msg.danger {
  color: var(--td-error-color, #d54941);
}

.approval-flow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.approval-flow {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--td-border-level-1-color, #ddd);
  border-radius: 8px;
  background: #fff;
}

.approval-flow header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.approval-flow header div {
  display: grid;
  gap: 4px;
}

.approval-flow header span,
.approval-flow header small {
  color: var(--td-text-color-secondary, #666);
}

.approval-flow ol,
.guardrail-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.approval-flow ol li {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 8px;
  align-items: start;
}

.node-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  color: #fff;
  background: #165dff;
  font-size: 12px;
  font-weight: 700;
}

.approval-flow ol p {
  margin: 4px 0 0;
  color: var(--td-text-color-secondary, #666);
}

.guardrail-list {
  padding-top: 8px;
  border-top: 1px solid var(--td-border-level-1-color, #ddd);
  color: var(--td-text-color-secondary, #666);
}

@media (max-width: 900px) {
  .approval-flow-grid {
    grid-template-columns: 1fr;
  }
}
</style>

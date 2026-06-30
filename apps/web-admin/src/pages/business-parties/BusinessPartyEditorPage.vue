<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1>{{ party?.name ?? "合作单位详情" }}</h1>
        <p>{{ businessPartyEditPolicy.label }}；不在 Phase 1 增加银行账户审批</p>
      </div>
      <t-button @click="loadParty">
        刷新
      </t-button>
    </div>

    <t-card
      title="新建档案版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>统一社会信用代码</span><t-input v-model="form.unifiedSocialCreditCode" /></label>
        <label><span>法定代表人</span><t-input v-model="form.legalRepresentative" /></label>
        <label><span>地址</span><t-input v-model="form.address" /></label>
        <label><span>联系人</span><t-input v-model="form.contactName" /></label>
        <label><span>联系电话</span><t-input v-model="form.contactPhone" /></label>
      </div>

      <div
        v-for="(attachment, index) in attachments"
        :key="index"
        class="attachment-row"
      >
        <select v-model="attachment.category">
          <option value="business_license">
            营业执照
          </option>
          <option value="legal_id">
            法人身份证
          </option>
          <option value="authorization">
            授权文件
          </option>
          <option value="qualification">
            资质证书
          </option>
          <option value="other">
            其他
          </option>
        </select>
        <t-input
          v-model="attachment.name"
          :placeholder="attachment.category === 'legal_id' ? '法人身份证人像面/国徽面' : '附件名称'"
        />
        <t-input
          v-model="attachment.validUntil"
          placeholder="有效期 YYYY-MM-DD"
        />
        <input
          type="file"
          @change="(event) => onAttachmentFile(index, event)"
        >
        <span class="file-id">{{ attachment.fileId || "未上传" }}</span>
      </div>
      <p class="attachment-hint">
        上传法人身份证时请分两条附件记录，并在名称中明确标注“人像面”或“国徽面”；合同生成时两面按同一 A4 页面上下居中处理。
      </p>
      <t-space>
        <t-button @click="addAttachment">
          新增附件
        </t-button>
        <t-button
          theme="primary"
          :loading="saving"
          @click="createVersion"
        >
          创建新版本
        </t-button>
      </t-space>
    </t-card>

    <t-card
      title="版本历史"
      :bordered="true"
      class="panel"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="versions"
        :loading="loading"
        empty="暂无版本"
      >
        <template #summary="{ row }">
          <div>{{ snapshot(row).name }}</div>
          <small>{{ snapshot(row).unifiedSocialCreditCode || "无统一社会信用代码" }}</small>
        </template>
        <template #attachments="{ row }">
          <div
            v-for="file in snapshot(row).attachments"
            :key="`${file.fileId}-${file.name}`"
            class="attachment-line"
          >
            {{ file.category }} · {{ file.name }} · {{ file.validUntil || "无有效期" }}
          </div>
        </template>
      </t-table>
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
import { useRoute } from "vue-router";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import { createBusinessPartyVersion, getBusinessParty } from "../../api/contract-workbench.api";
import { businessPartyEditPolicy } from "../contract-templates/contract-template.config";

interface AttachmentDraft {
  category: "business_license" | "legal_id" | "authorization" | "qualification" | "other";
  fileId: string;
  name: string;
  validUntil: string;
}

interface PartyVersionRow {
  id: string;
  versionNo: number;
  snapshot: Record<string, unknown>;
  createdAt?: string;
}

const route = useRoute();
const party = ref<Record<string, unknown> | null>(null);
const versions = ref<PartyVersionRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const form = reactive({
  name: "",
  unifiedSocialCreditCode: "",
  legalRepresentative: "",
  address: "",
  contactName: "",
  contactPhone: ""
});
const attachments = ref<AttachmentDraft[]>([]);
const columns = [
  { colKey: "versionNo", title: "版本", width: 80 },
  { colKey: "summary", title: "档案快照", minWidth: 220 },
  { colKey: "attachments", title: "附件分类 / 有效期", minWidth: 260 },
  { colKey: "createdAt", title: "创建时间", width: 180 }
];

function snapshot(row: PartyVersionRow) {
  return row.snapshot as {
    name?: string;
    unifiedSocialCreditCode?: string;
    attachments?: AttachmentDraft[];
  };
}

function fillFromLatest() {
  const latest = versions.value[0]?.snapshot as Record<string, unknown> | undefined;
  if (!latest) return;
  form.name = String(latest.name ?? "");
  form.unifiedSocialCreditCode = String(latest.unifiedSocialCreditCode ?? "");
  form.legalRepresentative = String(latest.legalRepresentative ?? "");
  form.address = String(latest.address ?? "");
  form.contactName = String(latest.contactName ?? "");
  form.contactPhone = String(latest.contactPhone ?? "");
}

function addAttachment() {
  attachments.value.push({ category: "qualification", fileId: "", name: "", validUntil: "" });
}

async function onAttachmentFile(index: number, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const name = attachments.value[index].name.trim();
    const uploaded = await uploadPrivateFile(
      file,
      name && attachments.value[index].category === "legal_id"
        ? `${name} - ${file.name}`
        : file.name
    );
    attachments.value[index].fileId = uploaded.id;
    attachments.value[index].name ||= file.name;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "上传附件失败";
    tone.value = "danger";
  }
}

async function loadParty() {
  loading.value = true;
  try {
    const data = (await getBusinessParty(String(route.params.partyId))) as {
      party: Record<string, unknown>;
      versions: PartyVersionRow[];
    };
    party.value = data.party;
    versions.value = data.versions;
    fillFromLatest();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合作单位失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function createVersion() {
  saving.value = true;
  try {
    await createBusinessPartyVersion(String(route.params.partyId), {
      name: form.name.trim(),
      unifiedSocialCreditCode: form.unifiedSocialCreditCode.trim() || undefined,
      legalRepresentative: form.legalRepresentative.trim() || undefined,
      address: form.address.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      attachments: attachments.value.filter((attachment) => attachment.fileId && attachment.name)
    });
    message.value = "新版本已创建";
    tone.value = "success";
    await loadParty();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建新版本失败";
    tone.value = "danger";
  } finally {
    saving.value = false;
  }
}

onMounted(loadParty);
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span, small { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 12px; margin-bottom: 12px; }
label { display: grid; gap: 4px; }
.attachment-row { display: grid; grid-template-columns: 150px 1fr 160px 220px 1fr; gap: 8px; align-items: center; margin-bottom: 8px; }
.attachment-row select { height: 32px; border: 1px solid #dcdfe6; border-radius: 3px; }
.file-id, .attachment-line, .message { font-size: 12px; }
.attachment-hint { margin: 4px 0 12px; color: #767f8d; font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@media (max-width: 1000px) { .page-head, .form-grid, .attachment-row { display: grid; grid-template-columns: 1fr; } }
</style>

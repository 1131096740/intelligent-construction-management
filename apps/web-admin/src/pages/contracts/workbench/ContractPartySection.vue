<template>
  <div class="workbench-section">
    <h2 class="section-title">
      合作单位与角色
    </h2>
    <p class="section-hint">
      从一阶段合作单位档案中选择，或录入临时快照。资质附件引用与有效期用于归档校验。
    </p>

    <div class="party-list">
      <div
        v-for="party in parties"
        :key="party.id"
        class="party-row"
      >
        <div class="party-head">
          <strong>{{ roleLabel(party.roleKey) }}</strong>
          <t-tag
            size="small"
            variant="light"
            :theme="party.businessPartyVersionId ? 'primary' : 'default'"
          >
            {{ party.businessPartyVersionId ? "档案引用" : "临时快照" }}
          </t-tag>
        </div>
        <div class="party-fields">
          <label
            v-for="field in snapshotFields"
            :key="field.key"
            class="field"
          >
            <span class="field-label">{{ field.label }}</span>
            <t-input
              :value="partyValue(party, field.key)"
              disabled
              :placeholder="field.placeholder"
            />
          </label>
        </div>
        <ul
          v-if="partyAttachments(party).length"
          class="snapshot-attachments"
        >
          <li
            v-for="attachment in partyAttachments(party)"
            :key="`${attachment.fileId}-${attachment.category}`"
          >
            {{ attachmentLabel(attachment.category) }}：{{ attachment.name }}
            <span v-if="attachment.validUntil">（有效期至 {{ attachment.validUntil }}）</span>
          </li>
        </ul>
      </div>

      <p
        v-if="parties.length === 0"
        class="empty"
      >
        暂无合作单位，请在加载工作台后添加。
      </p>
    </div>

    <form
      class="party-form"
      @submit.prevent="submitInlineParty"
    >
      <div class="form-head">
        <strong>录入合作单位快照</strong>
        <span>{{ message }}</span>
      </div>

      <div class="party-fields">
        <label class="field">
          <span class="field-label">合同角色</span>
          <t-select
            v-model="form.roleKey"
            :options="roleOptions"
            :disabled="disabled || busy"
          />
        </label>
        <label
          v-for="field in snapshotFields"
          :key="field.key"
          class="field"
        >
          <span class="field-label">{{ field.label }}</span>
          <t-input
            v-model="form[field.key]"
            :disabled="disabled || busy"
            :placeholder="field.placeholder"
          />
        </label>
      </div>

      <div class="attachments">
        <div class="attachment-head">
          <strong>资质附件</strong>
          <t-button
            type="button"
            size="small"
            variant="outline"
            :disabled="disabled || busy"
            @click="addAttachment"
          >
            添加附件
          </t-button>
        </div>
        <div
          v-for="(attachment, index) in attachments"
          :key="attachment.localId"
          class="attachment-row"
        >
          <t-select
            v-model="attachment.category"
            :options="attachmentCategoryOptions"
            :disabled="disabled || busy"
          />
          <t-input
            v-model="attachment.name"
            :disabled="disabled || busy"
            placeholder="附件名称"
          />
          <t-input
            v-model="attachment.validUntil"
            :disabled="disabled || busy"
            placeholder="有效期 YYYY-MM-DD"
          />
          <input
            type="file"
            :disabled="disabled || busy"
            @change="(event) => uploadAttachment(index, event)"
          >
          <t-button
            type="button"
            size="small"
            variant="text"
            :disabled="disabled || busy"
            @click="removeAttachment(index)"
          >
            移除
          </t-button>
        </div>
      </div>

      <div class="form-actions">
        <t-button
          type="submit"
          theme="primary"
          :loading="busy"
          :disabled="disabled || busy || !form.name.trim()"
        >
          保存合作单位
        </t-button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed, reactive, ref } from "vue";
import { addContractParty } from "../../../api/contract-workbench.api";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
  (event: "reload"): void;
}>();

const ROLE_LABELS: Record<string, string> = {
  party_a: "甲方",
  party_b: "乙方",
  party_c: "丙方",
  guarantor: "担保单位",
  consortium_member: "联合体成员",
  other: "其他"
};

const parties = computed(() => props.workbench?.parties ?? []);

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ label, value }));
const attachmentCategoryOptions = [
  { label: "营业执照", value: "business_license" },
  { label: "开户许可证", value: "bank_account" },
  { label: "法人身份证", value: "legal_id" },
  { label: "授权委托书", value: "authorization" },
  { label: "资质文件", value: "qualification" },
  { label: "其他", value: "other" }
];
const snapshotFields = [
  { key: "name", label: "公司名称", placeholder: "请输入公司名称" },
  { key: "unifiedSocialCreditCode", label: "纳税人识别号", placeholder: "统一社会信用代码" },
  { key: "address", label: "地址", placeholder: "注册地址/通讯地址" },
  { key: "contactPhone", label: "电话", placeholder: "联系电话" },
  { key: "legalRepresentative", label: "法人姓名", placeholder: "法定代表人姓名" },
  { key: "legalRepresentativeIdNo", label: "法人身份证号", placeholder: "身份证号码" },
  { key: "authorizedAgentName", label: "委托代理人", placeholder: "代理人姓名" },
  { key: "authorizedAgentIdNo", label: "代理人身份证号", placeholder: "身份证号码" },
  { key: "openingBank", label: "开户行", placeholder: "开户银行" },
  { key: "bankAccount", label: "开户账号", placeholder: "银行账号" },
  { key: "paymentAccount", label: "收款账号", placeholder: "不同于开户账号时填写" }
] as const;

type SnapshotFieldKey = (typeof snapshotFields)[number]["key"];

interface AttachmentForm {
  localId: string;
  category: "business_license" | "bank_account" | "legal_id" | "authorization" | "qualification" | "other";
  fileId: string;
  name: string;
  validUntil: string;
}

const form = reactive<Record<SnapshotFieldKey | "roleKey", string>>({
  roleKey: "party_b",
  name: "",
  unifiedSocialCreditCode: "",
  address: "",
  contactPhone: "",
  legalRepresentative: "",
  legalRepresentativeIdNo: "",
  authorizedAgentName: "",
  authorizedAgentIdNo: "",
  openingBank: "",
  bankAccount: "",
  paymentAccount: ""
});
const attachments = ref<AttachmentForm[]>([]);
const busy = ref(false);
const message = ref("");

function roleLabel(roleKey: string): string {
  return ROLE_LABELS[roleKey] ?? roleKey;
}

function partyValue(
  party: ContractWorkbenchReadModel["parties"][number],
  field: string
): string {
  const value = party.snapshot[field];
  return typeof value === "string" ? value : "";
}

function partyAttachments(party: ContractWorkbenchReadModel["parties"][number]) {
  const value = party.snapshot["attachments"];
  return Array.isArray(value)
    ? (value as Array<{
        category: string;
        fileId: string;
        name: string;
        validUntil?: string;
      }>)
    : [];
}

function attachmentLabel(category: string) {
  return attachmentCategoryOptions.find((option) => option.value === category)?.label ?? category;
}

function addAttachment() {
  attachments.value.push({
    localId: crypto.randomUUID(),
    category: "business_license",
    fileId: "",
    name: "",
    validUntil: ""
  });
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1);
}

async function uploadAttachment(index: number, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    const attachment = attachments.value[index];
    if (attachment) {
      attachment.fileId = uploaded.id;
      attachment.name ||= file.name;
    }
    message.value = "附件已上传";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "附件上传失败";
  } finally {
    busy.value = false;
    input.value = "";
  }
}

function buildSnapshot() {
  const snapshot: Record<string, unknown> = {};
  for (const field of snapshotFields) {
    const value = form[field.key].trim();
    if (value) snapshot[field.key] = value;
  }
  snapshot.attachments = attachments.value
    .filter((attachment) => attachment.fileId && attachment.name.trim())
    .map((attachment) => ({
      category: attachment.category,
      fileId: attachment.fileId,
      name: attachment.name.trim(),
      ...(attachment.validUntil.trim() ? { validUntil: attachment.validUntil.trim() } : {})
    }));
  return snapshot;
}

function resetForm() {
  for (const field of snapshotFields) {
    form[field.key] = "";
  }
  form.roleKey = "party_b";
  attachments.value = [];
}

async function submitInlineParty() {
  const versionId = props.workbench?.version.id;
  if (!versionId) return;
  busy.value = true;
  message.value = "";
  try {
    await addContractParty(versionId, {
      roleKey: form.roleKey,
      snapshot: buildSnapshot()
    });
    resetForm();
    message.value = "合作单位已保存";
    emit("reload");
  } catch (error) {
    message.value = error instanceof Error ? error.message : "保存合作单位失败";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #151922;
}

.section-hint {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.party-list {
  display: grid;
  gap: 16px;
}

.party-row {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.party-form {
  display: grid;
  gap: 16px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.form-head,
.attachment-head,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-head span {
  color: #0052cc;
  font-size: 12px;
}

.attachments {
  display: grid;
  gap: 12px;
}

.attachment-row {
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(140px, 1fr) minmax(130px, 160px) minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.snapshot-attachments {
  margin: 0;
  padding-left: 18px;
  color: #424955;
  font-size: 12px;
}

.party-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.party-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.empty {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}
</style>

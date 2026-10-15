<template>
  <section class="page jg-responsive-flow">
    <div class="page-head">
      <div>
        <h1>{{ party?.name ?? "合作单位详情" }}</h1>
        <p>查看合作单位当前资料与不可覆盖的历史版本。</p>
      </div>
      <t-button @click="loadParty">
        刷新
      </t-button>
    </div>

    <t-alert
      theme="info"
      title="合作单位资料维护"
      message="综合部主管和董事长可以维护资料。修改会生成新版本，已有合同和附件保留原记录。"
      class="panel"
    />

    <t-space v-if="canMaintain" class="panel">
      <t-button theme="primary" :disabled="saving || loading" @click="openEdit">修改资料</t-button>
      <t-button :disabled="saving || loading" @click="statusVisible = true">{{ party?.status === "active" ? "停用" : "重新启用" }}</t-button>
      <span>当前状态：{{ party?.status === "active" ? "启用" : "停用" }}</span>
    </t-space>
    <t-dialog
      v-model:visible="editVisible"
      header="修改合作单位资料"
      :confirm-btn="{ content: '保存新版本', loading: saving }"
      :cancel-btn="{ content: '取消', disabled: saving }"
      :close-btn="!saving"
      :close-on-overlay-click="false"
      :close-on-esc-keydown="false"
      @confirm="saveFacts"
    >
      <BusinessEntryForm v-if="definition" v-model="draft" :definition="definition" :readonly="saving" />
      <p v-if="message" role="alert">{{ message }}</p>
    </t-dialog>
    <t-dialog
      v-model:visible="statusVisible"
      :header="party?.status === 'active' ? '停用合作单位' : '重新启用合作单位'"
      body="此操作保留全部档案、历史版本和既有业务记录。确认继续？"
      :confirm-btn="{ content: '确认', loading: saving }"
      :cancel-btn="{ content: '取消', disabled: saving }"
      :close-btn="!saving"
      :close-on-overlay-click="false"
      :close-on-esc-keydown="false"
      @confirm="saveStatus"
    >
      <p v-if="message" role="alert">{{ message }}</p>
    </t-dialog>

    <t-card
      title="档案创建信息"
      :bordered="true"
      class="panel"
    >
      <t-space direction="vertical">
        <span>创建人：{{ creatorName(party) }}</span>
        <span>创建时间：{{ dateLabel(party?.createdAt) }}</span>
      </t-space>
    </t-card>

    <t-card
      title="版本历史"
      :bordered="true"
      class="panel jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="versions"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
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
        <template #createdAt="{ row }">
          <div>{{ dateLabel(row.createdAt) }}</div>
          <small>创建人：{{ creatorName(row) }}</small>
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
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { formatUnknownApiError } from "../../api/error-message";
import { getBusinessParty, getBusinessPartyMaintenanceCapability, createBusinessPartyVersion, updateBusinessPartyStatus } from "../../api/contract-workbench.api";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../components/BusinessEntryForm.vue";

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
  createdByName?: string;
  createdAt?: string;
}

const route = useRoute();
const actions = ref<string[]>([]);
const canMaintain = computed(() => actions.value.includes("update_business_party"));
const definition = shallowRef<BusinessEntrySceneDefinition | null>(null);
const draft = ref<BusinessEntryDraftPayload>({ sceneKey: "business_party", values: {} });
const editVisible = ref(false);
const statusVisible = ref(false);
const saving = ref(false);
const expectedVersionNo = ref(0);
let generation = 0;
const party = ref<Record<string, unknown> | null>(null);
const versions = ref<PartyVersionRow[]>([]);
const loading = ref(false);
const message = ref("");
const tone = ref<"danger">("danger");
const columns = [
  { colKey: "versionNo", title: "版本", width: 80 },
  { colKey: "summary", title: "档案快照", minWidth: 220 },
  { colKey: "attachments", title: "附件分类 / 有效期", minWidth: 260 },
  { colKey: "createdAt", title: "创建信息", width: 220 }
];

function snapshot(row: PartyVersionRow) {
  return row.snapshot as {
    name?: string;
    unifiedSocialCreditCode?: string;
    attachments?: AttachmentDraft[];
  };
}

function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function creatorName(value: { createdByName?: unknown } | null | undefined) {
  return typeof value?.createdByName === "string" && value.createdByName.trim()
    ? value.createdByName
    : "未记录";
}

async function loadParty() {
  const partyId = String(route.params.partyId);
  const current = ++generation;
  loading.value = true;
  actions.value = [];
  try {
    const data = (await getBusinessParty(partyId)) as { party: Record<string, unknown>; versions: PartyVersionRow[] };
    if (current !== generation) return;
    party.value = data.party;
    versions.value = data.versions;
    const capability = await getBusinessPartyMaintenanceCapability(partyId).catch(() => null);
    if (current !== generation) return;
    actions.value = capability?.availableActions ?? [];
    definition.value = capability?.definition ?? null;
  } catch (error) {
    if (current === generation) message.value = formatUnknownApiError(error, "加载合作单位失败");
  } finally { if (current === generation) loading.value = false; }
}

function openEdit() {
  const latest = versions.value[0];
  if (!latest) return;
  expectedVersionNo.value = latest.versionNo;
  draft.value = { sceneKey: "business_party", values: {
    name: latest.snapshot.name ?? "", unifiedSocialCreditCode: latest.snapshot.unifiedSocialCreditCode ?? ""
  } };
  message.value = "";
  editVisible.value = true;
}

async function saveFacts() {
  if (saving.value || !definition.value) return;
  saving.value = true;
  message.value = "";
  const partyId = String(route.params.partyId);
  const current = generation;
  const values = { ...draft.value.values };
  try {
    await savePartyVersionWithCapability(partyId, current, {
      name: String(values.name ?? "").trim(), unifiedSocialCreditCode: String(values.unifiedSocialCreditCode ?? "").trim(),
      expectedVersionNo: expectedVersionNo.value
    });
    editVisible.value = false;
    await loadParty();
  } catch (error) { message.value = formatUnknownApiError(error, "保存合作单位失败"); }
  finally { saving.value = false; }
}

async function saveStatus() {
  if (saving.value || !party.value) return;
  saving.value = true;
  message.value = "";
  const partyId = String(route.params.partyId);
  const isActive = party.value.status !== "active";
  const current = generation;
  try {
    await savePartyStatusWithCapability(partyId, isActive, current);
    statusVisible.value = false;
    await loadParty();
  } catch (error) { message.value = formatUnknownApiError(error, "更新合作单位状态失败"); }
  finally { saving.value = false; }
}

watch(() => route.params.partyId, () => {
  editVisible.value = false;
  statusVisible.value = false;
  party.value = null;
  versions.value = [];
  message.value = "";
  void loadParty();
}, { immediate: true });
async function savePartyVersionWithCapability(partyId: string, current: number, body: Parameters<typeof createBusinessPartyVersion>[1]) {
  const capability = await getBusinessPartyMaintenanceCapability(partyId);
  if (current !== generation) throw new Error("页面已变化，请重新操作");
  const operationAllowed = capability.availableActions.includes("update_business_party");
  if (!operationAllowed) throw new Error("维护权限已变化，请刷新后重试");
  return createBusinessPartyVersion(partyId, body);
}
async function savePartyStatusWithCapability(partyId: string, isActive: boolean, current: number) {
  const capability = await getBusinessPartyMaintenanceCapability(partyId);
  if (current !== generation) throw new Error("页面已变化，请重新操作");
  const operationAllowed = capability.availableActions.includes("update_business_party_status");
  if (!operationAllowed) throw new Error("维护权限已变化，请刷新后重试");
  return updateBusinessPartyStatus(partyId, isActive);
}
</script>

<style scoped>
.page { min-width: 0; color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, small { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.attachment-line, .message { font-size: 12px; }
.danger { color: #b51d2a; }
@container jg-page (max-width: 620px) {
  .page-head { display: grid; grid-template-columns: 1fr; }
}
</style>

<template>
  <section class="delegation-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>审批委托台账</h1>
        <p>临时委托明确到单据和职责；本人和受托人均可办理，任何一人完成后该职责待办同步结束。</p>
      </div>
      <t-button
        :disabled="!duties.length"
        @click="openCreate"
      >
        新建临时委托
      </t-button>
    </div>

    <t-alert
      theme="info"
      title="委托范围"
      message="当前支持零星材料申请的并联职责。其他流程的已有委托仍保留原记录；不能转交无关业务或再委托收到的职责。"
      class="readonly-alert"
    />
    <t-alert
      v-if="message"
      :theme="messageTheme"
      :message="message"
      class="readonly-alert"
    />

    <t-card
      class="ledger-panel jg-table-region jg-table-region--wide"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="rows"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无委托记录"
      >
        <template #actions="{ row }">
          <t-button
            v-if="row.reviewPath && /^\/资金余额复核\/[^/]+$/.test(row.reviewPath)"
            variant="text"
            @click="$router.push(row.reviewPath)"
          >
            办理本次余额复核
          </t-button>
          <t-button
            v-if="row.fromUserId === auth.user?.id && row.enabled"
            variant="text"
            :disabled="saving"
            @click="revoke(row.id)"
          >
            撤销委托
          </t-button>
        </template>
        <template #enabled="{ row }">
          <t-tag
            size="small"
            :theme="row.enabled ? 'success' : 'default'"
            variant="light"
          >
            {{ row.enabled ? "生效中" : "已撤销" }}
          </t-tag>
        </template>
        <template #deadlineLabel="{ row }">
          <t-tag
            size="small"
            :theme="row.deadlineTone"
            variant="light"
          >
            {{ row.deadlineLabel }}
          </t-tag>
        </template>
      </t-table>
    </t-card>
    <t-dialog
      v-if="createVisible"
      v-model:visible="createVisible"
      header="新建临时委托"
      :close-on-overlay-click="false"
      :close-btn="!saving"
      width="560px"
    >
      <div class="delegation-form">
        <label><span>待审批职责</span><t-select
          v-model="draft.resourceId"
          :options="duties"
          placeholder="选择待审批职责"
          :disabled="saving"
          @change="loadRecipients"
        /></label>
        <label><span>受托人</span><t-select
          v-model="draft.toUserId"
          :options="recipients"
          placeholder="选择受托人"
          :disabled="saving || !draft.resourceId"
        /></label>
        <label><span>生效时间（北京时间）</span><t-date-picker
          v-model="draft.startsAt"
          enable-time-picker
          format="YYYY-MM-DD HH:mm"
          value-type="YYYY-MM-DD HH:mm"
          :disabled="saving"
        /></label>
        <label><span>失效时间（北京时间）</span><t-date-picker
          v-model="draft.endsAt"
          enable-time-picker
          format="YYYY-MM-DD HH:mm"
          value-type="YYYY-MM-DD HH:mm"
          :disabled="saving"
        /></label>
        <t-alert
          v-if="createError"
          theme="error"
          :message="createError"
        />
      </div>
      <template #footer>
        <t-button
          variant="outline"
          :disabled="saving"
          @click="createVisible = false"
        >
          取消
        </t-button><t-button
          :loading="saving"
          @click="saveDelegation"
        >
          确认委托
        </t-button>
      </template>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  listApprovalDelegations,
  fetchApprovalDelegationDutyOptions,
  fetchApprovalDelegationDutyCapability,
  fetchApprovalDelegationRevokeCapability,
  fetchApprovalDelegationUserOptions,
  createApprovalDelegation,
  revokeApprovalDelegation,
  type ApprovalDelegationReadModel
} from "../../api/core-flow-read.api";
import { useAuthStore } from "../../auth/auth.store";
import {
  delegationLedgerColumns,
  mapDelegationLedgerRows
} from "./delegation-list.config";

const auth = useAuthStore();
const columns = delegationLedgerColumns;
const rawRows = ref<ApprovalDelegationReadModel[]>([]);
const rows = computed(() => mapDelegationLedgerRows(rawRows.value, auth.user?.id));
const loading = ref(false);
const message = ref("");

const duties = ref<Awaited<ReturnType<typeof fetchApprovalDelegationDutyOptions>>>([]);
const recipients = ref<Array<{value: string; label: string}>>([]);
const draft = reactive({resourceId: "", toUserId: "", startsAt: "", endsAt: ""});
const createVisible = ref(false);
const saving = ref(false);
const createError = ref("");
const messageTheme = ref<"success" | "error">("error");
const recipientGeneration = ref(0);
function openCreate() {recipientGeneration.value++;Object.assign(draft, {resourceId: "", toUserId: "", startsAt: "", endsAt: ""}); recipients.value=[]; createError.value=""; createVisible.value=true;}
async function loadRecipients() {
  const own = ++recipientGeneration.value; const dutyId = draft.resourceId; draft.toUserId=""; recipients.value=[];
  try {const rows = await fetchApprovalDelegationUserOptions(dutyId); if (own === recipientGeneration.value && dutyId === draft.resourceId) recipients.value=rows.map(row=>({value:row.id,label:row.name}));}
  catch(error) {if(own===recipientGeneration.value) createError.value=error instanceof Error?error.message:"受托人读取失败，请重试";}
}
async function createDelegationWithCapability(input: Parameters<typeof createApprovalDelegation>[0] & {resourceId: string}) {
  const selectionGeneration = recipientGeneration.value;
  const optionReceipt = duties.value;
  const startsAtReceipt = draft.startsAt;
  const endsAtReceipt = draft.endsAt;
  const capability = await fetchApprovalDelegationDutyCapability(input.resourceId);
  const operationAllowed = capability.canDelegate;
  if (!operationAllowed) throw new Error("当前职责已不能委托，请刷新后重试");
  const dialogOpen = createVisible.value;
  const currentGeneration = recipientGeneration.value;
  const currentOptions = duties.value;
  const selectedResource = input.resourceId; const currentResource = draft.resourceId;
  const selectedRecipient = input.toUserId; const currentRecipient = draft.toUserId;
  const currentStarts = draft.startsAt; const currentEnds = draft.endsAt;
  const authorizedResource = capability.resourceId;
  const authorizedAction = capability.actionKey; const selectedAction = input.actionKey;
  const authorizedType = capability.resourceType; const selectedType = input.resourceType;
  if (!dialogOpen) throw new Error("本次委托窗口已关闭，请重新确认");
  if (selectionGeneration !== currentGeneration) throw new Error("职责选择已变化，请重新确认");
  if (optionReceipt !== currentOptions) throw new Error("职责清单已变化，请刷新后重选");
  if (selectedResource !== currentResource) throw new Error("职责选择已变化，请重新确认");
  if (selectedRecipient !== currentRecipient) throw new Error("受托人已变化，请重新确认");
  if (startsAtReceipt !== currentStarts) throw new Error("生效时间已变化，请重新确认");
  if (endsAtReceipt !== currentEnds) throw new Error("失效时间已变化，请重新确认");
  if (authorizedResource !== selectedResource) throw new Error("职责范围已变化，请刷新后重选");
  if (authorizedAction !== selectedAction) throw new Error("职责范围已变化，请刷新后重选");
  if (authorizedType !== selectedType) throw new Error("职责范围已变化，请刷新后重选");
  return createApprovalDelegation(input);
}
async function revokeDelegationWithCapability(id: string) {
  const capability = await fetchApprovalDelegationRevokeCapability(id);
  const operationAllowed = capability.canRevoke;
  if (!operationAllowed) throw new Error("当前无权撤销该委托，请刷新后重试");
  return revokeApprovalDelegation(id);
}
const delegationInput = computed(() => {
  if(!draft.resourceId||!draft.toUserId)throw new Error("请选择明确职责和受托人");
  const chinaTime=(value:string)=> {if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))throw new Error("请填写正确的起止时间"); const time=new Date(`${value.replace(" ","T")}:00+08:00`);if(!Number.isFinite(time.getTime()))throw new Error("请填写正确的起止时间");return time.toISOString();};
  const startsAt=chinaTime(draft.startsAt);const endsAt=chinaTime(draft.endsAt);if(endsAt<=startsAt)throw new Error("失效时间必须晚于生效时间");
  const selected = duties.value.find(option => option.value === draft.resourceId);
  if (!selected) throw new Error("所选职责已不在当前可委托清单，请刷新后重选");
  const { actionKey, resourceType } = selected;
  if (!((actionKey === "spot_procurement.approve" && resourceType === "spot_procurement_approval_duty") || (actionKey === "fund_account.balance.review" && resourceType === "fund_account_balance_review_duty") || (actionKey === "general_procurement.approve" && resourceType === "general_procurement_approval_duty"))) throw new Error("所选职责范围不完整或不受支持，请刷新后重选");
  const scope = actionKey === "spot_procurement.approve"
    ? { actionKey, resourceType: "spot_procurement_approval_duty" as const }
    : actionKey === "general_procurement.approve"
      ? { actionKey, resourceType: "general_procurement_approval_duty" as const }
      : { actionKey, resourceType: "fund_account_balance_review_duty" as const };
  return { ...scope, toUserId:draft.toUserId,startsAt,endsAt,resourceId:selected.value};
});
async function saveDelegation() {
  if(saving.value)return; createError.value="";
  try {
    const input = delegationInput.value;
    saving.value=true;
    await createDelegationWithCapability(input);
    createVisible.value=false;messageTheme.value="success";message.value="委托已保存，本人与受托人均可办理当前职责。";await loadDelegations();
  } catch(error){createError.value=error instanceof Error?error.message:"委托保存失败，请重试";}finally{saving.value=false;}
}
async function revoke(id:string) {
  if(saving.value)return;saving.value=true;
  try{await revokeDelegationWithCapability(id);messageTheme.value="success";message.value="委托已撤销，受托人不能再办理该职责。";await loadDelegations();}
  catch(error){messageTheme.value="error";message.value=error instanceof Error?error.message:"撤销失败，请重试";}finally{saving.value=false;}
}

async function loadDelegations() {
  loading.value = true;
  try {
    const [records, options] = await Promise.all([listApprovalDelegations(), fetchApprovalDelegationDutyOptions()]);
    rawRows.value = records; duties.value = options;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载委托失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadDelegations());
</script>

<style scoped>
.delegation-form, .delegation-form label {display:grid;gap:var(--jg-space-sm);}
.delegation-form {gap:var(--jg-space-md);}

.delegation-page {
  width: 100%;
  min-width: 0;
  color: #151922;
}

.page-head {
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.readonly-alert {
  margin-bottom: 16px;
}

.ledger-panel {
  border-radius: 3px;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}
</style>

<template>
  <section class="page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>合作单位档案</h1>
        <p>按名称或统一社会信用代码检索；档案变更进入新版本，不覆盖历史</p>
      </div>
      <t-space class="query-actions">
        <t-input
          v-model="query"
          placeholder="名称 / 统一社会信用代码"
        />
        <t-button @click="loadParties">
          查询
        </t-button>
      </t-space>
    </div>

    <t-card
      title="创建合作单位"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>统一社会信用代码</span><t-input v-model="form.unifiedSocialCreditCode" /></label>
        <label><span>法定代表人</span><t-input v-model="form.legalRepresentative" /></label>
        <label><span>联系人</span><t-input v-model="form.contactName" /></label>
        <label><span>联系电话</span><t-input v-model="form.contactPhone" /></label>
        <t-button
          theme="primary"
          :loading="creating"
          @click="createParty"
        >
          创建档案
        </t-button>
      </div>
    </t-card>

    <t-card
      :bordered="true"
      class="panel jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="parties"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无合作单位"
      >
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="go(row.id)"
          >
            详情/新版本
          </t-link>
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
import { useRouter } from "vue-router";
import { createBusinessParty, listBusinessParties } from "../../api/contract-workbench.api";

interface PartyRow {
  id: string;
  name?: string;
  unifiedSocialCreditCode?: string | null;
  createdAt?: string;
}

const router = useRouter();
const columns = [
  { colKey: "name", title: "名称", minWidth: 180 },
  { colKey: "unifiedSocialCreditCode", title: "统一社会信用代码", minWidth: 180 },
  { colKey: "createdAt", title: "创建时间", width: 180 },
  { colKey: "operation", title: "操作", width: 120, fixed: "right" }
];
const query = ref("");
const parties = ref<PartyRow[]>([]);
const loading = ref(false);
const creating = ref(false);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const form = reactive({
  name: "",
  unifiedSocialCreditCode: "",
  legalRepresentative: "",
  contactName: "",
  contactPhone: ""
});

function go(id: string) {
  void router.push(`/business-parties/${id}`);
}

async function loadParties() {
  loading.value = true;
  try {
    parties.value = (await listBusinessParties(query.value.trim() || undefined)) as PartyRow[];
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合作单位失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function createParty() {
  creating.value = true;
  try {
    const created = await createBusinessParty({
      name: form.name.trim(),
      unifiedSocialCreditCode: form.unifiedSocialCreditCode.trim() || undefined,
      legalRepresentative: form.legalRepresentative.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      attachments: []
    });
    const partyId = (created as { party?: { id?: string } }).party?.id;
    message.value = "合作单位档案已创建";
    tone.value = "success";
    if (partyId) go(partyId);
    await loadParties();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建合作单位失败";
    tone.value = "danger";
  } finally {
    creating.value = false;
  }
}

onMounted(loadParties);
</script>

<style scoped>
.page { min-width: 0; color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(6, minmax(130px, 1fr)); gap: 12px; align-items: end; }
.query-actions { flex-wrap: wrap; }
label { display: grid; gap: 4px; }
.message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@container jg-page (max-width: 840px) { .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container jg-page (max-width: 620px) { .page-head, .form-grid { display: grid; grid-template-columns: 1fr; } }
</style>

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
      title="上线准备期间暂为只读"
      message="当前可查看档案版本与既有附件事实；版本新增和附件上传将在主数据治理完成后重新开放。"
      class="panel"
    />

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
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getBusinessParty } from "../../api/contract-workbench.api";

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
const message = ref("");
const tone = ref<"danger">("danger");
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

async function loadParty() {
  loading.value = true;
  try {
    const data = (await getBusinessParty(String(route.params.partyId))) as {
      party: Record<string, unknown>;
      versions: PartyVersionRow[];
    };
    party.value = data.party;
    versions.value = data.versions;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合作单位失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

onMounted(loadParty);
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

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
          <label class="field">
            <span class="field-label">单位名称</span>
            <t-input
              :value="partyValue(party.id, 'name')"
              :disabled="disabled"
              placeholder="单位名称"
              @change="(value: string) => updateParty(party.id, 'name', value)"
            />
          </label>
          <label class="field">
            <span class="field-label">资质附件引用</span>
            <t-input
              :value="partyValue(party.id, 'qualificationFileId')"
              :disabled="disabled"
              placeholder="资质文件ID"
              @change="(value: string) => updateParty(party.id, 'qualificationFileId', value)"
            />
          </label>
          <label class="field">
            <span class="field-label">资质有效期至</span>
            <t-input
              :value="partyValue(party.id, 'qualificationValidUntil')"
              :disabled="disabled"
              placeholder="YYYY-MM-DD"
              @change="(value: string) => updateParty(party.id, 'qualificationValidUntil', value)"
            />
          </label>
        </div>
      </div>

      <p
        v-if="parties.length === 0"
        class="empty"
      >
        暂无合作单位，请在加载工作台后添加。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();

const ROLE_LABELS: Record<string, string> = {
  party_a: "甲方",
  party_b: "乙方",
  subcontractor: "分包单位",
  supplier: "供应单位",
  guarantor: "担保单位"
};

const parties = computed(() => props.workbench?.parties ?? []);

function roleLabel(roleKey: string): string {
  return ROLE_LABELS[roleKey] ?? roleKey;
}

function partyValue(partyId: string, field: string): string {
  const bag = props.model.partyValues[partyId];
  if (bag && typeof bag === "object" && field in (bag as Record<string, unknown>)) {
    const value = (bag as Record<string, unknown>)[field];
    return typeof value === "string" ? value : "";
  }
  return "";
}

function updateParty(partyId: string, field: string, value: string) {
  const bag = { ...((props.model.partyValues[partyId] as Record<string, unknown>) ?? {}) };
  bag[field] = value;
  emit("update", { partyValues: { ...props.model.partyValues, [partyId]: bag } });
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

<script setup lang="ts">
import { computed,onMounted,ref } from "vue";
import { useRoute } from "vue-router";
import { attachSpotProcurementReceiptPhoto,createSpotProcurementReceiptDelegation,deleteSpotProcurementReceiptPhoto,fetchSpotProcurementDetail,fetchSpotProcurementReceipt,reviewSpotProcurementReceipt,revokeSpotProcurementReceiptReview,submitSpotProcurementReceipt,updateSpotProcurementReceiptDraft,type SpotProcurementDetailReadModel,type SpotProcurementReceiptDetailReadModel,type SpotProcurementReceiptLineReadModel } from "../../api/spot-procurement.api";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import ReceiptLineEditor from "./components/ReceiptLineEditor.vue";
import ReceiptPhotoUploader from "./components/ReceiptPhotoUploader.vue";

const route=useRoute(); const receipt=ref<SpotProcurementReceiptDetailReadModel|null>(null); const detail=ref<SpotProcurementDetailReadModel|null>(null); const lines=ref<SpotProcurementReceiptLineReadModel[]>([]); const busy=ref(false); const error=ref(""); const message=ref(""); const delegateUserId=ref("");
const procurementId=computed(()=>String(route.params.procurementId||"")); const readonly=computed(()=>receipt.value?.receipt.status==='locked'||detail.value?.procurement.status==='closed'); const latestApprovedReview=computed(()=>[...(receipt.value?.reviews??[])].reverse().find(item=>item.decision==='approved'));
async function load(){busy.value=true;error.value="";try{[receipt.value,detail.value]=await Promise.all([fetchSpotProcurementReceipt(procurementId.value),fetchSpotProcurementDetail(procurementId.value)]);lines.value=receipt.value.lines.map(line=>({...line,qualifiedQuantity:line.qualifiedQuantity??line.approvedQuantity,unqualifiedQuantity:line.unqualifiedQuantity??'0',freeGiftQuantity:line.freeGiftQuantity??'0',replenishmentPending:line.replenishmentPending??false}));}catch(e){error.value=e instanceof Error?e.message:'读取收货详情失败';}finally{busy.value=false;}}
async function act(task:()=>Promise<unknown>,success:string){busy.value=true;error.value="";try{await task();message.value=success;await load();}catch(e){error.value=e instanceof Error?e.message:'操作失败';}finally{busy.value=false;}}
const save=()=>act(()=>updateSpotProcurementReceiptDraft(procurementId.value,{note:receipt.value?.receipt.note,lines:lines.value.map(line=>({procurementLineId:line.procurementLineId,qualifiedQuantity:line.qualifiedQuantity??'0',unqualifiedQuantity:line.unqualifiedQuantity??'0',...(line.unqualifiedReason?{unqualifiedReason:line.unqualifiedReason}:{}),freeGiftQuantity:line.freeGiftQuantity??'0',replenishmentPending:Boolean(line.replenishmentPending),...(line.discrepancyNote?{discrepancyNote:line.discrepancyNote}:{})}))}),"收货草稿已保存");
async function upload(payload:{file:File;source:'camera'|'album';category:'material_scene'|'delivery_note';note:string;appendReason:string}){await act(async()=>{const file=await uploadPrivateFile(payload.file,payload.file.name);await attachSpotProcurementReceiptPhoto(procurementId.value,{originalFileId:file.id,source:payload.source,category:payload.category,...(payload.note.trim()?{note:payload.note.trim()}:{}),...(payload.appendReason.trim()?{appendReason:payload.appendReason.trim()}:{})});},"照片已上传并由服务端生成水印");}
onMounted(load);
</script>
<template>
  <section class="page">
    <BusinessFeedback
      v-if="error&&!receipt"
      state="permission"
      title="收货详情暂不可用"
      :description="error"
      action-label="重试"
      @action="load"
    /><template v-if="receipt&&detail">
      <BusinessDetailHeader
        :business-code="receipt.receipt.procurementCode"
        :title="`${detail.procurement.project.name} · 最终收货`"
        :status="receipt.receipt.status"
        :owner="receipt.receipt.handler.name"
        :current-node="receipt.receipt.status==='submitted'?'物资主管复核':'收货办理'"
        next-step="满足付款、收货和票据条件后自动办结"
        :requested-amount="`${receipt.receipt.actualCostCents} 分`"
        amount-label="实际采购成本"
      /><t-alert
        v-if="readonly"
        theme="success"
        title="采购已办结"
        message="办结后收货、差异、退款和票据事实全部只读，不允许撤销、退回或更正。"
      /><BusinessFeedback
        v-if="message||error"
        :state="error?'error':'success'"
        :title="error?'操作未完成':'操作已完成'"
        :description="error||message"
      /><t-card title="人员与委托">
        <dl class="people">
          <div><dt>采购经办人</dt><dd>{{ receipt.receipt.handler.name }}</dd></div><div><dt>实际提交人</dt><dd>{{ receipt.receipt.submittedBy?.name||'尚未提交' }}</dd></div><div><dt>受托人</dt><dd>{{ receipt.delegation?.delegateName||'未委托' }}</dd></div>
        </dl><div
          v-if="!readonly"
          class="delegate"
        >
          <t-input
            v-model="delegateUserId"
            placeholder="同项目受托人用户 ID"
          /><t-button
            :disabled="!delegateUserId"
            @click="act(()=>createSpotProcurementReceiptDelegation(procurementId,delegateUserId),'委托已生效')"
          >
            确认委托
          </t-button>
        </div>
      </t-card><t-card title="最终收货明细">
        <ReceiptLineEditor
          :lines="lines"
          :readonly="readonly||receipt.receipt.status==='submitted'||receipt.receipt.status==='reviewed'"
          @change="lines=$event"
        /><div
          v-if="!readonly&&['draft','returned','review_revoked'].includes(receipt.receipt.status)"
          class="actions"
        >
          <t-button
            variant="outline"
            :loading="busy"
            @click="save"
          >
            保存草稿
          </t-button><t-button
            theme="primary"
            :loading="busy"
            @click="act(()=>submitSpotProcurementReceipt(procurementId),'已提交物资主管复核')"
          >
            提交最终收货
          </t-button>
        </div>
      </t-card><t-card title="收货照片">
        <ReceiptPhotoUploader
          :photos="receipt.photos"
          :readonly="readonly"
          :busy="busy"
          @upload="upload"
          @remove="id=>act(()=>deleteSpotProcurementReceiptPhoto(procurementId,id),'照片已删除')"
        />
      </t-card><t-card title="物资主管复核">
        <div
          v-if="!readonly&&receipt.receipt.status==='submitted'"
          class="actions"
        >
          <t-button
            theme="primary"
            @click="act(()=>reviewSpotProcurementReceipt(procurementId,{decision:'approved'}),'复核已通过')"
          >
            复核通过
          </t-button><t-button
            variant="outline"
            @click="act(()=>reviewSpotProcurementReceipt(procurementId,{decision:'returned',comment:'请经办人核对收货事实'}),'已退回经办人')"
          >
            退回
          </t-button>
        </div><div class="reviews">
          <p
            v-for="review in receipt.reviews"
            :key="review.id"
          >
            {{ review.reviewedBy.name }} · {{ review.decision }} · {{ review.createdAt }} · {{ review.comment||'无意见' }}
          </p>
        </div><t-button
          v-if="!readonly&&receipt.receipt.status==='reviewed'&&latestApprovedReview"
          theme="danger"
          variant="outline"
          @click="act(()=>revokeSpotProcurementReceiptReview(procurementId,{targetReviewId:latestApprovedReview!.id,reason:'复核事实需重新核对',confirmReviewRevocation:true}),'复核已撤销')"
        >
          办结前撤销复核
        </t-button>
      </t-card><t-card title="付款、差异与发票">
        <t-alert
          theme="info"
          title="付款与收货按事实分别归档"
          :message="`当前付款状态：${detail.paymentSummary.statusLabel}。少货且已付款时，只允许商户补货，或由财务登记退款并上传凭证；不再转商户余额。`"
        />
        <t-alert
          theme="info"
          title="发票资料"
          :message="detail.invoice?.statusLabel ?? '付款后可追加一张关联整张付款申请的发票；发票不是采购办结条件。'"
        />
      </t-card>
    </template>
  </section>
</template>
<style scoped>.page{display:grid;gap:var(--jg-space-lg)}.people{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--jg-space-md)}dd{margin:4px 0 0}.delegate,.actions{display:flex;gap:var(--jg-space-sm);margin-top:var(--jg-space-md)}.reviews{display:grid;gap:var(--jg-space-xs)}@media(max-width:720px){.people{grid-template-columns:1fr}.delegate,.actions{flex-wrap:wrap}}</style>

<script setup lang="ts">
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
</script>

<template>
  <section class="spot-receipt-placeholder">
    <BusinessPageHeader
      title="收货确认工作台"
      description="零星采购按一单一次最终收货管理；分车到场时可在同一次确认中上传多张照片。"
    />

    <t-alert
      theme="info"
      title="代码阶段 B 完成后开放"
      message="当前阶段尚未开放收货、照片水印、委托和物资主管复核，因此本页不会伪造“未收货”记录，也不会采集定位或展示虚假收货结果。"
    />

    <t-card
      bordered
      title="已确认的后续办理边界"
    >
      <ul>
        <li>采购经办人可拍照或从相册上传，并自行确认收货。</li>
        <li>经办人可委托同项目其他人员上传照片并确认。</li>
        <li>系统为收货照片自动生成类似水印相机的信息卡，不采集定位。</li>
        <li>送货单照片可选；物资主管完成独立复核。</li>
      </ul>
    </t-card>
  </section>
</template>

<style scoped>
.spot-receipt-placeholder {
  display: grid;
  gap: var(--jg-space-lg);
  color: var(--jg-color-text-primary);
}

.spot-receipt-placeholder ul {
  display: grid;
  gap: var(--jg-space-sm);
  margin: 0;
  padding-left: var(--jg-space-xl);
  color: var(--jg-color-text-secondary);
  line-height: var(--jg-line-height-body);
}
</style>

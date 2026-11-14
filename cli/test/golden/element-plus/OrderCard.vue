<script setup lang="ts">
const title = "Order summary";
</script>

<template>
  <section class="order-card" data-figma-id="900:1">
    <h2 class="title" data-figma-id="900:2">{{ title }}</h2>
    <p class="body" data-figma-id="900:3">Two items, ready to ship.</p>
  </section>
</template>

<style scoped>
.order-card {
  display: flex;
  flex-direction: column;
  margin: 0;
  /* Element Plus has no spacing scale: its one global 20px spacing token (--el-card-padding exists only inside .el-card). */
  padding: var(--el-menu-base-level-padding, 20px);
  background-color: var(--el-bg-color, #ffffff);
}

.title {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: var(--el-font-size-extra-large, 20px);
  font-weight: normal;
  line-height: var(--el-font-line-height-primary, 24px);
}

.body {
  margin: 0;
  color: var(--el-text-color-regular, #606266);
  font-size: var(--el-font-size-base, 14px);
  font-weight: normal;
  line-height: var(--el-font-line-height-primary, 24px);
}
</style>

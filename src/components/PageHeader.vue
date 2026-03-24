<template>
  <header class="page-header card">
    <RouterLink class="home-link" to="/" aria-label="返回首页">
      <span class="home-link__icon">⌂</span>
      <span>返回首页</span>
    </RouterLink>
    <div class="page-header__content">
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

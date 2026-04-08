<template>
  <main
    class="blackout-page"
    role="button"
    tabindex="0"
    aria-label="黑屏页面，点击可退出"
    @click="exitBlackout"
    @keydown.enter.prevent="exitBlackout"
    @keydown.space.prevent="exitBlackout"
  ></main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { resolveBlackoutReturnPath } from '../utils/blackoutRoute';

const router = useRouter();
const route = useRoute();
const fallbackPath = '/';
const returnPath = computed(() => resolveBlackoutReturnPath(route.query.from, fallbackPath));

function exitBlackout(): void {
  void router.replace(returnPath.value);
}

function toggleBlackoutModeClass(active: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle('blackout-route-active', active);
  document.body.classList.toggle('blackout-route-active', active);
}

onMounted(() => {
  toggleBlackoutModeClass(true);
});

onBeforeUnmount(() => {
  toggleBlackoutModeClass(false);
});
</script>

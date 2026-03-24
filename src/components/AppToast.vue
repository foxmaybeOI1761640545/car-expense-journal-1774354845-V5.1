<template>
  <transition name="toast-fade">
    <div v-if="visible" class="app-toast" :class="`app-toast--${type}`" role="status" @click="$emit('close')">
      {{ message }}
    </div>
  </transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}>();

defineEmits<{
  close: [];
}>();
</script>

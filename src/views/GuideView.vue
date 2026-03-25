<template>
  <main class="page page--guide">
    <PageHeader title="应用使用说明" description="快速了解配置来源、优先级规则与 GitHub 同步建议。" />

    <section class="guide-grid">
      <article class="card guide-card">
        <h2>配置来源</h2>
        <p>应用启动时会读取两份配置：</p>
        <ul class="guide-list">
          <li><code>public/config/app-config.json</code>：随页面发布的默认配置。</li>
          <li><code>localStorage</code>：你在首页“页面设置”保存后的本地配置。</li>
        </ul>
      </article>

      <article class="card guide-card">
        <h2>优先级模式</h2>
        <p>首页“页面设置”中的开关会决定最终生效来源：</p>
        <ul class="guide-list">
          <li>未勾选：<strong>localStorage 优先</strong>，配置文件作为兜底默认值。</li>
          <li>已勾选：<strong>配置文件优先</strong>，配置文件会覆盖同名 localStorage 配置。</li>
        </ul>
      </article>

      <article class="card guide-card">
        <h2>GitHub 同步设置</h2>
        <ul class="guide-list">
          <li><strong>GitHub Owner</strong>、<strong>Repo</strong>、<strong>Branch</strong>、<strong>Records 目录</strong> 放在页面设置中保存。</li>
          <li><strong>GitHub Token</strong> 只会在浏览器本地保存，不会写入配置文件。</li>
          <li>Token 会经过转换后存储，调用 GitHub API 时再还原使用。</li>
        </ul>
        <p class="muted">若 Branch 留空，将使用仓库默认分支（通常是 <code>main</code>）。</p>
      </article>

      <article class="card guide-card">
        <h2>常见排查</h2>
        <ul class="guide-list">
          <li>修改配置文件后页面未变化：通常是 localStorage 优先模式覆盖了配置文件。</li>
          <li>提交 GitHub 失败：先检查 Token 是否具备仓库 <code>Contents: Read and write</code> 权限。</li>
          <li>分支不存在：先在远程仓库创建分支，或将 Branch 留空使用默认分支。</li>
        </ul>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
</script>

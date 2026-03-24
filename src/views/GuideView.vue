<template>
  <main class="page page--guide">
    <PageHeader title="应用使用说明" description="快速了解配置来源、优先级规则与推荐填写方式。" />

    <section class="guide-grid">
      <article class="card guide-card">
        <h2>配置来源</h2>
        <p>应用启动时会读取两份配置：</p>
        <ul class="guide-list">
          <li><code>public/config/app-config.json</code>：部署时随页面发布的配置文件。</li>
          <li><code>localStorage</code>：你在“页面设置”里点击“保存设置”后写入浏览器的配置。</li>
        </ul>
      </article>

      <article class="card guide-card">
        <h2>优先级模式</h2>
        <p>首页“页面设置”中的开关会直接决定最终生效来源：</p>
        <ul class="guide-list">
          <li>未勾选：<strong>localStorage 优先</strong>，配置文件作为兜底默认值。</li>
          <li>已勾选：<strong>配置文件优先</strong>，配置文件会覆盖同名 localStorage 项。</li>
        </ul>
        <p class="muted">你现在可以直接看该开关旁边的动态提示文案来确认当前模式。</p>
      </article>

      <article class="card guide-card">
        <h2>GitHub 提交设置（推荐）</h2>
        <ul class="guide-list">
          <li><strong>GitHub Owner</strong>：<code>foxmaybeOI1761640545</code></li>
          <li><strong>GitHub Repo</strong>：<code>car-expense-journal-1774354845-V5.1</code></li>
          <li><strong>GitHub Branch</strong>：<code>records/live-data</code></li>
          <li><strong>Records 目录</strong>：<code>data/records</code></li>
        </ul>
        <p class="muted">如果 Branch 留空，会使用仓库默认分支（通常是 <code>main</code>）。</p>
      </article>

      <article class="card guide-card">
        <h2>常见排查</h2>
        <ul class="guide-list">
          <li>修改了配置文件但页面没变化：通常是 localStorage 优先并覆盖了配置文件。</li>
          <li>提交 GitHub 失败：先检查 Token 是否有仓库 <code>Contents: Read and write</code> 权限。</li>
          <li>分支不存在：先在远程仓库创建分支，或将 Branch 留空用默认分支。</li>
        </ul>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
</script>

<template>
  <footer
    class="site-filing-footer"
    aria-label="网站备案信息"
  >
    <a
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
    >
      滇ICP备2026013686号-1
    </a>
  </footer>
</template>

<style scoped>
.site-filing-footer {
  box-sizing: border-box;
  width: 100%;
  padding: var(--jg-space-md) var(--jg-space-xl);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
  background: var(--jg-bg-panel);
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
  line-height: var(--jg-line-height-body);
  text-align: center;
}

.site-filing-footer a {
  color: inherit;
  text-decoration: none;
}

.site-filing-footer a:hover,
.site-filing-footer a:focus-visible {
  color: var(--jg-brand);
  text-decoration: underline;
}
</style>

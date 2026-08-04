<template>
  <footer
    class="site-filing-footer"
    aria-label="网站备案信息"
  >
    <div class="site-filing-links">
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
      >
        滇ICP备2026013686号-1
      </a>
      <a
        href="https://beian.mps.gov.cn/#/query/webSearch?code=53011102001651"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          class="site-filing-icon"
          src="/images/gongan-beian.png"
          alt=""
          width="18"
          height="20"
          aria-hidden="true"
        >
        <span>滇公网安备53011102001651号</span>
      </a>
    </div>
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

.site-filing-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--jg-space-sm) var(--jg-space-lg);
}

.site-filing-footer a {
  display: inline-flex;
  align-items: center;
  gap: var(--jg-space-xs);
  color: inherit;
  text-decoration: none;
}

.site-filing-icon {
  flex: 0 0 auto;
}

.site-filing-footer a:hover,
.site-filing-footer a:focus-visible {
  color: var(--jg-brand);
  text-decoration: underline;
}
</style>

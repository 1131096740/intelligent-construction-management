# #398 部分付款与付清浏览器验收

精确候选 `c1001533429537cfa98e485d5e9df56502ac5634` 在独占 PostgreSQL 16 与 Chromium 上重放 329 条迁移。两条原入口各运行一个业务用例并通过，零跳过，安装账和业务后 B7 核验均通过，两套隔离资源均已清理。

- 部分付款验证经办与复核岗位共享同一笔付款事实，并独立核对账务影响。[部分付款回执](/private/tmp/jg398-329-acl-stage.XLi0AH/runs/jg-finance-task398-browser-partial.tA6mFGhD/receipt.json)
- 付清验证丢失响应后刷新页面，使用原幂等键恢复首笔 30 元，登记剩余 70 元，校验两笔执行及最终已付 100 元，并下载与原始摘要一致的凭证。[付清回执](/private/tmp/jg398-329-acl-stage.XLi0AH/runs/jg-finance-task398-browser-completion.5Sj24vMt/receipt.json)

修订覆盖三张实际读取的表，仅在 329 浏览器夹具中授予指定列的 `SELECT`。同一次运行验证测试角色没有整表权限、额外列权限、写入和转授权，观察角色没有这些表的列读取权限。集成只纳入三份夹具文件。所有执行源码与实跑候选一致，合入时独立核验了两条回执，并将重生成的 6／8 份备料和实际运行材料逐字节比对。

北京时间 2026-11-24 06:57，远端 `619b4b44c5c1eeae7ab1d8b1a480953b53547ba9` 的 CI 尚未结束。付清分片已失败，部分付款分片仍排队。该远端提交早于本地夹具修订，集成候选的远端验收仍待运行。[CI 45283155969](https://github.com/1131096740/intelligent-construction-management/actions/runs/45283155969) · [付清分片](https://github.com/1131096740/intelligent-construction-management/actions/runs/45283155969/job/138072548553)

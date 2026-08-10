# 合同 mutation authority 与旧路由退出

V3 cutover 后，`saveAggregate` 与接管双边确认生命周期模块分别是其领域唯一有效的 mutation authority。旧工作台保存与旧接管确认在所有模式下 fail-closed；回滚仅通过已验收版本重新部署。获得授权的生产零调用证据后，exit candidate 先进入全模式 410 tombstone 观察期，持续无调用后才物理删除。

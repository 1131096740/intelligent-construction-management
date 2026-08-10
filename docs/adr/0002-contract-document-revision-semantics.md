# 合同文书 revision 语义

`draftRevision` 只承担聚合乐观并发。`documentContentRevision` 只在会改变合同文书内容的字段类别变化时递增；canonical document fingerprint 随生成文书和签章确认冻结。确认有效性同时要求二者匹配，内部运行状态、lease、幂等键、恢复快照、审计和读模型元数据不使签章确认失效。

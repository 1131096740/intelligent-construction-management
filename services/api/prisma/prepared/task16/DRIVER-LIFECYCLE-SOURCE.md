# B1 专用执行器生命周期源码（真实入口仍关闭）

本轮用户已对A+B明确确认“确认全部，仅源码与模拟测试”。B1形成唯一未来CLI与公开 `runTask16RegisteredPg(options, adapters?)` 的正常case生命周期；B2补充只读runtime准入。这些仍不是完整可运行真实driver，也不授资源或SQL执行资格。

CLI固定形状：`node services/api/prisma/run-task16-registered-pg-local.cjs --packet <absolute-file> --packet-sha256 <64hex> --inputs <absolute-file> --inputs-sha256 <64hex> --artifacts <new-private-directory>`。当前不运行这条真实资源命令；测试只以不存在的输入文件调用其能力拒绝路径。没有--mock、--skip-tls或跳过身份的CLI旗标。模拟适配器仅经公开函数注入，结果强制标SIMULATED/nativeExecution=false，不能产生原生验收。

固定顺序为：唯一source验证→新自有资源→owner传输→202迁移→baseline角色权限→七片单事务installer→registered精确权限/有效矩阵→三角色客户端→真实App→fixture→原唯一正常case。任何阶段失败停止后续，不重试；finally先App、后客户端、最后资源，各清理失败仍继续剩余清理。资源close返回不够，还核closed/completed及container/volume/network实际缺席回执。start失败带回的partial-resource回执保留；它必须由现有资源helper自己的失败清理分支负责，不以未知ID猜删资源。创建或清理未知保持失败。

已有实际连接代码指针：默认source片段调用唯一离线CLI并核输入repo就是当前driver根、driver/resourcehelper/installer源码确实属于候选；默认resource阶段调用原 `startTask01Postgres`；默认安装阶段调用已整合 `installTask16RegisteredSql`。这些是实接源码，B1没有调用它们或证明实际运行。

**B2后仍未完成的8个原生阶段在任何source读取/资源创建前阻断：** owner实际TLS正负控；准确迁移执行；baseline及registered逐列/函数权限与有效矩阵；三角色客户端/传输；App/fixture/正常case原生连接。缺失阶段没有noop成功函数。runtime准入现已真实实现，详见RUNTIME-ADMISSION-SOURCE.md；不是只删missingCapabilities即可得到可运行driver。

未来权限实现必须在marker安装前建立基础角色/权限、安装后只按固定manifest补精确新对象权限并核实际有效矩阵；禁止GRANT ALL恢复marker DML，禁止把旧task01 ACL冒registered权限。当前B1没有写ACL/迁移源码或调用任何SQL。

B1的AbortSignal接力在下一stage之前及最终case返回后复核中断，清理已返回handle；实际adapter必须各自处理取消、超时和部分创建失败（原资源helper有其预算/清理）。CLI进程信号、总预算、完整子进程/依赖生命周期还须随原生入口补齐，不冒已闭合。

安装stage开始即UNKNOWN_DO_NOT_RETRY；错误或丢回执不称回滚。stage返回也只记INSTALLATION_STAGE_RETURNED_NOT_FULL_ACCEPTANCE，不推实际COMMIT安全。真实PG、SQL语法/安装、权限、TLS负控、正常资金COMMIT、故障/断连/丢响应/并发、清理均未验；#398及16/42/44硬门保持，17/24不解锁。

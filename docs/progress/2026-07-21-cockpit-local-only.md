# 2026-07-21 Cockpit 本机回环运维面板上线回执

## 结论

单人运维 Cockpit 已完成安装和浏览器验收。它只允许通过 SSH 本地端口转发访问，不存在公网 9090 管理入口；`jgzg-ops` 只能查看系统状态、读取日志，并执行三项固定服务动作。

## 时间与范围

- 生产窗口：2026-07-21 07:19Z–09:34Z。
- root-only 预检回执：`/root/jiangkong-cockpit-boundary/20260721T071959Z`，目录权限为 `0700`。
- 软件包：Ubuntu noble-backports 的 `cockpit 360-1~bpo24.04.1`。
- 浏览器验收：管理员于 2026-07-21 完成 SSH 隧道访问和 `jgzg-ops` 登录；密码仅在本机交互式提示中设置，未记录到文档、仓库或终端回执。

## 最终证据

- `cockpit.socket` 已启用，监听仅为 `127.0.0.1:9090`；未发现 `0.0.0.0:9090` 或 `[::]:9090`。
- 外部直连 `https://162.14.116.192:9090/` 最终为 curl exit `28`、HTTP `000`，未返回 Cockpit 内容。
- UFW 无 9090 入站规则；未修改腾讯云安全组、Nginx、PostgreSQL、部署工作流、数据库、COS 策略或业务数据。
- `cockpit.conf` 固定 `AllowMultiHost=false`；`root` 与 `ubuntu` 均位于 `disallowed-users`，不能登录 Cockpit。
- `jgzg-ops` 仅属于 `jgzg-ops`、`users`、`systemd-journal` 组；未创建 SSH `authorized_keys`，无 `sudo`、`adm`、`docker` 或 `root` 组成员资格。
- `/usr/local/sbin/jiangkong-ops-action` 为 `root:root 0750`，sudoers 为 `root:root 0440`；允许的精确动作仅为 API 重启、Nginx 重载、健康检查启动。
- 已以 `jgzg-ops` 实测日志读取和上述三项允许动作成功；直接重启 PostgreSQL 与未列出的 helper 参数均被拒绝。API 重启后健康端点恢复为 `{"status":"ok","service":"jiangkong-api"}`。
- 最终复核 Nginx、API、PostgreSQL 都为 `active`，本机 API health 正常。

## 实施中发现与处置

- Ubuntu 的 runtime mask 状态显示为 `masked-runtime`，实际链接为 `/dev/null`，符合安装前阻止 socket 启动的目的。
- `cockpit` 元包带入 NetworkManager 相关依赖；核验显示 `eth0` 对 NetworkManager 为 `unmanaged`，仍由 systemd-networkd 的 netplan 配置管理，默认路由和业务服务未受影响。
- 软件包安装后覆盖了 `disallowed-users` 的预配置内容。最终验收前已恢复 `root`、`ubuntu` 两个禁用登录用户，并再次验证监听、外网拒绝和核心服务健康。

## 后续操作

日常操作遵循 [单人运维面板操作手册](../superpowers/runbooks/2026-07-21-single-operator-ops.md)。如需停用 Cockpit，先禁用 `cockpit.socket` 并移除受限账号与 helper；软件包卸载属于新的变更窗口，必须单独授权。

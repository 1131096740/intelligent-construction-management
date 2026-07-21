# 建工智管单人运维面板操作手册

## 用途与边界

Cockpit 只用于查看服务器状态、查看日志，以及在确认事故后执行三项固定动作。它不接管发布、Nginx 配置、证书、数据库、备份或防火墙。

Cockpit 只监听服务器回环地址；不要尝试通过公网 IP 或域名访问它。

## 打开面板

在本机终端运行以下命令，并保持该终端窗口打开：

```bash
ssh -i /Users/leoyang/.ssh/jgzg_prod -N -L 127.0.0.1:9090:127.0.0.1:9090 ubuntu@162.14.116.192
```

然后在浏览器打开 <https://127.0.0.1:9090>，仅用 `jgzg-ops` 登录。该本机地址的 Cockpit 自签名证书提示是预期行为；只对这个经 SSH 隧道访问的 `127.0.0.1` 地址继续访问。

使用完毕后回到终端按 `Ctrl+C` 关闭隧道。

## 日常查看顺序

1. 在概览中查看 CPU、内存、磁盘和网络是否异常。
2. 在服务中查看 `jiangkong-api.service`、`nginx.service`、`postgresql.service`、`jiangkong-healthcheck.service` 的状态。
3. 在日志中先查看 `jiangkong-api.service`、`nginx.service` 和健康检查的近期记录。
4. 发生访问异常时，先确认 `https://jgzg.site` 和 `/api/health` 的结果，再决定是否执行下列固定动作。

## 允许的三项动作

只在已确认对应故障时，在 Cockpit 终端执行以下其中一条命令：

```bash
sudo -n /usr/local/sbin/jiangkong-ops-action api-restart
sudo -n /usr/local/sbin/jiangkong-ops-action nginx-reload
sudo -n /usr/local/sbin/jiangkong-ops-action health-start
```

动作后重新确认服务状态和 `https://jgzg.site/api/health`。API 重启后的短暂启动窗口内，健康检查可能需要数秒恢复。

## 立即停止并升级处理

以下事项不在 Cockpit 的操作范围内：

- 应用发布、回滚、部署脚本或 Git 操作；
- 数据库变更、SQL、迁移、恢复或删除；
- 证书、DNS 或 Nginx 配置编辑；
- 防火墙、腾讯云安全组、网络或 SSH 设置；
- 软件包安装、升级或卸载；
- 备份策略、COS 策略或备份恢复；
- 出现任何未预期的 Cockpit 提权、密码或管理员授权提示。

遇到上述情况，停止操作并保留页面或日志时间点后再处理。不要尝试通过扩大 `jgzg-ops` 权限来绕过限制。

# 建工智管单人运维与域名唯一入口设计

日期：2026-07-21

状态：用户已确认方案方向，待书面复核与实施计划

范围：生产 Nginx 的公网入口收紧，以及面向单人运维的 Cockpit 本机管理入口。

决策：业务系统只接受受控域名访问；原始服务器 IP 不再提供业务页面。Cockpit 只绑定服务器回环地址，通过电脑 SSH 隧道访问，不开放新的公网管理端口。

## 1. 背景与已核实事实

生产站点的正式业务入口是 https://jgzg.site。2026-07-21 的只读检查确认：

- https://jgzg.site/ 与 /api/health 均返回 200。
- 未登录读取 /api/projects 返回 401。
- http://162.14.116.192/ 返回业务页面 200，没有跳转到域名。
- https://162.14.116.192/ 的证书不包含 IP；忽略证书错误时仍返回业务页面 200。

服务器 /etc/nginx/sites-enabled/jiangkong 明确存在 server_name 162.14.116.192 的 HTTP 站点，直接托管前端、代理 /api/ 至 127.0.0.1:3000。jgzg.site 的 HTTPS 站点同时是 default_server，未知 TLS 主机也会落入业务站点。

这不是匿名数据访问漏洞：业务 API 仍由后端鉴权。但 IP HTTP 可能让用户在无 TLS 的链路登录，IP HTTPS 会诱导用户跳过证书告警，也让业务入口和故障判断出现两个事实来源。

现有生产系统使用 Ubuntu 24.04、systemd、Nginx、PostgreSQL、NestJS、GitHub Actions、运行健康检查和异机备份。新面板不能接管 Nginx、数据库、证书、部署或备份。

## 2. 目标与非目标

目标：

- jgzg.site 是唯一规范业务域名；www.jgzg.site 如保留，只跳转到规范域名。
- IP HTTP 跳转至 https://jgzg.site；IP HTTPS 和未知 TLS 主机不返回 Web/API 内容。
- 单人运维可直观看到资源、服务状态与日志，并可受控重启 API、重载 Nginx。
- Cockpit 仅在服务器 127.0.0.1:9090 监听，只能经管理员电脑 SSH 隧道访问。
- 继续以仓库脚本和 GitHub Actions 作为发布、迁移、备份、恢复的唯一执行链。

不做：

- 不改应用业务、用户、审批、文件、审计或数据库数据。
- 不改 PostgreSQL 监听、COS 策略、现有备份链或部署工作流。
- 不安装 Docker、OpenResty、1Panel、Webmin 或第二套网站/数据库管理系统。
- 不开放 Cockpit、PostgreSQL、备份目录或新的管理端口到公网。
- 不在 Cockpit 中执行发布、迁移、数据库 SQL、备份恢复、防火墙重写、Nginx 配置编辑或系统升级。

## 3. 方案比较与选择

### 方案 A：保持 IP 直达

零变更，但 IP HTTP 登录入口和双入口问题继续存在。拒绝。

### 方案 B：域名唯一入口 + Cockpit 回环管理

Nginx 将 IP HTTP 跳转至规范域名，拒绝 IP HTTPS/未知 TLS 主机；Cockpit 只监听回环地址，经 SSH 隧道进入。保留当前部署和备份体系。

采用本方案：新增面最小、回退明确，最适合一人维护当前原生 systemd 服务。

### 方案 C：1Panel/Webmin 全面托管

界面和功能更广，但形成第二套网站、证书、数据库、任务与备份操作面，容易与原生 Nginx、systemd 和发布脚本漂移。当前不采用。

## 4. 目标架构

    业务用户
      -> https://jgzg.site
      -> Nginx (443)
      -> Web Admin / API (127.0.0.1:3000)

    原始 IP HTTP
      -> 301 https://jgzg.site + 原始路径

    原始 IP HTTPS / 未知 TLS Host
      -> 默认 TLS 站点拒绝，不返回 Web/API 内容

    管理员电脑
      -> SSH key 登录 ubuntu@162.14.116.192
      -> 本地 127.0.0.1:9090 SSH 隧道
      -> 服务器 127.0.0.1:9090 Cockpit

### 4.1 Nginx

- 80 端口默认虚拟主机固定跳转 https://jgzg.site$request_uri，不得用不受信任的 $host 组成跳转目标。
- jgzg.site 与 www.jgzg.site 的 HTTP 均跳转到规范域名 HTTPS。
- 443 的业务站点只接收已声明的域名；新默认 TLS 站点不配置 Web 根目录或 /api/ 代理，推荐在完成 TLS 握手后 return 444。
- 默认 TLS 站点仍须载入域名证书完成握手，因此 IP HTTPS 会先产生证书不匹配提示；修复后，即使忽略提示也不得看到业务页面。
- 保留域名业务站点当前的安全响应头、登录限流、API 代理和健康检查。

### 4.2 Cockpit

- 使用 Ubuntu 官方 backports 安装 Cockpit，不安装容器或第三方面板组件。
- 通过 cockpit.socket drop-in 清空默认监听，只设 127.0.0.1:9090；UFW、腾讯云安全组和 Nginx 不放行 9090。
- 关闭 Cockpit 的连接其他主机和多主机功能。
- 管理员先使用既有 ubuntu SSH 密钥建立隧道，再以独立 jgzg-ops Linux 账号登录 Cockpit；该账号没有通用 sudo。
- 最小 Polkit 规则只允许读取必要状态/日志，并只允许对 jiangkong-api.service、nginx.service、jiangkong-healthcheck.service 执行批准的重启或 reload；不得停止 PostgreSQL、编辑 unit、管理用户、安装软件、修改网络或防火墙。
- Cockpit 终端若保留，只以无通用 sudo 的 jgzg-ops 身份运行，不能作为发布或数据库入口。

### 4.3 新手日常范围

Cockpit 只用于：

1. 看 CPU、内存、磁盘和网络。
2. 看 API、Nginx、PostgreSQL、健康检查的状态。
3. 看最近 systemd/API/Nginx 错误日志。
4. 确认故障后，受控重启 API 或重载 Nginx。

部署、数据修复、迁移、备份恢复、证书续期和策略变更继续按仓库运行手册与明确生产授权执行。

## 5. 实施门禁与顺序

### 5.1 预检

1. SSH 只读确认生产 SHA、nginx -T、证书续期方式、UFW/安全组端口和 Cockpit 未安装状态。
2. 只备份将修改的 Nginx 站点配置和 SHA-256 到 root 可读目录。
3. 记录变更前基线：域名首页/health 为 200、未登录 /api/projects 为 401，API/Nginx/PostgreSQL/Cron 均健康。
4. 若证书续期依赖 HTTP-01，先确认默认 80 站点保留挑战路径；续期方式不明确则停止。

### 5.2 域名唯一入口

1. 用默认 HTTP 跳转站点替换 IP 专用业务站点。
2. 将域名 HTTPS 站点移出 default_server，新增无业务内容的默认 TLS 拒绝站点。
3. 只在 nginx -t 通过后 reload；测试失败不 reload，恢复备份。
4. 用域名、IP、Host/SNI 的 curl 检查验证第 7 节。

### 5.3 Cockpit 最小安装

1. 安装后立即写回环监听 drop-in，重载 systemd 并重启 cockpit.socket。
2. 创建受限账号、最小 Polkit 规则和必要日志读取权限；密码不得进入仓库或终端输出。
3. 确认外网 TCP 9090 仍关闭；管理员经 SSH 隧道以 https://127.0.0.1:9090 登录。
4. 仅在地址是本机回环且隧道已建立时，才接受 Cockpit 首次自签名证书提示；它与业务域名证书无关。
5. 验证可读状态/日志、可执行已批准动作，且所有越权动作被拒绝。

每个生产阶段前必须报告目标配置、变更范围、基线、回滚方法和预期影响，并等待用户明确授权。

## 6. 失败处理与回滚

- Nginx 测试失败：不 reload，恢复备份后再测试。
- reload 后域名健康、登录入口或 API 基线不符：立即还原配置，nginx -t 后 reload。
- IP 仍返回业务内容：停止宣布完成，读取实际生效配置和响应，不以浏览器缓存判断。
- Cockpit 隧道失效不影响业务站点；先以 SSH 检查 socket 绑定和日志。
- Cockpit 权限过大或行为不清楚：禁用 socket、移除新 Polkit 规则和运维账号；完全卸载另需授权。

## 7. 验收标准

| 检查 | 期望结果 |
| --- | --- |
| https://jgzg.site/ | 200，正常登录页 |
| http://jgzg.site/ | 单跳 301 至规范 HTTPS 域名 |
| https://www.jgzg.site/ | 单跳 301 至 https://jgzg.site/ |
| http://162.14.116.192/ | 单跳 301 至 https://jgzg.site/ |
| https://162.14.116.192/ 忽略证书错误测试 | 被默认 TLS 站点拒绝，不返回 200 或业务正文 |
| https://jgzg.site/api/health | 200 |
| 未登录 https://jgzg.site/api/projects | 401 |
| Cockpit 监听 | 仅 127.0.0.1:9090 |
| 外网 TCP 9090 | 不可达，安全组/UFW 未放行 |
| 运维账号 | 可读状态/日志，只能执行批准服务动作 |
| 越权动作 | PostgreSQL 停止、unit 编辑、软件升级、网络/防火墙修改均被拒绝 |

## 8. 文档与完成定义

实施完成后新增简短单人运维指引，记录建立/关闭 SSH 隧道、四类日常查看项、允许动作、域名唯一入口规则和必须停止自行操作的情形。

只有以下条件同时满足，才可宣布完成：IP HTTP 不再提供业务页面、IP HTTPS/未知 TLS Host 不返回业务内容、域名与 API 基线保持正常、Cockpit 仅本机监听且无公网 9090、受限账号无越权能力、Nginx 回滚备份经过验证，并已按实际结果更新 PROGRESS.md。

# 域名唯一入口生产完成记录

日期：2026-07-21

状态：完成

## 变更范围

本次只修改实际由 Nginx 加载的 /etc/nginx/sites-enabled/jiangkong。目标是将 jgzg.site 固定为唯一业务入口：所有 HTTP 请求固定跳转至 https://jgzg.site，www HTTPS 跳转至规范域名，原始 IP 与未知 TLS Host 不再返回 Web 或 API 内容。

未安装 Cockpit，未修改 UFW、腾讯云安全组、PostgreSQL、应用运行时、部署工作流、证书 DNSPod 凭据、数据库或业务数据。

## 前置与回滚证据

- 生产备份目录：/root/jiangkong-domain-boundary/20260721T065928Z，目录权限为 0700。
- 变更前实际生效文件 SHA-256：a98341e0226b07eba7987c4b7d8b6799cdb1027beb26e30de8cdc4795e64796a。
- 变更后实际生效文件 SHA-256：0b66ed82652536a35b628c092881b3c8ef27ac2e711b2755684a08f8fd7248b7。
- 两个校验文件均已通过 sha256sum -c。
- Nginx syntax test 通过后才 reload，reload 后 nginx.service 为 active。
- Certbot 续期保持 authenticator = manual 和 pref_challs = dns-01,；本次没有改变 80 端口以外的续期路径或凭据。

首次尝试误操作了未被 Nginx 加载的 sites-available 文件，已立即回滚且没有改变公网行为，独立记录见 2026-07-21-domain-unique-entry-rollout-attempt.md。本次已先验证 sites-enabled 是实际加载的普通文件后才执行。

## 验收结果

| 检查 | 结果 |
| --- | --- |
| http://jgzg.site/alpha?x=1 | 301 Location: https://jgzg.site/alpha?x=1 |
| http://162.14.116.192/alpha?x=1 | 301 Location: https://jgzg.site/alpha?x=1 |
| https://www.jgzg.site/alpha?x=1 | 301 Location: https://jgzg.site/alpha?x=1 |
| https://jgzg.site/ | 200 |
| https://jgzg.site/api/health | 200 |
| 未登录 https://jgzg.site/api/projects | 401 |
| HSTS、nosniff、frame、referrer、permissions 安全响应头 | 全部存在 |
| 忽略证书错误的 https://162.14.116.192/ | curl 非零退出，HTTP 000，无业务正文 |
| unknown.jgzg.invalid 指向生产 IP 的 TLS 请求 | curl 非零退出，HTTP 000，无业务正文 |
| nginx、jiangkong-api、certbot timer | 均为 active |
| nginx 与 API 最近十分钟 warning/error journal | 无条目 |

## 日常影响

正式业务地址是 https://jgzg.site。用户通过原始 IP 的 HTTP 访问会自动进入规范 HTTPS 域名；IP HTTPS 证书告警不应被绕过，绕过后也不会获得业务内容。Cockpit 仍为独立、未授权的后续单元。

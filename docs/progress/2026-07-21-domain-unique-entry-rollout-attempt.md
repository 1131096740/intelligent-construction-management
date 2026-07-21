# 域名唯一入口生产尝试记录

日期：2026-07-21

状态：已安全回滚，未达到验收目标，不得自动重试

## 授权范围

用户单独授权了域名唯一入口生产变更：备份并替换 Nginx 虚拟主机文件、执行语法检查和 reload、进行公网验收，并在失败时立即回滚。授权不包含 Cockpit、防火墙或安全组、应用部署、数据库迁移、证书策略或业务数据操作。

## 已执行事实

1. 生产预检通过：Nginx、API、PostgreSQL、Certbot timer 均为 active；证书续期是 DNS-01 manual hooks；UFW 只有 22、80、443 入站规则。
2. 变更前公网基线为：规范域名 HTTPS 200、原始 IP HTTP 200、忽略证书错误的原始 IP HTTPS 200。
3. 以 root-only 路径 /root/jiangkong-domain-boundary/20260721T064951Z 备份了当时计划指定的 sites-available 文件和 Nginx 展开配置，并通过 SHA-256 校验。
4. 候选配置通过文本校验，Nginx syntax test 和 reload 成功。
5. 验收失败：规范域名 HTTP 跳转正常，但原始 IP HTTP 仍为 200，www HTTPS 仍为 200。
6. 按计划立即恢复备份文件，重新执行 Nginx syntax test 和 reload；Nginx active，API 本机 health 正常。

## 根因

实际加载的文件是独立普通文件 /etc/nginx/sites-enabled/jiangkong，不是指向 /etc/nginx/sites-available/jiangkong 的符号链接。两者 inode、大小和内容不同；Nginx 展开配置明确只包含 sites-enabled 文件。因此本次替换的是未生效文件，公网行为没有变化。

## 回滚后复核

- https://jgzg.site/ 返回 200。
- https://jgzg.site/api/health 返回 200。
- 未登录读取 https://jgzg.site/api/projects 返回 401。
- Nginx、API、PostgreSQL 和 Certbot timer 保持 active。
- Cockpit 未安装，9090 未监听，UFW 未改动。

## 后续门禁

实施计划已修正为备份、替换和回滚实际生效的 /etc/nginx/sites-enabled/jiangkong，并要求先确认它仍是普通文件。由于本次窗口已按规则回滚，新计划必须取得新的、明确的生产授权后才能执行；不得在本窗口内自行再试。Cockpit 仍是独立的未授权单元。

# Domain-Only Business Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make https://jgzg.site the sole business entry, redirect all HTTP requests to that canonical domain, and ensure raw-IP or unknown-host HTTPS never serves Web or API content.

**Architecture:** This is an Nginx-only production change. A new default HTTP server sends a fixed canonical redirect, while a new default TLS server completes the required TLS handshake and immediately closes requests with 444. The canonical HTTPS virtual host keeps the existing headers, rate limits, Web root, and API proxy; the www host redirects to the canonical host.

**Tech Stack:** Ubuntu 24.04.4 LTS, Nginx, systemd, Let's Encrypt ECDSA certificate, Certbot DNS-01 renewal hooks, curl.

---

## File Structure

- Modify on production: /etc/nginx/sites-available/jiangkong — the complete active virtual-host configuration.
- Create on production: /root/jiangkong-domain-boundary/<UTC timestamp>/ — root-only before-state config, Nginx dump, and SHA-256 receipt.
- Modify in repository after acceptance: PROGRESS.md — concise factual completion record with the actual backup path and acceptance outcome.

No application source, database, deployment workflow, firewall rule, certificate credential, or Tencent Cloud security group is changed.

### Task 1: Capture a reversible production baseline

**Files:**
- Create: /root/jiangkong-domain-boundary/<UTC timestamp>/jiangkong.before
- Create: /root/jiangkong-domain-boundary/<UTC timestamp>/jiangkong.before.sha256
- Create: /root/jiangkong-domain-boundary/<UTC timestamp>/nginx.before.txt
- Modify: none

- [ ] **Step 1: Obtain the dedicated domain-boundary production authorization**

Record the approval scope before connecting: replace only the Nginx virtual-host file, reload Nginx only after syntax validation, and permit immediate restoration from the generated backup. Do not combine this authorization with Cockpit installation, application deployment, database migration, backup restoration, firewall changes, or business-data writes.

- [ ] **Step 2: Create the root-only backup and collect service baseline**

Run on the production server through the existing ubuntu SSH-key account:

~~~bash
set -euo pipefail

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=/root/jiangkong-domain-boundary/$stamp

sudo -n install -d -m 0700 "$backup_dir"
sudo -n cp -a /etc/nginx/sites-available/jiangkong "$backup_dir/jiangkong.before"
sudo -n sha256sum "$backup_dir/jiangkong.before" | sudo -n tee "$backup_dir/jiangkong.before.sha256" >/dev/null
sudo -n sh -c 'nginx -T > "$1"' sh "$backup_dir/nginx.before.txt"
sudo -n systemctl is-active nginx.service
sudo -n systemctl is-active jiangkong-api.service
sudo -n systemctl is-active postgresql.service
sudo -n systemctl is-active certbot.timer
sudo -n sed -n '1,120p' /etc/letsencrypt/renewal/jgzg.site.conf
sudo -n ufw status verbose
printf 'backup_dir=%s\n' "$backup_dir"
~~~

Expected: all four units are active; the renewal file shows authenticator = manual and pref_challs = dns-01,; UFW has no 9090 allow rule; the backup directory is mode 0700 and contains the original site file plus its checksum.

- [ ] **Step 3: Record the externally visible baseline from the administrator computer**

~~~bash
set -euo pipefail

curl --noproxy '*' -sS -o /dev/null -w 'canonical_https=%{http_code}\n' https://jgzg.site/
curl --noproxy '*' -sS -o /dev/null -w 'ip_http=%{http_code}\n' http://162.14.116.192/
set +e
curl --noproxy '*' -k -sS -o /dev/null -w 'ip_https=%{http_code}\n' https://162.14.116.192/
ip_https_exit=$?
set -e
printf 'ip_https_curl_exit=%s\n' "$ip_https_exit"
~~~

Expected before change: canonical_https=200, ip_http=200, ip_https=200. Retain only the three status lines in the operation receipt; do not retain cookies, response bodies, authorization headers, or credentials.

- [ ] **Step 4: Stop at the defined no-go conditions**

Do not modify Nginx if any service is inactive, the backup cannot be read back with sha256sum -c, the certificate renewal configuration is not DNS-01 manual hooks, or the active file no longer matches the inspected baseline. Report the observed difference and wait for a new plan; do not improvise an HTTP-01 challenge exception.

### Task 2: Replace the virtual-host configuration atomically

**Files:**
- Modify: /etc/nginx/sites-available/jiangkong
- Read for rollback: /root/jiangkong-domain-boundary/<UTC timestamp>/jiangkong.before
- Test: Nginx syntax test and live curl acceptance commands in Task 3

- [ ] **Step 1: Stage the exact candidate configuration outside the Nginx include path**

Run on the production server in the same shell that retains backup_dir from Task 1:

~~~bash
set -euo pipefail

candidate=/tmp/jiangkong-domain-boundary.$(date -u +%Y%m%dT%H%M%SZ).conf

cat > "$candidate" <<'NGINX'
server {
  listen 80 default_server;
  server_name _;
  return 301 https://jgzg.site$request_uri;
}

server {
  listen 80;
  server_name jgzg.site www.jgzg.site;
  return 301 https://jgzg.site$request_uri;
}

server {
  listen 443 ssl http2 default_server;
  server_name _;

  ssl_certificate /etc/letsencrypt/live/jgzg.site/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jgzg.site/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  return 444;
}

server {
  listen 443 ssl http2;
  server_name www.jgzg.site;

  ssl_certificate /etc/letsencrypt/live/jgzg.site/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jgzg.site/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  return 301 https://jgzg.site$request_uri;
}

server {
  listen 443 ssl http2;
  server_name jgzg.site;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

  ssl_certificate /etc/letsencrypt/live/jgzg.site/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jgzg.site/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  root /srv/jiangkong/apps/web-admin/dist;
  index index.html;
  client_max_body_size 100m;

  location = /api/auth/login {
    limit_req zone=jgzg_login burst=5 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:3000/auth/login;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location = /api/auth/refresh {
    limit_req zone=jgzg_refresh burst=10 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:3000/auth/refresh;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINX

grep -Fq 'return 301 https://jgzg.site$request_uri;' "$candidate"
grep -Fq 'listen 443 ssl http2 default_server;' "$candidate"
grep -Fq 'return 444;' "$candidate"
grep -Fq 'server_name jgzg.site;' "$candidate"
grep -Fq 'limit_req zone=jgzg_login burst=5 nodelay;' "$candidate"
grep -Fq 'limit_req zone=jgzg_refresh burst=10 nodelay;' "$candidate"
~~~

Expected: the candidate has no IP business server, no redirect built from $host, and exactly one default server on each of ports 80 and 443.

- [ ] **Step 2: Install the candidate, validate it, and reload only if validation passes**

~~~bash
set -euo pipefail

sudo -n install -m 0644 "$candidate" /etc/nginx/sites-available/jiangkong

if ! sudo -n nginx -t; then
  sudo -n install -m 0644 "$backup_dir/jiangkong.before" /etc/nginx/sites-available/jiangkong
  sudo -n nginx -t
  exit 1
fi

if ! sudo -n systemctl reload nginx.service; then
  sudo -n install -m 0644 "$backup_dir/jiangkong.before" /etc/nginx/sites-available/jiangkong
  sudo -n nginx -t
  sudo -n systemctl reload nginx.service
  exit 1
fi

sudo -n systemctl is-active nginx.service
~~~

Expected: nginx -t reports successful syntax and the final service-state command prints active. On either failure branch, the backup is restored before the command exits nonzero.

- [ ] **Step 3: Remove only the temporary candidate after a successful reload**

~~~bash
set -euo pipefail
rm -f "$candidate"
sudo -n sha256sum /etc/nginx/sites-available/jiangkong | sudo -n tee "$backup_dir/jiangkong.after.sha256" >/dev/null
~~~

Expected: the root-only backup retains before and after checksums; no temporary Nginx file remains under /tmp.

### Task 3: Prove canonical routing and preserve application safety invariants

**Files:**
- Read: /etc/nginx/sites-available/jiangkong
- Read: systemd journals for nginx.service and jiangkong-api.service
- Modify: none

- [ ] **Step 1: Verify canonical redirects and canonical Web/API behavior from the administrator computer**

~~~bash
set -euo pipefail

curl --noproxy '*' -sSI 'http://jgzg.site/alpha?x=1' | tr -d '\r' | grep -Fxi 'location: https://jgzg.site/alpha?x=1'
curl --noproxy '*' -sSI 'http://162.14.116.192/alpha?x=1' | tr -d '\r' | grep -Fxi 'location: https://jgzg.site/alpha?x=1'
curl --noproxy '*' -sSI 'https://www.jgzg.site/alpha?x=1' | tr -d '\r' | grep -Fxi 'location: https://jgzg.site/alpha?x=1'
curl --noproxy '*' -fsS -o /dev/null -w 'canonical_https=%{http_code}\n' https://jgzg.site/
curl --noproxy '*' -fsS -o /dev/null -w 'health=%{http_code}\n' https://jgzg.site/api/health
unauthorized_code=$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' https://jgzg.site/api/projects)
test "$unauthorized_code" = 401
headers=$(curl --noproxy '*' -sSI https://jgzg.site/ | tr -d '\r')
for header in strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy; do
  printf '%s\n' "$headers" | grep -Eqi "^$header:"
done
~~~

Expected: each redirect has the fixed jgzg.site location, canonical_https=200, health=200, the unauthenticated projects response is 401, and all five security headers remain present.

- [ ] **Step 2: Prove raw IP and an unknown TLS host receive no business response**

~~~bash
set -euo pipefail

set +e
ip_code=$(curl --noproxy '*' -k -sS --connect-timeout 5 --max-time 8 -o /dev/null -w '%{http_code}' https://162.14.116.192/)
ip_exit=$?
unknown_code=$(curl --noproxy '*' -k -sS --connect-timeout 5 --max-time 8 --resolve unknown.jgzg.invalid:443:162.14.116.192 -o /dev/null -w '%{http_code}' https://unknown.jgzg.invalid/)
unknown_exit=$?
set -e

test "$ip_exit" -ne 0
test "$ip_code" = 000
test "$unknown_exit" -ne 0
test "$unknown_code" = 000
~~~

Expected: both requests are closed by Nginx return 444, so curl returns a nonzero transport result and HTTP code 000. A browser certificate warning for an IP remains normal; bypassing it must not expose a page or API response.

- [ ] **Step 3: Verify system logs and certificate-renewal continuity**

Run on the production server:

~~~bash
set -euo pipefail

sudo -n systemctl is-active nginx.service
sudo -n systemctl is-active jiangkong-api.service
sudo -n systemctl is-active certbot.timer
sudo -n grep -Fx 'authenticator = manual' /etc/letsencrypt/renewal/jgzg.site.conf
sudo -n grep -Fx 'pref_challs = dns-01,' /etc/letsencrypt/renewal/jgzg.site.conf
sudo -n journalctl -u nginx.service --since '10 minutes ago' -p warning --no-pager
sudo -n journalctl -u jiangkong-api.service --since '10 minutes ago' -p warning --no-pager
~~~

Expected: all services are active. The renewal mode remains DNS-01 and needs no HTTP exception. Review any new warning or error line before declaring success.

- [ ] **Step 4: Restore immediately if any acceptance assertion fails**

Run on the production server in the same shell that retains backup_dir:

~~~bash
set -euo pipefail

sudo -n install -m 0644 "$backup_dir/jiangkong.before" /etc/nginx/sites-available/jiangkong
sudo -n nginx -t
sudo -n systemctl reload nginx.service
sudo -n systemctl is-active nginx.service
~~~

Then rerun the Task 3 canonical health and unauthorized-API checks. Do not attempt a second configuration variation during the same production window.

### Task 4: Record the completed production unit without exposing operational secrets

**Files:**
- Modify: PROGRESS.md
- Create: docs/progress/2026-07-21-domain-unique-entry.md

- [ ] **Step 1: Write the factual operation receipt**

Create the receipt only after all Task 3 checks pass. It must contain the UTC window, Nginx before and after SHA-256 values, the backup directory, the five accepted HTTP results, the fact that Certbot remains DNS-01, and the result of checking the Nginx/API/Certbot units. It must not include certificate private-key paths beyond the existing public configuration, DNSPod token values, cookies, authorization headers, response bodies, or any environment-file content.

- [ ] **Step 2: Update the one-line current status**

Replace the current single-operator domain-boundary pending entry in PROGRESS.md with a completed entry that links the receipt and states that Cockpit remains uninstalled and separately authorized.

- [ ] **Step 3: Commit the evidence-only documentation**

~~~bash
git add PROGRESS.md docs/progress/2026-07-21-domain-unique-entry.md
git diff --cached --check
git commit -m "docs: record canonical domain entry rollout"
~~~

Expected: the commit contains only the receipt and current progress record; it contains no server configuration, private keys, tokens, user password, business data, or unrelated source changes.

# Cockpit Single-Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a local-only Cockpit dashboard for one administrator to inspect system state and logs, while limiting operational writes to three root-owned, fixed service actions reached through an SSH tunnel.

**Architecture:** Cockpit is installed from Ubuntu noble-backports and socket-activated only at 127.0.0.1:9090. The administrator reaches it through an existing SSH-key tunnel and logs in as an isolated jgzg-ops account. No generic sudo or generic systemd Polkit permission is granted; a root-owned command wrapper exposes only API restart, Nginx reload, and health-check start.

**Tech Stack:** Ubuntu 24.04.4 LTS, Cockpit, systemd socket activation, PAM, sudoers command aliases, systemd-journal, SSH local forwarding.

---

## File Structure

- Create on production: /etc/systemd/system/cockpit.socket.d/listen.conf — resets the default listener and binds Cockpit only to loopback.
- Create on production: /etc/cockpit/cockpit.conf — disables multi-host switching.
- Create on production: /etc/cockpit/disallowed-users — disallows root and ubuntu Cockpit login.
- Create on production: /usr/local/sbin/jiangkong-ops-action — root-owned allowlist of exactly three service operations.
- Create on production: /etc/sudoers.d/jgzg-ops-actions — allows the isolated account to run only that helper with three exact arguments.
- Create on production: /home/jgzg-ops — non-privileged Cockpit account home.
- Create in repository after acceptance: docs/superpowers/runbooks/2026-07-21-single-operator-ops.md — short operator guide without passwords or secrets.
- Modify in repository after acceptance: PROGRESS.md — factual completion record.

No Nginx configuration, public firewall rule, Tencent Cloud security group, PostgreSQL configuration, deployment workflow, database, COS policy, or business data is changed.

### Task 1: Establish the isolated installation baseline

**Files:**
- Create: /root/jiangkong-cockpit-boundary/<UTC timestamp>/preflight.txt
- Modify: none

- [ ] **Step 1: Obtain the dedicated Cockpit installation authorization**

Record authorization that permits apt installation of Cockpit from noble-backports, creation of the loopback socket override and isolated account, and testing the three restricted helper actions. This authorization must be separate from the domain-entry change and must not authorize opening port 9090, changing UFW or Tencent Cloud rules, deploying application code, migrating the database, or changing business records.

- [ ] **Step 2: Capture a root-only preflight receipt**

Run on the production server:

~~~bash
set -euo pipefail

stamp=$(date -u +%Y%m%dT%H%M%SZ)
receipt_dir=/root/jiangkong-cockpit-boundary/$stamp

sudo -n install -d -m 0700 "$receipt_dir"
{
  . /etc/os-release
  printf 'os=%s\ncodename=%s\n' "$PRETTY_NAME" "$VERSION_CODENAME"
  sudo -n systemctl is-active nginx.service
  sudo -n systemctl is-active jiangkong-api.service
  sudo -n systemctl is-active postgresql.service
  sudo -n systemctl is-active jiangkong-healthcheck.service || true
  sudo -n ss -ltnp 'sport = :9090'
  sudo -n systemctl list-unit-files cockpit.socket --no-legend
  sudo -n ufw status verbose
  sudo -n apt-cache policy cockpit
  sudo -n sshd -T | grep -Fx 'passwordauthentication no'
} | sudo -n tee "$receipt_dir/preflight.txt" >/dev/null

sudo -n test "$(sudo -n stat -c '%a' "$receipt_dir")" = 700
printf 'receipt_dir=%s\n' "$receipt_dir"
~~~

Expected: codename=noble; Nginx, API, and PostgreSQL are active; no 9090 listener or Cockpit socket unit exists; UFW allows only 22, 80, and 443 inbound; Cockpit is available from noble-backports; password SSH authentication is not enabled for jgzg-ops.

- [ ] **Step 3: Stop at the defined no-go conditions**

Do not install Cockpit if a 9090 listener already exists, any service required by the baseline is inactive, inbound 9090 is configured in UFW, SSH password authentication is enabled without a documented reason, or the system is not Ubuntu noble. Report the receipt contents excluding SSH keys and wait for a revised plan.

### Task 2: Install Cockpit without any public-listening window

**Files:**
- Create: /etc/systemd/system/cockpit.socket.d/listen.conf
- Create: /etc/cockpit/cockpit.conf
- Create: /etc/cockpit/disallowed-users
- Test: cockpit.socket listener and direct local HTTP response

- [ ] **Step 1: Install the listener boundary before the package exists**

~~~bash
set -euo pipefail

sudo -n systemctl mask --runtime cockpit.socket
sudo -n install -d -m 0755 /etc/systemd/system/cockpit.socket.d
sudo -n tee /etc/systemd/system/cockpit.socket.d/listen.conf >/dev/null <<'SOCKET'
[Socket]
ListenStream=
ListenStream=127.0.0.1:9090
SOCKET

sudo -n install -d -m 0755 /etc/cockpit
sudo -n tee /etc/cockpit/cockpit.conf >/dev/null <<'COCKPIT'
[WebService]
AllowMultiHost=false
COCKPIT

printf '%s\n' root ubuntu | sudo -n tee /etc/cockpit/disallowed-users >/dev/null
sudo -n chmod 0644 /etc/systemd/system/cockpit.socket.d/listen.conf /etc/cockpit/cockpit.conf /etc/cockpit/disallowed-users
sudo -n systemctl daemon-reload

masked_state=$(sudo -n systemctl is-enabled cockpit.socket || true)
test "$masked_state" = masked
~~~

Expected: cockpit.socket is reported masked before package installation, and the intended effective listener and login restrictions exist as root-owned files before any package post-install action can start the socket.

- [ ] **Step 2: Install the supported Cockpit package, then unmask and enable its already-restricted socket**

~~~bash
set -euo pipefail

. /etc/os-release
test "$VERSION_CODENAME" = noble
sudo -n apt update
sudo -n apt install -y -t noble-backports cockpit
sudo -n dpkg-query -W -f='cockpit_version=$Version\n' cockpit
sudo -n systemctl unmask --runtime cockpit.socket
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now cockpit.socket
sudo -n systemctl cat cockpit.socket
sudo -n ss -ltnp 'sport = :9090'
~~~

Expected: apt reports one installed Cockpit package from noble-backports. Do not install cockpit-machines, cockpit-podman, a container runtime, 1Panel, Webmin, or any database-admin extension. After unmasking, the displayed effective socket shows an empty ListenStream reset followed by 127.0.0.1:9090; the ss output contains only 127.0.0.1:9090 and never 0.0.0.0:9090 or [::]:9090.

- [ ] **Step 3: Verify local reachability and public non-reachability before creating the operator account**

Run the first command on the production server and the second command on the administrator computer:

~~~bash
set -euo pipefail
sudo -n curl -kfsS --connect-timeout 5 --max-time 8 -o /dev/null -w 'cockpit_loopback=%{http_code}\n' https://127.0.0.1:9090/
~~~

~~~bash
set -euo pipefail

set +e
public_code=$(curl --noproxy '*' -k -sS --connect-timeout 5 --max-time 8 -o /dev/null -w '%{http_code}' https://162.14.116.192:9090/)
public_exit=$?
set -e

test "$public_exit" -ne 0
test "$public_code" = 000
~~~

Expected: Cockpit answers on loopback and public TCP 9090 remains closed. If the public request returns any HTTP response, disable the socket immediately with sudo systemctl disable --now cockpit.socket and stop the rollout.

### Task 3: Create a restricted Cockpit identity and fixed operational actions

**Files:**
- Create: /home/jgzg-ops
- Create: /usr/local/sbin/jiangkong-ops-action
- Create: /etc/sudoers.d/jgzg-ops-actions
- Modify: /etc/group membership for systemd-journal
- Test: exact sudo allowlist and rejected PostgreSQL restart

- [ ] **Step 1: Create the account without SSH keys or a generic administrator group**

~~~bash
set -euo pipefail

if ! id jgzg-ops >/dev/null 2>&1; then
  sudo -n adduser --disabled-password --gecos '' jgzg-ops
fi

sudo -n passwd jgzg-ops
sudo -n usermod -aG systemd-journal jgzg-ops
sudo -n id jgzg-ops
sudo -n getent passwd jgzg-ops
~~~

Expected: passwd prompts only interactively and does not print the password. The account belongs to systemd-journal but not sudo, adm, docker, or root. Do not add an authorized_keys file and do not enable password SSH authentication.

- [ ] **Step 2: Install the root-owned command allowlist**

~~~bash
set -euo pipefail

sudo -n tee /usr/local/sbin/jiangkong-ops-action >/dev/null <<'ACTION'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'usage: jiangkong-ops-action {api-restart|nginx-reload|health-start}' >&2
  exit 64
fi

case "$1" in
  api-restart)
    exec /usr/bin/systemctl restart jiangkong-api.service
    ;;
  nginx-reload)
    exec /usr/bin/systemctl reload nginx.service
    ;;
  health-start)
    exec /usr/bin/systemctl start jiangkong-healthcheck.service
    ;;
  *)
    echo 'usage: jiangkong-ops-action {api-restart|nginx-reload|health-start}' >&2
    exit 64
    ;;
esac
ACTION

sudo -n chown root:root /usr/local/sbin/jiangkong-ops-action
sudo -n chmod 0750 /usr/local/sbin/jiangkong-ops-action

sudo -n tee /etc/sudoers.d/jgzg-ops-actions >/dev/null <<'SUDOERS'
Cmnd_Alias JGZG_OPS_ACTIONS = /usr/local/sbin/jiangkong-ops-action api-restart, /usr/local/sbin/jiangkong-ops-action nginx-reload, /usr/local/sbin/jiangkong-ops-action health-start
jgzg-ops ALL=(root) NOPASSWD: JGZG_OPS_ACTIONS
SUDOERS

sudo -n chown root:root /etc/sudoers.d/jgzg-ops-actions
sudo -n chmod 0440 /etc/sudoers.d/jgzg-ops-actions
sudo -n visudo -cf /etc/sudoers.d/jgzg-ops-actions
sudo -n sudo -l -U jgzg-ops
~~~

Expected: only the three exact helper invocations are listed. Do not create a Polkit rule for org.freedesktop.systemd1.manage-units, because that generic capability could control services beyond the three approved actions.

- [ ] **Step 3: Test the allowlist before relying on the Cockpit interface**

~~~bash
set -euo pipefail

sudo -n -u jgzg-ops journalctl -u jiangkong-api.service -n 5 --no-pager
sudo -n -u jgzg-ops sudo -n /usr/local/sbin/jiangkong-ops-action health-start
sudo -n -u jgzg-ops sudo -n /usr/local/sbin/jiangkong-ops-action nginx-reload
sudo -n -u jgzg-ops sudo -n /usr/local/sbin/jiangkong-ops-action api-restart
sudo -n systemctl is-active nginx.service
sudo -n systemctl is-active jiangkong-api.service
sudo -n curl -fsS http://127.0.0.1:3000/health

if sudo -n -u jgzg-ops sudo -n /usr/bin/systemctl restart postgresql.service; then
  echo 'unexpected PostgreSQL control grant' >&2
  exit 1
fi

if sudo -n -u jgzg-ops sudo -n /usr/local/sbin/jiangkong-ops-action postgresql-restart; then
  echo 'unexpected helper argument grant' >&2
  exit 1
fi
~~~

Expected: the three approved actions succeed; Nginx and API remain active; the health endpoint returns success; direct PostgreSQL control and an unlisted helper argument are rejected. Record only pass or fail, not journal contents.

### Task 4: Validate the SSH-tunnel Cockpit workflow and explicit boundaries

**Files:**
- Read: /etc/systemd/system/cockpit.socket.d/listen.conf
- Read: /etc/cockpit/cockpit.conf
- Read: /etc/cockpit/disallowed-users
- Modify: none

- [ ] **Step 1: Establish the tunnel from the administrator computer**

~~~bash
ssh -i /Users/leoyang/.ssh/jgzg_prod -N -L 127.0.0.1:9090:127.0.0.1:9090 ubuntu@162.14.116.192
~~~

Keep this terminal open. Open https://127.0.0.1:9090 in the browser and log in only as jgzg-ops with the password set in Task 3. Accept the self-signed Cockpit certificate only for the literal local address 127.0.0.1 reached through this SSH tunnel.

- [ ] **Step 2: Perform the allowed visual checks**

In Cockpit, inspect CPU, memory, storage, network, jiangkong-api.service status, nginx.service status, postgresql.service status, jiangkong-healthcheck.service status, and recent journal entries. Use the Cockpit terminal only to run one of the following exact commands after confirming the incident:

~~~bash
sudo -n /usr/local/sbin/jiangkong-ops-action api-restart
sudo -n /usr/local/sbin/jiangkong-ops-action nginx-reload
sudo -n /usr/local/sbin/jiangkong-ops-action health-start
~~~

Expected: all generic privileged operations remain unavailable. In particular, do not stop PostgreSQL, edit a unit, install packages, alter networking, open a firewall port, run deployment scripts, execute SQL, run a migration, restore a backup, or edit Nginx in Cockpit.

- [ ] **Step 3: Recheck network exposure after the browser test**

~~~bash
set -euo pipefail

sudo -n ss -ltnp 'sport = :9090' | grep -F '127.0.0.1:9090'
if sudo -n ss -ltnp 'sport = :9090' | grep -Eq '0.0.0.0:9090|\\[::\\]:9090'; then
  echo 'Cockpit escaped loopback binding' >&2
  exit 1
fi
sudo -n ufw status verbose
~~~

Expected: the listener remains loopback-only and UFW still contains no port 9090 allow rule. Close the tunnel with Ctrl+C when the browser session is finished.

### Task 5: Create the beginner runbook and production receipt

**Files:**
- Create: docs/superpowers/runbooks/2026-07-21-single-operator-ops.md
- Create: docs/progress/2026-07-21-cockpit-local-only.md
- Modify: PROGRESS.md

- [ ] **Step 1: Write the operator runbook from the validated workflow**

The runbook must contain the exact SSH tunnel command from Task 4, the local browser URL, the four visual-check categories, the three helper commands, Ctrl+C tunnel shutdown, and an explicit stop-and-escalate list: deployment, database change, restore, certificate change, Nginx configuration edit, firewall change, package upgrade, and any unexpected Cockpit privilege prompt. It must not contain the jgzg-ops password, SSH private key, IP credentials, tokens, or environment-file values.

- [ ] **Step 2: Write the factual installation receipt**

Record the UTC window, Cockpit package version, loopback listener evidence, external 9090 rejection, account group summary without password, helper allowlist outcome, denied PostgreSQL-action result, Nginx/API health result, and the root-only preflight receipt directory. State explicitly that no public port or cloud security group changed.

- [ ] **Step 3: Update the current project status and commit documentation**

Replace the single-operator Cockpit pending entry in PROGRESS.md only after the acceptance evidence is complete. Keep the domain-entry status independent. Then commit only the two documentation files and PROGRESS.md:

~~~bash
git add PROGRESS.md docs/progress/2026-07-21-cockpit-local-only.md docs/superpowers/runbooks/2026-07-21-single-operator-ops.md
git diff --cached --check
git commit -m "docs: record local-only Cockpit rollout"
~~~

Expected: the evidence commit includes no password, private key, token, configuration secret, terminal history, business record, or unrelated application change.

### Task 6: Apply the defined Cockpit rollback if a boundary check fails

**Files:**
- Remove on production: /etc/systemd/system/cockpit.socket.d/listen.conf
- Remove on production: /etc/cockpit/cockpit.conf
- Remove on production: /etc/cockpit/disallowed-users
- Remove on production: /usr/local/sbin/jiangkong-ops-action
- Remove on production: /etc/sudoers.d/jgzg-ops-actions
- Remove on production: /home/jgzg-ops

- [ ] **Step 1: Disable the listener and remove the new privilege path**

~~~bash
set -euo pipefail

sudo -n systemctl disable --now cockpit.socket
sudo -n rm -f /etc/systemd/system/cockpit.socket.d/listen.conf
sudo -n rm -f /etc/cockpit/cockpit.conf /etc/cockpit/disallowed-users
sudo -n rm -f /usr/local/sbin/jiangkong-ops-action /etc/sudoers.d/jgzg-ops-actions
sudo -n gpasswd -d jgzg-ops systemd-journal || true
sudo -n deluser --remove-home jgzg-ops
sudo -n systemctl daemon-reload
sudo -n ss -ltnp 'sport = :9090'
~~~

Expected: no 9090 listener remains and the jgzg-ops privilege path no longer exists. Keep the Cockpit package installed but disabled; package purge requires a new, explicit authorization because it can affect package dependency state.

- [ ] **Step 2: Restore application baseline**

~~~bash
set -euo pipefail

sudo -n systemctl is-active nginx.service
sudo -n systemctl is-active jiangkong-api.service
sudo -n systemctl is-active postgresql.service
sudo -n curl -fsS http://127.0.0.1:3000/health
~~~

Expected: disabling Cockpit does not affect Nginx, API, PostgreSQL, or the API health endpoint.

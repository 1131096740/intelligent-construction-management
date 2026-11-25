#!/bin/bash
set -euo pipefail
umask 022
[[ $# == 4 || ( $# == 5 && ( $5 == --current-320 || $5 == --text-direct-330 || $5 == --payment-remainder-331 || $5 == --upward-archive-332 ) ) ]] || exit 64
count=295
case ${5-} in
  --current-320) count=329 ;;
  --text-direct-330) count=330 ;;
  --payment-remainder-331) count=331 ;;
  --upward-archive-332) count=332 ;;
esac
repo=$(cd "$1" && pwd -P)
prepared=$(cd "$2" && pwd -P)
sha=$3
out=$4
base="$repo/.github/task12-install-295/contract-finance"
pol="$repo/.github/task12-install-289/pol275"
legacy=3cf11b6c46b301856b554598522213f0839ef595
[[ $(git -C "$repo" rev-parse "$legacy^{tree}") == 886c3bb47cd65aae6f54b7eb46f24b026f240a64 ]]
git -C "$repo" merge-base --is-ancestor "$legacy" 0a5b607cf912ffbb50237af2608ac8b2a5360c16
node -e 'const [file,sha,count,base]=process.argv.slice(1);
  const source=require(file), modes={"329":"current-320","330":"text-direct-330","331":"payment-remainder-331","332":"upward-archive-332"};
  if(source.sourceSha!==sha||source.migrationCount!==Number(count)||(modes[count]&&source.mode!==modes[count]))process.exit(1);
  if(count==="331"||count==="332"){
    require(base+"/"+source.mode+"-profile.cjs").assertSource(source,sha,require(base+"/common/multi-witness.cjs").final);
  }
' "$prepared/source.json" "$sha" "$count" "$base"
mkdir "$out"
out=$(cd "$out" && pwd -P)
cp -R "$prepared/prepared/context" "$out/context"
ctx="$out/context"
mkdir "$ctx/legacy"
git -C "$repo" archive "$legacy" package.json pnpm-workspace.yaml pnpm-lock.yaml scripts packages/shared-domain services/api apps/web-admin/package.json | tar xf - -C "$ctx/legacy"
install -m 644 "$pol/legacy.spec.ts" "$ctx/legacy/services/api/src/database/clearing-reconciliation-legacy-compatibility.spec.ts"
python3 - "$pol/legacy-inputs.json" "$ctx/legacy" <<'PY'
import hashlib,json,pathlib,sys
manifest,root=map(pathlib.Path,sys.argv[1:])
payload=manifest.read_bytes()
assert hashlib.sha256(payload).hexdigest()=='6361048153810677f490fb4414adafedf016bee93b88779d11f98d78336474cc'
paths=sorted(root.rglob('*'))
assert not any(p.is_symlink() for p in paths)
assert [{'path':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths if p.is_file()]==json.loads(payload)
PY
awk '
  BEGIN {print "ARG JG_CONTRACT_FINANCE_TOOLS=deps"}
  /^FROM postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d$/ {
    print $0 " AS contract-finance-loader"; count++; next
  }
  {print}
  END {if (count != 1) exit 1}
' "$ctx/Dockerfile" > "$out/Dockerfile"
cat "$base/workspace.Dockerfile" >> "$out/Dockerfile"
# The sealed legacy workspace is independent of the candidate source and build.
printf '%s\n' 'FROM contract-finance-loader AS pol275-legacy' >> "$out/Dockerfile"
sed -n '/^WORKDIR \/qualification\/pol275-legacy/,$p' "$pol/Dockerfile" >> "$out/Dockerfile"
cat >> "$out/Dockerfile" <<'DOCKERFILE'

FROM contract-finance-api AS pol275-warm
WORKDIR /qualification/pol275-legacy
COPY --link --from=pol275-legacy /qualification/pol275-legacy/ ./
DOCKERFILE
node "$base/context-sha.cjs" "$ctx" "$out/Dockerfile" "$prepared/source.json" > "$out/context.sha256"

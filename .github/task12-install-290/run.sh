#!/bin/bash
set -euo pipefail
umask 077
[[ $# -eq 0 ]]
root=$(git rev-parse --show-toplevel)
input="$root/.github/task12-install-290"
previous="$root/.github/task12-install-289"
temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jg-task12-290.XXXXXXXX")
mkdir -m 0755 "$temp/product"
(umask 022; node "$input/materialize.cjs" --materialize "$root" "$temp/product" "$CI_SOURCE_SHA")
node "$previous/verify.cjs" "$temp/product/predecessor"
python3 "$previous/produce.py" "$root" "$CI_SOURCE_SHA" "$previous/historical-install-inputs.tar.gz" "$previous/installer.cjs" "$temp/admission"
mkdir "$temp/context"
cp -R "$temp/admission/source" "$temp/context/"
cp "$temp/admission"/{source-seal.txt,source-admission.json} "$temp/context/"
cp "$previous"/{Dockerfile,checkout.cjs,installer.cjs,exact-source.json} "$temp/context/"
cp "$input"/{successor.cjs,install-only.cjs} "$temp/context/"
cp "$temp/product/successor.sql" "$temp/context/"
python3 - "$input" "$temp/context" <<'PY'
from pathlib import Path
import hashlib,json,subprocess,sys
input_dir,context=map(Path,sys.argv[1:])
profile=json.loads((input_dir/'profile.json').read_bytes())
pins=profile['installerAssembly']
base=context/'installer.cjs'
delta=input_dir/'installer.patch'
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
if sha(base)!=pins['baseSha256'] or sha(delta)!=pins['patchSha256']:
    raise SystemExit('EXACT_290_INSTALLER_INPUT')
subprocess.run(['patch','--silent','-F','0',str(base),str(delta)],check=True)
if sha(base)!=pins['resultSha256']:
    raise SystemExit('EXACT_290_INSTALLER_POSTIMAGE')
scope={key:profile[key] for key in ('tree','prefixCount','prefixLedgerSha256','terminal','expectedLedgerSha256')}
(context/'scope.json').write_text(json.dumps(scope,separators=(',',':'))+'\n')
PY
printf '%s\n' 'COPY --chmod=644 successor.cjs scope.json successor.sql /qualification/' >> "$temp/context/Dockerfile"
docker build --platform linux/amd64 --iidfile "$temp/image.id" "$temp/context"
image=$(cat "$temp/image.id")
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]]
docker run --platform linux/amd64 --rm --pull never --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 --memory 4g --user postgres --init \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m \
  --mount "type=bind,src=$temp/product/predecessor,dst=/qualification/product,readonly" \
  --entrypoint node "$image" /qualification/install-only.cjs

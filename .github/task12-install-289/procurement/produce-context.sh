#!/bin/bash
set -euo pipefail
umask 022

[[ $# == 2 && $1 =~ ^[0-9a-f]{40}$ && $2 = /* && ! -e $2 && ! -L $2 ]]
head=$1
output=$2
parent=$(cd "$(dirname "$output")" && pwd -P)
[[ $output == "$parent/$(basename "$output")" ]]
root=$(git rev-parse --show-toplevel)
cd "$root"
[[ $(git rev-parse HEAD) == "$head" && -z $(git status --porcelain=v1 --untracked-files=all) ]]
[[ $output != "$root" && $output != "$root/"* ]]
input="$root/.github/task12-install-289"
scratch=$(mktemp -d "$parent/.procurement-context.XXXXXXXX")
trap 'find "$scratch" -depth -delete' EXIT

python3 "$input/produce.py" "$root" "$head" "$input/historical-install-inputs.tar.gz" \
  "$input/installer.cjs" "$scratch/admission" > "$scratch/historical-receipt.json"
mkdir "$scratch/product"
node "$input/checkout.cjs" --materialize-289 "$root" "$scratch/product"
node "$input/verify.cjs" "$scratch/product"
node "$input/procurement/preflight.cjs" --stage-inputs general_procurement "$scratch/context"
cp -R "$scratch/admission/source" "$scratch/context/source"
cp "$scratch/admission/"{source-seal.txt,source-admission.json} "$scratch/context/"
cp "$input/"{checkout.cjs,exact-source.json,install-only.cjs} "$scratch/context/"
cp "$input/procurement/no-db.cjs" "$scratch/context/procurement-no-db.cjs"
printf '%s\n' "$head" > "$scratch/context/procurement-source-head"
cat "$input/Dockerfile" "$input/procurement/Dockerfile.fragment" > "$scratch/context/Dockerfile"
mkdir -m 0700 "$output"
mv "$scratch/context" "$scratch/product" "$scratch/historical-receipt.json" "$output/"
printf '%s\n' "$head" > "$output/context-ready-head"

#!/usr/bin/env sh
# Fetch the playground's compiler from the toolchain's latest release into a
# VERSIONED directory - playground/wasm/<tag>/ - plus the manifest the page
# reads to find it. Versioned, immutable asset paths are what let browsers
# cache the pair forever with no mixed glue/wasm window across a release
# rollover, and they are the ground the future version selector stands on.
#
# Writes (all gitignored; the deploy commits them to the pages repo):
#   playground/wasm/<tag>/vilan_wasm.js
#   playground/wasm/<tag>/vilan_wasm_bg.wasm.gz
#   playground/wasm/manifest.json   {"compiler":"<tag>"} - the browser's copy
#   playground/wasm/VERSION         <tag> - for shell and server consumption
set -eu
cd "$(dirname "$0")/.."

VER="$(curl -fsSL https://api.github.com/repos/vilan-lang/vilan/releases/latest \
	| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$VER" ] || { echo "fetch-wasm: could not resolve the latest release tag" >&2; exit 1; }

rm -rf playground/wasm
mkdir -p "playground/wasm/$VER"
curl -fsSL "https://github.com/vilan-lang/vilan/releases/download/$VER/vilan-playground-wasm.tar.gz" \
	| tar -xz -C "playground/wasm/$VER"
printf '{"compiler":"%s"}' "$VER" > playground/wasm/manifest.json
printf '%s' "$VER" > playground/wasm/VERSION
ls -l "playground/wasm/$VER"

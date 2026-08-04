#!/usr/bin/env sh
# Fetch the playground's compiler(s) into VERSIONED directories -
# playground/wasm/<tag>/ - plus the manifest the page reads to find them.
# Versioned, immutable asset paths are what let browsers cache each pair
# forever with no mixed glue/wasm window across a release rollover, and the
# manifest's `versions` list is the version selector's inventory.
#
#   scripts/fetch-wasm.sh              # the latest release
#   scripts/fetch-wasm.sh v0.19.0 ...  # plus named older releases
#
# Writes (all gitignored; the deploy commits the set to the pages repo and
# regenerates the manifest from the directories actually published):
#   playground/wasm/<tag>/vilan_wasm.js + vilan_wasm_bg.wasm.gz  (per tag)
#   playground/wasm/manifest.json   {"compiler":"<latest>","versions":[...]}
#   playground/wasm/VERSION         <latest> - for shell and server use
set -eu
cd "$(dirname "$0")/.."

# Authenticated when GITHUB_TOKEN is set (CI passes the job token through) -
# the anonymous rate limit on api.github.com is tight enough that a run can
# lose the race on its own, unauthenticated, with no wrongdoing involved.
# A function rather than `set --`: the script's own "$@" carries the extra
# release tags the download loop iterates, and must not be clobbered.
api_get() {
	if [ -n "${GITHUB_TOKEN:-}" ]; then
		curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$1"
	else
		curl -fsSL "$1"
	fi
}
VER="$(api_get https://api.github.com/repos/vilan-lang/vilan/releases/latest \
	| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$VER" ] || { echo "fetch-wasm: could not resolve the latest release tag" >&2; exit 1; }

rm -rf playground/wasm
for tag in "$VER" "$@"; do
	mkdir -p "playground/wasm/$tag"
	curl -fsSL "https://github.com/vilan-lang/vilan/releases/download/$tag/vilan-playground-wasm.tar.gz" \
		| tar -xz -C "playground/wasm/$tag"
done

versions="\"$VER\""
for dir in playground/wasm/v*/; do
	name="$(basename "$dir")"
	[ "$name" = "$VER" ] && continue
	versions="$versions,\"$name\""
done
printf '{"compiler":"%s","versions":[%s]}' "$VER" "$versions" > playground/wasm/manifest.json
printf '%s' "$VER" > playground/wasm/VERSION
cat playground/wasm/manifest.json && echo && ls playground/wasm
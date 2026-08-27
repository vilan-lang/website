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
#
# Every download is verified against the release's own sha256sums.txt before
# anything is unpacked (K19). This is the same check `install.sh` already runs
# on the toolchain, and it is owed here for a stronger reason: these bytes are
# a WebAssembly compiler that executes in every site visitor's browser, and
# they used to be piped straight from curl into tar - a shape in which a
# truncated, substituted, or corrupted response is unpacked and shipped with
# no step that could notice. Note what this does and does not buy: the
# checksums come from the same release page as the asset, so this
# authenticates the TRANSFER, not the pipeline that produced it. Signing and
# provenance are a separate, larger piece of work (tracker L15's M half).
set -eu
cd "$(dirname "$0")/.."

die() { printf 'fetch-wasm: %s\n' "$1" >&2; exit 1; }

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

# Verifies $2 against the sha256sums.txt sitting beside it in directory $1.
#
# Fails CLOSED, exactly as `install.sh` does: a machine with no sha256 tool is
# not a machine that may ship an unverified compiler to the public site, it is
# a machine that cannot complete the fetch. "Skipping" is not an outcome this
# script offers - a check that silently turns itself off on the host least able
# to notice is worse than no check, because it reads like one.
verify() {
	dir="$1"
	name="$2"
	line="$(grep " $name\$" "$dir/sha256sums.txt")" \
		|| die "sha256sums.txt has no entry for $name"
	if command -v sha256sum > /dev/null 2>&1; then
		( cd "$dir" && printf '%s\n' "$line" | sha256sum -c - > /dev/null ) \
			|| die "checksum mismatch for $name"
	elif command -v shasum > /dev/null 2>&1; then
		( cd "$dir" && printf '%s\n' "$line" | shasum -a 256 -c - > /dev/null ) \
			|| die "checksum mismatch for $name"
	else
		die "cannot verify $name: no sha256 tool on PATH. Install one (\`sha256sum\` from coreutils, or \`shasum\`) and re-run; nothing is unpacked unverified."
	fi
}

VER="$(api_get https://api.github.com/repos/vilan-lang/vilan/releases/latest \
	| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$VER" ] || die "could not resolve the latest release tag"

rm -rf playground/wasm
for tag in "$VER" "$@"; do
	dir="playground/wasm/$tag"
	base="https://github.com/vilan-lang/vilan/releases/download/$tag"
	asset="vilan-playground-wasm.tar.gz"
	mkdir -p "$dir"
	# To a file, not a pipe: bytes cannot be checked after tar has already
	# consumed them, so the download has to land before it is trusted.
	curl -fsSL -o "$dir/$asset" "$base/$asset" \
		|| die "download failed ($tag: $asset)"
	curl -fsSL -o "$dir/sha256sums.txt" "$base/sha256sums.txt" \
		|| die "download failed ($tag: sha256sums.txt)"
	verify "$dir" "$asset"
	tar -xzf "$dir/$asset" -C "$dir"
	# The version directory is published as-is, so it holds the compiler pair
	# and nothing else - the same two files as before this check existed.
	rm -f "$dir/$asset" "$dir/sha256sums.txt"
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

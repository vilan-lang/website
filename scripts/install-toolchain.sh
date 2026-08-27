#!/usr/bin/env sh
# Install the vilan toolchain from its latest release, verifying the installer
# before running it.
#
#   sh scripts/install-toolchain.sh     # $HOME/.vilan/bin/vilan
#
# The shape is scripts/fetch-wasm.sh's, for the same reason and with the same
# discipline (K19/K20). What it replaces was
#
#   curl -fsSL .../releases/latest/download/install.sh | sh
#
# in the deploy workflow: the installer fetched and executed in one breath, with
# nothing between the network and a shell, in a job holding the credentials that
# publish the live site. A pipe cannot check what it has already run - so the
# script lands as a FILE first, is checked against the release's own
# sha256sums.txt (release.yml copies install.sh into the asset directory BEFORE
# it hashes it, so the entry is always there), and only then runs.
#
# Fails CLOSED with no sha256 tool on PATH, exactly as install.sh itself does
# since L15: "skipping" is not an outcome this offers, because a check that
# silently turns itself off on the host least able to notice is worse than no
# check - it reads like one.
#
# Note what this does NOT buy. sha256sums.txt is served from the same release
# page as install.sh, so whoever could rewrite the one could rewrite the other.
# This authenticates the TRANSFER - truncation, substitution in flight, a
# cache serving the wrong bytes - and not the pipeline that produced them.
# Signing and provenance are tracker L15's M half and stay open.
#
# Both files come from `releases/latest/download`, which is what install.sh
# itself resolves, so the pair matches unless a release is published between
# the two requests - and then the checksum mismatches and this stops, which is
# the safe direction to fail in.
set -eu

die() { printf 'install-toolchain: %s\n' "$1" >&2; exit 1; }

base="https://github.com/vilan-lang/vilan/releases/latest/download"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/install.sh" "$base/install.sh" \
	|| die "could not download install.sh"
curl -fsSL -o "$work/sha256sums.txt" "$base/sha256sums.txt" \
	|| die "could not download sha256sums.txt"

line="$(grep ' install\.sh$' "$work/sha256sums.txt")" \
	|| die "the release's sha256sums.txt has no entry for install.sh"

if command -v sha256sum > /dev/null 2>&1; then
	( cd "$work" && printf '%s\n' "$line" | sha256sum -c - > /dev/null ) \
		|| die "checksum mismatch for install.sh"
elif command -v shasum > /dev/null 2>&1; then
	( cd "$work" && printf '%s\n' "$line" | shasum -a 256 -c - > /dev/null ) \
		|| die "checksum mismatch for install.sh"
else
	die "cannot verify install.sh: no sha256 tool on PATH. Install one (\`sha256sum\` from coreutils, or \`shasum\`) and re-run; nothing is executed unverified."
fi

sh "$work/install.sh"

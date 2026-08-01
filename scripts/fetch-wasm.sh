#!/usr/bin/env sh
# Fetch the playground's compiler from the toolchain's latest release — the
# same lever the deploy's toolchain install rides, so the page always compiles
# with the release the site was built by. Writes playground/wasm/ (gitignored;
# in production the deploy job commits the pair to the pages repo).
set -eu
cd "$(dirname "$0")/.."
mkdir -p playground/wasm
curl -fsSL https://github.com/vilan-lang/vilan/releases/latest/download/vilan-playground-wasm.tar.gz \
	| tar -xz -C playground/wasm
ls -l playground/wasm

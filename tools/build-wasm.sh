#!/bin/sh
# Compiles the search core (src/engine/core.c) to WebAssembly. Needs clang
# and wasm-ld (LLVM's lld). The result, src/engine/core.wasm, is committed,
# so the site builds without them.
set -e
cd "$(dirname "$0")/.."
clang --target=wasm32 -O3 -nostdlib -mbulk-memory -mnontrapping-fptoint \
  -Wall -Wextra -Wno-unused-parameter \
  -Wl,--no-entry -Wl,--stack-first -Wl,-z,stack-size=1048576 -Wl,--strip-all \
  -o src/engine/core.wasm src/engine/core.c
echo "src/engine/core.wasm: $(wc -c < src/engine/core.wasm) bytes"

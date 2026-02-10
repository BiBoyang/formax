#!/usr/bin/env bash
set -euo pipefail

output="${1:-}"
include_csv="${2:-}"
output_dir="${3:-repomix-output}"

if [[ -z "$output" || -z "$include_csv" ]]; then
  echo "Usage: bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh <bundle-file-name.txt> \"<include-csv>\" [output-dir]"
  echo "Example:"
  echo "  bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh \\\"repomix-webui-semantics-parity-extended.txt\\\" \\\"src/screens/REPL.tsx,src/screens/repl/transcript.tsx\\\""
  exit 2
fi

# Enforce flat output under a single handoff folder.
bundle_name="$(basename "$output")"
if [[ "$bundle_name" != *.txt ]]; then
  echo "Error: bundle file must end with .txt (got: $bundle_name)"
  exit 2
fi

mkdir -p "$output_dir"
# Keep only fresh artifacts for each handoff round.
find "$output_dir" -mindepth 1 -maxdepth 1 ! -name '.gitkeep' -exec rm -rf {} +

output_path="$output_dir/$bundle_name"

bunx repomix . \
  --style plain \
  --no-git-sort-by-changes \
  -o "$output_path" \
  --include "$include_csv"

echo "Created $output_path"

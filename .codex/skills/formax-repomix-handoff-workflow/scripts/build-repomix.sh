#!/usr/bin/env bash
set -euo pipefail

output="${1:-}"
include_csv="${2:-}"
output_dir="${3:-repomix-output}"

if [[ -z "$output" || -z "$include_csv" ]]; then
  echo "Usage: bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh <bundle-file-name.txt> \"<include-csv>\" [output-dir]"
  echo "Example:"
  echo "  bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh \\\"repomix-topic-core.txt\\\" \\\"packages/core/src/screens/REPL.tsx,packages/core/src/screens/repl/transcript.tsx\\\""
  exit 2
fi

# Enforce flat output under a single handoff folder.
bundle_name="$(basename "$output")"
if [[ "$bundle_name" != *.txt ]]; then
  echo "Error: bundle file must end with .txt (got: $bundle_name)"
  exit 2
fi

if [[ "$bundle_name" != repomix-*.txt ]]; then
  echo "Warning: bundle naming convention is 'repomix-<topic>-<tier>.txt' (got: $bundle_name)"
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

name_without_prefix="${bundle_name#repomix-}"
name_without_ext="${name_without_prefix%.txt}"
if [[ "$name_without_prefix" != "$bundle_name" && "$name_without_ext" == *-* ]]; then
  topic="${name_without_ext%-*}"
  echo "Next: create/update"
  echo "  $output_dir/${topic}-handoff-prompt.md"
  echo "  $output_dir/repomix-${topic}-files.md"
  echo "Then run:"
  echo "  bash .codex/skills/formax-repomix-handoff-workflow/scripts/check-handoff-artifacts.sh \"$bundle_name\" \"$topic\" \"$output_dir\""
fi

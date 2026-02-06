#!/usr/bin/env bash
set -euo pipefail

output="${1:-}"
include_csv="${2:-}"

if [[ -z "$output" || -z "$include_csv" ]]; then
  echo "Usage: bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh <output-file> \"<include-csv>\""
  echo "Example:"
  echo "  bash .codex/skills/formax-repomix-handoff-workflow/scripts/build-repomix.sh \\\"proxy/repomix-compact-expanded-current.txt\\\" \\\"src/screens/REPL.tsx,src/screens/repl/transcript.tsx\\\""
  exit 2
fi

bunx repomix . \
  --style plain \
  --no-git-sort-by-changes \
  -o "$output" \
  --include "$include_csv"

echo "Created $output"

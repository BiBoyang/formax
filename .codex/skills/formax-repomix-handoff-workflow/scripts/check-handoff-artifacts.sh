#!/usr/bin/env bash
set -euo pipefail

bundle_name="${1:-}"
topic="${2:-}"
output_dir="${3:-repomix-output}"

if [[ -z "$bundle_name" ]]; then
  echo "Usage: bash .codex/skills/formax-repomix-handoff-workflow/scripts/check-handoff-artifacts.sh <bundle-file-name.txt> [topic] [output-dir]"
  echo "Example:"
  echo "  bash .codex/skills/formax-repomix-handoff-workflow/scripts/check-handoff-artifacts.sh repomix-topic-core.txt topic"
  exit 2
fi

bundle_name="$(basename "$bundle_name")"
if [[ "$bundle_name" != *.txt ]]; then
  echo "Error: bundle file must end with .txt (got: $bundle_name)"
  exit 2
fi

infer_topic_from_bundle() {
  local name_without_prefix name_without_ext
  name_without_prefix="${bundle_name#repomix-}"
  name_without_ext="${name_without_prefix%.txt}"
  if [[ "$name_without_prefix" == "$bundle_name" || "$name_without_ext" != *-* ]]; then
    echo ""
    return
  fi
  echo "${name_without_ext%-*}"
}

if [[ -z "$topic" ]]; then
  topic="$(infer_topic_from_bundle)"
fi

if [[ -z "$topic" ]]; then
  echo "Error: could not infer topic from '$bundle_name'. Pass topic explicitly."
  exit 2
fi

bundle_path="$output_dir/$bundle_name"
prompt_name="${topic}-handoff-prompt.md"
prompt_path="$output_dir/$prompt_name"
manifest_name="repomix-${topic}-files.md"
manifest_path="$output_dir/$manifest_name"

missing=0
if [[ ! -f "$bundle_path" ]]; then
  echo "Missing bundle: $bundle_path"
  missing=1
fi
if [[ ! -f "$prompt_path" ]]; then
  echo "Missing prompt: $prompt_path"
  missing=1
fi
if [[ ! -f "$manifest_path" ]]; then
  echo "Missing files manifest: $manifest_path"
  missing=1
fi
if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

if ! rg -q --fixed-strings "$bundle_name" "$prompt_path"; then
  echo "Consistency check failed: prompt does not reference bundle name '$bundle_name'."
  exit 1
fi
if ! rg -q --fixed-strings "$bundle_name" "$manifest_path"; then
  echo "Consistency check failed: files manifest does not reference bundle name '$bundle_name'."
  exit 1
fi
if ! rg -q --fixed-strings "$prompt_name" "$manifest_path"; then
  echo "Consistency check failed: files manifest does not reference prompt '$prompt_name'."
  exit 1
fi

check_no_abs_paths() {
  local target="$1"
  local repo_root
  repo_root="$(pwd)"

  if rg -n --fixed-strings "$repo_root" "$target" >/dev/null 2>&1; then
    echo "Privacy check failed: absolute repo path leaked in $target"
    rg -n --fixed-strings "$repo_root" "$target" || true
    return 1
  fi

  if rg -n --pcre2 '/(Users|home|private|var/folders|Volumes)/' "$target" >/dev/null 2>&1; then
    echo "Privacy check failed: unix absolute path detected in $target"
    rg -n --pcre2 '/(Users|home|private|var/folders|Volumes)/' "$target" || true
    return 1
  fi

  if rg -n --pcre2 '[A-Za-z]:\\\\' "$target" >/dev/null 2>&1; then
    echo "Privacy check failed: windows absolute path detected in $target"
    rg -n --pcre2 '[A-Za-z]:\\\\' "$target" || true
    return 1
  fi

  return 0
}

check_no_abs_paths "$prompt_path"
check_no_abs_paths "$manifest_path"

echo "OK: handoff artifacts are consistent and privacy checks passed."
echo "Bundle   : $bundle_path"
echo "Prompt   : $prompt_path"
echo "Manifest : $manifest_path"

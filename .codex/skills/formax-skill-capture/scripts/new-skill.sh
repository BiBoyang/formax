#!/usr/bin/env bash
set -euo pipefail

name="${1:-}"
desc="${2:-}"

if [[ -z "${name}" || -z "${desc}" ]]; then
  echo "Usage: bash .codex/skills/formax-skill-capture/scripts/new-skill.sh <skill-name> \"<description>\""
  exit 2
fi

root=".codex/skills/${name}"
skill="${root}/SKILL.md"

if [[ -e "${root}" ]]; then
  echo "Error: ${root} already exists"
  exit 2
fi

mkdir -p "${root}"

cat > "${skill}" <<EOF
---
name: ${name}
description: ${desc}
---

# ${name}

## Goal

## Where to change what

## Patterns

## Tests to update

## Guardrails

EOF

echo "Created ${skill}"


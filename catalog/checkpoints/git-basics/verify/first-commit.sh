#!/usr/bin/env bash
# Checkpoint: 01-first-commit. Invoked as `bash first-commit.sh <project-dir>`
# by CheckpointManager (apps/control/src/checkpoints.ts). Exit 0 = passed,
# non-zero = failed; the last printed line becomes the student-facing hint.
set -euo pipefail
PROJECT="$1"
cd "$PROJECT/01-first-commit"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	echo "01-first-commit isn't a git repository. Use Reset to start over."
	exit 1
fi

start="$(git rev-parse lesson-start 2>/dev/null || echo "")"
head="$(git rev-parse HEAD 2>/dev/null || echo "")"
if [ -z "$start" ] || [ "$head" = "$start" ]; then
	echo "No new commit yet - edit roster.txt and commit."
	exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "You have uncommitted changes - commit them first."
	exit 1
fi

if git diff --quiet "$start" HEAD -- roster.txt; then
	echo "roster.txt hasn't changed since the starting commit."
	exit 1
fi

msg="$(git log -1 --format=%s HEAD)"
lower="$(echo "$msg" | tr '[:upper:]' '[:lower:]')"
if [ "${#msg}" -lt 10 ] || [ "$lower" = "update" ] || [ "$lower" = "wip" ]; then
	echo "Commit message \"$msg\" is too short or not descriptive enough."
	exit 1
fi

echo "First commit looks good."

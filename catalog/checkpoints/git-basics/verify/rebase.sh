#!/usr/bin/env bash
set -euo pipefail
PROJECT="$1"
cd "$PROJECT/05-rebase"

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
	echo "A rebase is still in progress - finish it (git rebase --continue) or abort and retry."
	exit 1
fi

develop_now="$(git rev-parse develop)"
develop_tip="$(git rev-parse lesson-develop-tip)"
if [ "$develop_now" != "$develop_tip" ]; then
	echo "develop shouldn't change for this exercise."
	exit 1
fi

if ! git merge-base --is-ancestor develop issue-15-led-colors 2>/dev/null; then
	echo "issue-15-led-colors hasn't been rebased onto the latest develop yet."
	exit 1
fi

merges="$(git rev-list --merges develop..issue-15-led-colors | wc -l | tr -d ' ')"
if [ "$merges" -ne 0 ]; then
	echo "That looks like a merge, not a rebase - try git rebase develop instead of git merge develop."
	exit 1
fi

if ! git show issue-15-led-colors:LedColors.java | grep -q RAINBOW; then
	echo "Your RAINBOW color change is missing after the rebase."
	exit 1
fi

echo "issue-15-led-colors is rebased cleanly onto develop."

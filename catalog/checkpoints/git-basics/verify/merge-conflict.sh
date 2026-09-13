#!/usr/bin/env bash
set -euo pipefail
PROJECT="$1"
cd "$PROJECT/04-merge-conflict"

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
	echo "A merge or rebase is still in progress - finish resolving it first."
	exit 1
fi

parents="$(git log -1 --format='%P' develop)"
count="$(echo "$parents" | wc -w | tr -d ' ')"
if [ "$count" -ne 2 ]; then
	echo "develop's latest commit isn't a merge commit yet."
	exit 1
fi

p1="$(echo "$parents" | cut -d' ' -f1)"
p2="$(echo "$parents" | cut -d' ' -f2)"
old_develop="$(git rev-parse lesson-develop-pre-merge)"
feature_tip="$(git rev-parse lesson-feature-issue-9)"

if { [ "$p1" = "$old_develop" ] && [ "$p2" = "$feature_tip" ]; } \
	|| { [ "$p1" = "$feature_tip" ] && [ "$p2" = "$old_develop" ]; }; then
	:
else
	echo "develop's merge commit doesn't look like a merge of issue-9-max-speed."
	exit 1
fi

if git grep -Iq -e '<<<<<<<' -e '=======' -e '>>>>>>>' develop -- Constants.java 2>/dev/null; then
	echo "Constants.java on develop still has conflict markers in it."
	exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "You have uncommitted changes."
	exit 1
fi

echo "Merge conflict resolved and committed."

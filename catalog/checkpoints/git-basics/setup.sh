#!/usr/bin/env bash
# Builds the git-basics lesson's five scenario repos. Runs once, right after
# the lesson's files are copied into /workspace/project (see
# ImportManager.executeCatalogLoad in apps/control/src/imports.ts) — real
# .git directories can't ship as static catalog files, so this script builds
# each scenario's starting history deterministically instead.
#
# Every commit here uses fixed author/committer identity and dates, so the
# resulting SHAs are the same on every load. The verify scripts in
# checkpoints/git-basics/verify/ rely on that: they tag the "before" state of
# each scenario so they can tell what the student actually changed.
set -euo pipefail

# Run with cwd already set to /workspace/project by the caller (ImportManager
# passes workdir explicitly) - don't guess a path from the script's own
# location, which lives under /opt/frc-catalog instead.
ROOT="${PWD}"
if [ ! -d "$ROOT/01-first-commit" ]; then
	echo "git-basics setup: expected scenario folders under $ROOT, found none." >&2
	exit 1
fi

# Only set these if the student hasn't already configured their own -
# students may return to this lesson after having set a real identity.
git config --global user.name >/dev/null 2>&1 || git config --global user.name "CodeRunner Student"
git config --global user.email >/dev/null 2>&1 || git config --global user.email "student@coderunner.local"
git config --global init.defaultBranch main
git config --global core.editor nano
git config --global pull.rebase false
git config --global advice.detachedHead false

SEQ=0
next_date() {
	SEQ=$((SEQ + 1))
	printf '2026-01-01T00:%02d:00' "$SEQ"
}

# Commits as the lesson's fixed "mentor" identity, at a fixed, incrementing
# timestamp, so every load produces byte-identical history.
bot_commit() {
	local msg="$1"
	local d
	d="$(next_date)"
	GIT_AUTHOR_NAME="Team 4143 Bot" GIT_AUTHOR_EMAIL="bot@frc4143.local" \
	GIT_COMMITTER_NAME="Team 4143 Bot" GIT_COMMITTER_EMAIL="bot@frc4143.local" \
	GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" \
		git commit -q -m "$msg"
}

insert_before_last_brace() {
	# Inserts $2 as a new indented line right before the final line of file $1
	# (each of these tiny fixture files ends with a lone closing brace).
	local file="$1" line="$2" tmp
	tmp="$(mktemp)"
	head -n -1 "$file" > "$tmp"
	printf '    %s\n' "$line" >> "$tmp"
	tail -n 1 "$file" >> "$tmp"
	mv "$tmp" "$file"
}

# --- 1. First commit ---------------------------------------------------
(
	cd "$ROOT/01-first-commit"
	git init -q -b main
	git add -A
	bot_commit "Add roster file"
	git tag -f lesson-start >/dev/null
)

# --- 2. Feature branch ---------------------------------------------------
(
	cd "$ROOT/02-feature-branch"
	git init -q -b main
	git add -A
	bot_commit "Initial FEATURES.md"
	git branch develop
	git tag -f lesson-main-start >/dev/null
)

# --- 3. Merge -------------------------------------------------------------
(
	cd "$ROOT/03-merge"
	git init -q -b main
	git add -A
	bot_commit "Initial robot constants"
	git branch develop
	git tag -f lesson-main-start >/dev/null
	git checkout -q -b issue-7-auto-distance develop
	insert_before_last_brace Constants.java 'public static final double AUTO_DISTANCE_METERS = 2.0;'
	git add -A
	bot_commit "Add AUTO_DISTANCE_METERS for auto-drive"
	git tag -f lesson-feature-issue-7 >/dev/null
	git checkout -q develop
)

# --- 4. Merge conflict ----------------------------------------------------
(
	cd "$ROOT/04-merge-conflict"
	git init -q -b main
	git add -A
	bot_commit "Initial robot constants"
	git branch develop
	git tag -f lesson-main-start >/dev/null

	git checkout -q -b issue-9-max-speed develop
	sed -i 's/MAX_SPEED = 3.0/MAX_SPEED = 5.0/' Constants.java
	git add -A
	bot_commit "Raise MAX_SPEED for competition"
	git tag -f lesson-feature-issue-9 >/dev/null

	git checkout -q develop
	sed -i 's/MAX_SPEED = 3.0/MAX_SPEED = 4.0/' Constants.java
	git add -A
	bot_commit "Tune MAX_SPEED after practice"
	git tag -f lesson-develop-pre-merge >/dev/null
)

# --- 5. Rebase --------------------------------------------------------------
(
	cd "$ROOT/05-rebase"
	git init -q -b main
	git add -A
	bot_commit "Initial LED colors and robot map"
	git branch develop
	git tag -f lesson-main-start >/dev/null

	git checkout -q -b issue-15-led-colors develop
	insert_before_last_brace LedColors.java 'public static final String RAINBOW = "RAINBOW";'
	git add -A
	bot_commit "Add rainbow LED color"

	git checkout -q develop
	sed -i 's/DRIVE_RIGHT_LEADER = 3;/DRIVE_RIGHT_LEADER = 3;\n    public static final int DRIVE_LEFT_FOLLOWER = 2;/' RobotMap.java
	git add -A
	bot_commit "Add left follower CAN ID"
	git tag -f lesson-develop-tip >/dev/null
	git checkout -q issue-15-led-colors
)

echo "git-basics: scenario repos ready."

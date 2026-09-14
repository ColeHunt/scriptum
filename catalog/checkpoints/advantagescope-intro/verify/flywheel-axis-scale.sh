#!/usr/bin/env bash
set -euo pipefail
LAYOUT="${2:-}"

if [[ -z "$LAYOUT" || ! -s "$LAYOUT" ]]; then
	echo "Open the log in AdvantageScope, then click Verify again."
	exit 1
fi

# TabType.LineGraph = 1. Tolerant bounds - FlywheelRPM ranges roughly 0-6000.
if jq -e '
	any(.tabs.tabs[]?;
		.type == 1 and
		((.controller.leftLockedRange // .controller.rightLockedRange) as $r
			| $r != null and ($r | length) == 2 and $r[0] <= 200 and $r[1] >= 5800)
	)
' "$LAYOUT" >/dev/null 2>&1; then
	echo "Locked axis range looks good."
	exit 0
fi

echo "Lock the Line Graph's Y axis to roughly 0-6000 (right-click the axis)."
exit 1

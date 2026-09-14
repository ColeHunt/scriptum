#!/usr/bin/env bash
set -euo pipefail
LAYOUT="${2:-}"

if [[ -z "$LAYOUT" || ! -s "$LAYOUT" ]]; then
	echo "Open the log in AdvantageScope, then click Verify again."
	exit 1
fi

# TabType.Table = 4. TableController.saveState() returns a bare string[],
# not {fields:[...]} - confirmed by direct source read.
if jq -e '
	any(.tabs.tabs[]?;
		.type == 4 and
		((.controller // []) | any(. | endswith("GamePieceLoaded")))
	)
' "$LAYOUT" >/dev/null 2>&1; then
	echo "Table listing GamePieceLoaded looks good."
	exit 0
fi

echo "Add a Table tab and drag GamePieceLoaded onto it."
exit 1

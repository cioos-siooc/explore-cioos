#!/bin/sh
# The SPA fetches /notices.json; writing it here lets a deployment change its
# messages (NOTICES, a JSON array) with a restart instead of a rebuild. A bad
# value stops the container, so a typo fails the deploy rather than going quiet.
set -eu

notices="${NOTICES:-[]}"

valid='
  type == "array" and all(.[];
    type == "object"
    and (.id | type == "string" and length > 0)
    and (.en | type == "string" and length > 0)
    and ((.fr // "") | type == "string")
    and all(.starts, .expires; (. // "2000-01-01")
      | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ].*)?$"))
    and ((.background // "#000") | type == "string"
      and test("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"))
    and ((.icon // "megaphone") | IN("megaphone", "info", "warning",
      "maintenance", "new", "event", "none"))
    and ((.css // "") | type == "string")
    and ((.tone // "info") | IN("info", "warning", "critical")))
'

if ! printf '%s' "$notices" | jq -e "$valid" >/dev/null 2>&1; then
  echo "notices.sh: NOTICES must be a JSON array of" \
    '{"id", "en", "fr"?, "starts"?/"expires"?: "YYYY-MM-DD[THH:MM...]", "background"?: "#rrggbb", "icon"?: megaphone|info|warning|maintenance|new|event|none, "css"?: "prop: value; ...", "tone"?: info|warning|critical}' \
    "with non-empty id and en; got: $notices" >&2
  exit 1
fi

printf '%s\n' "$notices" > /usr/share/nginx/html/notices.json

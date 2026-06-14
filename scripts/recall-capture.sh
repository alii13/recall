#!/usr/bin/env bash
# Capture the URL on the clipboard into recall, attaching the rendered text of
# the matching browser tab when one is open. The tab is already authenticated,
# so this is the only way to get real content for sources that block
# logged-out fetches (X, Reddit).
#
# Grabbing tab text needs a one-time per-browser setting:
#   Chrome: View > Developer > Allow JavaScript from Apple Events
#   Safari: Develop > Allow JavaScript from Apple Events
# Run `recall-capture.sh --check` to see whether it is on. When a matching tab
# is open but the setting is off, a save still happens (URL only) and you get a
# notification so the silent downgrade never goes unnoticed.
#
# Config (env, or read from the repo .env next to this script):
#   RECALL_HOST        e.g. https://recall.example.com   (default http://localhost:$PORT)
#   RECALL_SAVE_TOKEN  the SAVE_TOKEN shared secret
#
# Usage: recall-capture.sh [url]   (defaults to clipboard via pbpaste)
#        recall-capture.sh --check (report the JavaScript-from-Apple-Events setting)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

read_env() { # key
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

# Injected into the tab. Prefers the tweet/post container over the whole page
# so navigation chrome does not drown the actual content. Also doubles as the
# probe for --check (any trivial JS triggers the same on/off behavior).
read -r -d '' GRAB_JS <<'JS' || true
(function(){var h=location.hostname.replace(/^www\./,'');function pick(s){for(var i=0;i<s.length;i++){var e=document.querySelector(s[i]);if(e&&e.innerText&&e.innerText.trim().length>40)return e.innerText;}return null;}var t=null;if(/(^|\.)(x|twitter)\.com$/.test(h)){var arts=document.querySelectorAll('article[data-testid="tweet"]');if(arts.length){var handleOf=function(a){var u=a.querySelector('[data-testid="User-Name"]');var m=((u?u.innerText:a.innerText).match(/@[A-Za-z0-9_]+/));return m?m[0]:null;};var main=handleOf(arts[0]);var p=[];for(var i=0;i<arts.length;i++){if(i===0||handleOf(arts[i])===main)p.push(arts[i].innerText);}t=p.join('\n\n');}}else if(/(^|\.)reddit\.com$/.test(h)){t=pick(['shreddit-post','[data-test-id="post-content"]','article']);}if(!t){t=pick(['article','main','[role="main"]'])||document.body.innerText;}return (t||'').slice(0,20000);})()
JS

# AppleScript shared helpers (URL normalization for loose matching).
read -r -d '' AS_HELPERS <<'APPLESCRIPT' || true
on normalize(u)
  set u to my replaceText(u, "https://", "")
  set u to my replaceText(u, "http://", "")
  set u to my replaceText(u, "www.", "")
  if u contains "?" then set u to text 1 thru ((offset of "?" in u) - 1) of u
  if u contains "#" then set u to text 1 thru ((offset of "#" in u) - 1) of u
  if u ends with "/" then set u to text 1 thru -2 of u
  return my toLower(u)
end normalize
on replaceText(s, find, repl)
  set {tid, AppleScript's text item delimiters} to {AppleScript's text item delimiters, find}
  set parts to text items of s
  set AppleScript's text item delimiters to repl
  set s to parts as text
  set AppleScript's text item delimiters to tid
  return s
end replaceText
on toLower(s)
  return do shell script "printf %s " & quoted form of s & " | tr '[:upper:]' '[:lower:]'"
end toLower
on jsState(errMsg)
  if errMsg contains "turned off" or errMsg contains "Allow JavaScript" or errMsg contains "not allowed" then return "JSOFF"
  return "ERR:" & errMsg
end jsState
APPLESCRIPT

# Each grab prints a status line, then (for OK) the tab text. Statuses:
#   OK / JSOFF / NOMATCH / NOWIN / NORUN / ERR:<msg>
grab_chrome() { # target js
  osascript - "$1" "$2" <<APPLESCRIPT 2>/dev/null || true
on run argv
  set target to item 1 of argv
  set js to item 2 of argv
  tell application "Google Chrome"
    if not running then return "NORUN"
    if (count of windows) is 0 then return "NOWIN"
    set t to active tab of front window
    if my normalize(URL of t) is not target then return "NOMATCH"
    try
      return "OK" & linefeed & (execute t javascript js)
    on error errMsg
      return my jsState(errMsg)
    end try
  end tell
end run
$AS_HELPERS
APPLESCRIPT
}

grab_safari() { # target js
  osascript - "$1" "$2" <<APPLESCRIPT 2>/dev/null || true
on run argv
  set target to item 1 of argv
  set js to item 2 of argv
  tell application "Safari"
    if not running then return "NORUN"
    if (count of documents) is 0 then return "NOWIN"
    if my normalize(URL of front document) is not target then return "NOMATCH"
    try
      return "OK" & linefeed & (do JavaScript js in front document)
    on error errMsg
      return my jsState(errMsg)
    end try
  end tell
end run
$AS_HELPERS
APPLESCRIPT
}

notify() { osascript -e "display notification \"$1\" with title \"recall\"" >/dev/null 2>&1 || true; }

# Probes actually attempt trivial JS on the active tab (no URL match) so the
# on/off setting is exercised directly. Used only by --check.
probe_chrome() {
  osascript <<APPLESCRIPT 2>/dev/null || true
on run argv
  tell application "Google Chrome"
    if not running then return "NORUN"
    if (count of windows) is 0 then return "NOWIN"
    try
      execute active tab of front window javascript "1"
      return "ON"
    on error errMsg
      return my jsState(errMsg)
    end try
  end tell
end run
$AS_HELPERS
APPLESCRIPT
}
probe_safari() {
  osascript <<APPLESCRIPT 2>/dev/null || true
on run argv
  tell application "Safari"
    if not running then return "NORUN"
    if (count of documents) is 0 then return "NOWIN"
    try
      do JavaScript "1" in front document
      return "ON"
    on error errMsg
      return my jsState(errMsg)
    end try
  end tell
end run
$AS_HELPERS
APPLESCRIPT
}

# --check: probe both browsers and report the setting, no save.
if [ "${1:-}" = "--check" ]; then
  for b in Chrome Safari; do
    if [ "$b" = Chrome ]; then status="$(probe_chrome)"; else status="$(probe_safari)"; fi
    case "$status" in
      NORUN)   echo "$b: not running (open it to check)";;
      NOWIN)   echo "$b: running, no window open";;
      ON)      echo "$b: Allow JavaScript from Apple Events is ON";;
      JSOFF)   echo "$b: OFF - enable via the browser's Developer/Develop menu";;
      *)       echo "$b: unknown ($status)";;
    esac
  done
  exit 0
fi

TOKEN="${RECALL_SAVE_TOKEN:-$(read_env SAVE_TOKEN)}"
PORT="$(read_env PORT)"
HOST="${RECALL_HOST:-$(read_env RECALL_HOST)}"
HOST="${HOST:-http://localhost:${PORT:-8080}}"

URL="${1:-$(pbpaste)}"
case "$URL" in
  http://*|https://*) ;;
  *) echo "not a url on clipboard: $URL" >&2; exit 1 ;;
esac
if [ -z "$TOKEN" ]; then
  echo "no save token (set RECALL_SAVE_TOKEN or SAVE_TOKEN in .env)" >&2
  exit 1
fi

norm() {
  printf '%s' "$1" | sed -E 's#^https?://##; s#^www\.##; s#[?#].*$##; s#/+$##' | tr '[:upper:]' '[:lower:]'
}
TARGET="$(norm "$URL")"

TEXT=""
JS_OFF=0
for grab in grab_chrome grab_safari; do
  res="$($grab "$TARGET" "$GRAB_JS")"
  status="${res%%$'\n'*}"
  case "$status" in
    OK)    TEXT="${res#OK$'\n'}"; break ;;
    JSOFF) JS_OFF=1 ;;  # a tab matched but the setting is off; keep checking the other browser
  esac
done

# Build the body with jq so text is escaped correctly. text is omitted when
# empty, so the server falls back to its normal server-side fetch.
if [ -n "$TEXT" ]; then
  BODY="$(jq -nc --arg url "$URL" --arg text "$TEXT" '{url:$url, text:$text}')"
else
  BODY="$(jq -nc --arg url "$URL" '{url:$url}')"
  [ "$JS_OFF" = 1 ] && notify "Saved URL only - turn on Allow JavaScript from Apple Events to capture tab text"
fi

curl -sS -X POST "$HOST/save" \
  -H "X-Save-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 20 \
  -d "$BODY"
echo

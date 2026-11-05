#!/usr/bin/env bash
set -euo pipefail

media_extensions='(png|jpe?g|gif|webp|mp4|webm|mov)'
url_end='([?#][^[:space:])>"'"'"']*)?([[:space:])>"'"'"']|$)'

patterns=(
  '!\[[^]]*\]\([^)]+\)'
  '<(img|video)([[:space:]/>]|$)'
  'https://github\.com/user-attachments/(assets|files)/'
  'https://user-images\.githubusercontent\.com/'
  "https?://[^[:space:])>\"']+\\.${media_extensions}${url_end}"
  "\\]\\([^)]*\\.${media_extensions}([?#][^)]*)?\\)"
)

body="${BODY:-}"

for pattern in "${patterns[@]}"; do
  if grep -Eiq -e "$pattern" <<<"$body"; then
    exit 0
  fi
done

cat >&2 <<'MESSAGE'
The pull request description needs a screenshot or recording of the change.

Add one of these to the description, then the check re-runs on its own:
  - an image, GIF or video pasted or dragged into the description
  - a Markdown image: ![what it shows](https://.../screenshot.png)
  - an <img> or <video> tag
  - a link to a .png, .jpg, .jpeg, .gif, .webp, .mp4, .webm or .mov file
MESSAGE
exit 1

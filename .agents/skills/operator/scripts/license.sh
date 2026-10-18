#!/bin/bash
# License admin on 112 (run on 112). Reads the admin secret from the service env file; never print it.
#   license.sh find <email or part>      matching users: id, plan, expiry, days left, last seen
#   license.sh extend <userId> <days>    add days; a trial stays a trial (fixed 2026-10-18 in 86e0227)
#   license.sh audit <userId>            last 10 audit log rows for that user
set -e
set -a; . ~/.config/neighbor-license/env; set +a
API="http://127.0.0.1:${LICENSE_SERVER_PORT}"
H="x-admin-secret: ${LICENSE_ADMIN_SECRET}"
case "$1" in
  find)
    curl -s -H "$H" "$API/api/admin/users?q=$2"; echo ;;
  extend)
    curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"days\":$3}" "$API/api/admin/users/$2/extend"; echo ;;
  audit)
    cd ~/apps/license-server
    USER_ID="$2" ~/.local/node-v22/bin/node --no-warnings --input-type=module -e '
      import { LicenseDatabase } from "./lib/db.js";
      const d = new LicenseDatabase("data/license.db");
      const rows = d.db.prepare("SELECT action, details, created_at FROM audit_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10").all(Number(process.env.USER_ID));
      for (const r of rows) console.log(JSON.stringify(r));' ;;
  *)
    echo "usage: license.sh find <q> | extend <userId> <days> | audit <userId>"; exit 1 ;;
esac

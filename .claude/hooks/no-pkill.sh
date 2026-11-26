#!/usr/bin/env bash
# Hook PreToolUse (Bash) : refuse pkill/killall.
# Le motif figure dans la commande elle-même : `pkill -f` tue le shell de l'agent (code 144), et un pkill par nom
# peut abattre des processus étrangers (serveurs de dev de l'utilisateur).
cmd=$(python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null) || exit 0
if printf '%s' "$cmd" | grep -Eq '(^|[;&|`(]|[[:space:]])(pkill|killall)([[:space:]]|$)'; then
  echo "pkill/killall refusés. Arrête un process par son PID : lance-le avec « cmd & echo \$! > pidfile » puis « kill \$(cat pidfile) », ou trouve-le par port avec « ss -ltnp | grep :PORT »." >&2
  exit 2
fi
exit 0

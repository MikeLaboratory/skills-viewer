#!/bin/zsh
# Doppio clic per avviare Skills Viewer nel browser. Chiudi questa finestra per fermarlo.
# Skills Viewer non elimina mai niente: copia le skill solo quando lo confermi.
cd "$(dirname "$0")"

# Node.js può essere installato in posti diversi: li aggiungiamo al PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[[ -s "$HOME/.nvm/nvm.sh" ]] && source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Skills Viewer ha bisogno di Node.js, che su questo Mac non è installato."
  echo ""
  echo "  1. Scaricalo da https://nodejs.org (scegli la versione \"LTS\")"
  echo "  2. Installalo come un normale programma"
  echo "  3. Fai di nuovo doppio clic su \"Avvia Skills Viewer\""
  echo ""
  read "?  Premi Invio per aprire nodejs.org (o chiudi questa finestra)... "
  open "https://nodejs.org"
  exit 1
fi

major=$(node -p "process.versions.node.split('.')[0]")
if (( major < 18 )); then
  echo ""
  echo "  Skills Viewer ha bisogno di Node.js 18 o più recente (qui c'è la versione $(node -v))."
  echo "  Scarica la versione \"LTS\" da https://nodejs.org e installala."
  echo ""
  read "?  Premi Invio per aprire nodejs.org (o chiudi questa finestra)... "
  open "https://nodejs.org"
  exit 1
fi

node server.js

# Changelog

Tutte le modifiche importanti a Skills Viewer sono elencate qui.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/)
e il progetto usa il [Versionamento Semantico](https://semver.org/lang/it/).

## [Non rilasciato]

### Documentazione
- Nuova pagina di presentazione del repository su GitHub: icona, badge, screenshot (tema chiaro e scuro), cosa fa, garanzie di sicurezza, cosa scrive sul Mac.

## [1.1.0] - 2026-11-15

### Aggiunto
- Pulsanti "Copia in Codex" e "Copia in Claude Code" in ogni skill.
- Conferma prima di ogni copia, con cosa viene copiato e dove. Se la skill esiste già dall'altra parte, la conferma mostra i file diversi e avvisa che la versione attuale verrà spostata nel backup.
- Token anti-CSRF generato a ogni avvio: solo la pagina di Skills Viewer può chiedere copie o traduzioni.
- Controllo di Node.js all'avvio di `Avvia Skills Viewer.command`, con un messaggio in italiano e il link a nodejs.org se manca o è troppo vecchio.
- README per chi riceve il progetto: cosa fa, requisiti, come avviarlo, avviso di Gatekeeper, garanzia che non elimina niente.

### Modificato
- La copia ora è fatta file per file e non sovrascrive mai un file esistente.
- Le richieste di scrittura sulle skill passano da un unico endpoint (`POST /api/copy`), al posto dei due precedenti.
- La scritta in fondo alla finestra ora dice "Non elimina mai niente".
- Il menu dell'app "Allinea tutto…" si chiama "Copia le skill mancanti…".

### Sicurezza
- Nessuna cancellazione nel codice: una versione sostituita viene sempre spostata in `~/.skills-viewer-backup/<data e ora>/`. Anche il file temporaneo delle traduzioni viene riscritto invece che cancellato.
- Nomi delle skill validati: niente `..`, `/` o cartelle nascoste, quindi niente path traversal.
- Le copie restano dentro le cartelle delle skill: saltano `.git` e `node_modules` e non seguono collegamenti che portano fuori da quelle cartelle.
- Le richieste di scrittura sono accettate solo da `127.0.0.1`, con Host, Origin e token corretti. Se anche una sola skill nella richiesta non è valida, non viene copiato niente.

## [1.0.0] - 2026-11-15

Prima versione con numero di versione.

### Aggiunto
- Confronto delle skill di Claude Code (`~/.claude/skills`) e Codex (`~/.codex/skills`, `~/.agents/skills`): ogni skill risulta uguale, diversa o presente da una parte sola, con l'elenco dei file diversi.
- Pulsanti per allineare: copia di una skill mancante, scelta della versione da tenere per le skill diverse, "Copia le skill mancanti" per tutte insieme. La copia sostituita viene spostata in `~/.skills-viewer-backup/`, mai cancellata.
- Scheda di ogni skill letta da `SKILL.md`: cosa fa, quando usarla, come si avvia in Claude Code (`/nome`) e in Codex (`$nome`), comandi da terminale, script inclusi, argomenti trattati.
- Traduzione in italiano, emoji e frase breve per ogni skill, fatte da Codex e salvate in `~/.skills-viewer/traduzioni.json`; interruttore Italiano / Originale.
- Elenco, solo da consultare, delle skill dei plugin di Claude Code e dei progetti.
- Aggiornamento automatico quando cambiano le cartelle delle skill e quando si torna sull'app.
- App per Mac (`Skills Viewer.app`) con finestra, icona e menu, compilata con `Scripts/build-app.sh`; avvio alternativo nel browser con `Avvia Skills Viewer.command`.
- Protezioni del server: risponde solo su `127.0.0.1`, controlla Host e Origin.
- Versione mostrata in fondo alla finestra.

[1.1.0]: #110---2026-11-15
[1.0.0]: #100---2026-11-15

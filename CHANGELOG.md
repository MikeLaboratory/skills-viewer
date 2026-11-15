# Changelog

Tutte le modifiche importanti a Skills Viewer sono elencate qui.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/)
e il progetto usa il [Versionamento Semantico](https://semver.org/lang/it/).

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

[1.0.0]: #100---2026-11-15

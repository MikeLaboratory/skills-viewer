# Skills Viewer

Confronta le skill di Claude Code (`~/.claude/skills`) e di Codex (`~/.codex/skills`, `~/.agents/skills`) e le tiene allineate, così entrambi hanno sempre le stesse skill.

## App per Mac

```bash
./Scripts/build-app.sh
open "Apps/Skills Viewer.app"
```

Lo script compila l'app, disegna l'icona, la firma per il tuo Mac (firma locale *ad hoc*) e la mette in `Apps/`. Da lì puoi trascinarla in **Applicazioni** o nel Dock. Serve Node.js installato.

Dopo aver modificato `server.js` o `index.html`, rilancia `./Scripts/build-app.sh` per aggiornare l'app. Per controllare che si avvii: `"Apps/Skills Viewer.app/Contents/MacOS/SkillsViewer" --check-launch`.

| Scorciatoia | Azione |
|---|---|
| ⌘R | Aggiorna |
| ⌘F | Cerca |
| ⇧⌘A | Allinea tutto |

## Si aggiorna da solo

L'app tiene d'occhio le cartelle delle skill (`~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills` e le skill dei plugin): se aggiungi, togli o modifichi una skill, la pagina si aggiorna in meno di un secondo. Ricontrolla anche ogni volta che torni sull'app da un'altra finestra. ⌘R resta disponibile per aggiornare a mano.

## Allinea

- **Skill solo da una parte** → "Copia in Codex" / "Copia in Claude". Non sostituisce mai niente.
- **Skill diversa** → apri la riga e scegli quale versione tenere. L'altra copia non viene cancellata: finisce in `~/.skills-viewer-backup/<data e ora>/`.
- **Allinea tutto** → copia solo le skill mancanti; quelle diverse le scegli tu.

## Descrizioni in italiano

Le descrizioni delle skill vengono tradotte in automatico con Codex, che sceglie anche un'emoji e scrive una frase breve su cosa fa ogni skill (serve `codex` installato e collegato al tuo account). Ogni testo si traduce una volta sola: le traduzioni sono salvate in `~/.skills-viewer/traduzioni.json`, e per una skill nuova si traduce solo quella. In alto puoi passare da **Italiano** a **Originale**.

## Senza app

Doppio clic su `Avvia Skills Viewer.command`: si apre nel browser su <http://localhost:4823>.

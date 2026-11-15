# Skills Viewer

Un'app per Mac che mette a confronto le **skill** di Claude Code e di Codex e ti aiuta a tenerle uguali, così i due assistenti sanno fare le stesse cose.

Le skill sono cartelle di istruzioni che stanno in:

- **Claude Code** → `~/.claude/skills`
- **Codex** → `~/.codex/skills` (e `~/.agents/skills`, se esiste)

## Cosa fa

- **Ti dice subito se sono allineate.** In alto vedi "Tutto allineato" oppure "3 skill da sistemare".
- **Mostra cosa non torna.** Una skill che c'è solo da una parte, oppure una skill che c'è in tutti e due ma con contenuti diversi (con l'elenco dei file che cambiano).
- **Copia le skill da una parte all'altra.** Con i pulsanti "Copia in Codex" e "Copia in Claude Code", sempre dopo una conferma.
- **Spiega ogni skill in parole semplici.** Cosa fa, quando usarla, come si avvia (`/nome` in Claude Code, `$nome` in Codex) e i comandi che usa. Se hai Codex, le descrizioni vengono tradotte in italiano e ogni skill riceve un'emoji e una frase breve.
- **Si aggiorna da solo** quando aggiungi, togli o modifichi una skill.

## Non elimina mai niente

Skills Viewer è fatto per non farti perdere niente:

- **Non cancella mai file o cartelle.** Nel codice non ci sono istruzioni di cancellazione.
- **Copia solo quando lo confermi.** Prima di ogni copia ti mostra cosa viene copiato e dove.
- **Non sovrascrive in silenzio.** Se la skill esiste già dall'altra parte, ti mostra i file diversi. Se confermi, sposta la versione attuale in `~/.skills-viewer-backup/<data e ora>/` e solo dopo copia quella nuova. Per tornare indietro basta rimettere al suo posto la cartella dal backup.
- **Resta dentro le cartelle delle skill.** Non scrive altrove, salta `.git` e `node_modules` e non segue collegamenti che portano fuori da quelle cartelle.
- **Accetta comandi solo dalla sua finestra.** Funziona solo su questo computer, e nessun'altra pagina web può chiedergli di copiare qualcosa.

Le uniche altre cose che scrive sono le traduzioni, salvate in `~/.skills-viewer/traduzioni.json` per non doverle rifare.

## Requisiti

- Un Mac.
- **Node.js 18 o più recente.** Si scarica gratis da [nodejs.org](https://nodejs.org): scegli la versione "LTS" e installala come un normale programma. Se manca, Skills Viewer te lo dice all'avvio.
- *Facoltativo:* **Codex** installato e collegato al tuo account, per le traduzioni in italiano e le emoji. Senza Codex funziona tutto, ma le descrizioni restano in lingua originale.

## Come avviarlo

### Modo semplice: nel browser

1. Fai doppio clic su **`Avvia Skills Viewer.command`**.
2. Si apre una finestra del Terminale (lasciala aperta) e poi la pagina nel browser.
3. Per chiudere Skills Viewer, chiudi la finestra del Terminale.

### Come app per Mac (con la sua finestra e la sua icona)

Servono gli strumenti per sviluppatori di Apple. Se non li hai, installali scrivendo `xcode-select --install` nel Terminale. Poi, nella cartella del progetto:

```bash
./Scripts/build-app.sh
```

L'app compare in `Apps/Skills Viewer.app`: trascinala in **Applicazioni** o nel Dock.

### Avviso di macOS al primo avvio (Gatekeeper)

La prima volta macOS potrebbe dire che il file "non può essere aperto perché proviene da uno sviluppatore non identificato". È normale per i programmi che non arrivano dall'App Store.

1. **Clic destro** (o Ctrl + clic) su `Avvia Skills Viewer.command` o su `Skills Viewer.app`.
2. Scegli **Apri**.
3. Nella finestra che compare, premi di nuovo **Apri**.

Basta farlo una volta sola: le volte successive si apre normalmente con il doppio clic. Se non vedi il pulsante **Apri**, vai in **Impostazioni di Sistema → Privacy e sicurezza** e premi **Apri comunque**.

## Scorciatoie (nell'app)

| Scorciatoia | Azione |
|---|---|
| ⌘R | Aggiorna |
| ⌘F | Cerca una skill |
| ⇧⌘A | Copia le skill mancanti |
| ↑ ↓ | Passa alla skill precedente o successiva |

## Versioni

La versione è scritta in fondo alla finestra. Le novità di ogni versione sono in [CHANGELOG.md](CHANGELOG.md).

#!/usr/bin/env node
// Skills Viewer — confronta le skill di Claude Code e Codex.
// La lettura e il confronto non toccano nessun file.
// Scrive SOLO quando confermi una copia (una skill nella cartella dell'altro programma)
// e quando salva le traduzioni in italiano in ~/.skills-viewer/traduzioni.json.
// NON ELIMINA MAI NIENTE: nel codice non ci sono cancellazioni. Una versione sostituita
// viene spostata (non cancellata) in ~/.skills-viewer-backup/<data>/.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { exec } = require("child_process");

// Versione unica del progetto: quella scritta in package.json
const VERSION = (() => { try { return require("./package.json").version; } catch { return "?"; } })();
const HOME = process.env.SKILLS_HOME || os.homedir(); // SKILLS_HOME serve solo per i test
const BACKUP_DIR = path.join(HOME, ".skills-viewer-backup");
// "Modalità app" (usata da Skills Viewer.app): porta libera scelta dal sistema,
// indirizzo scritto su stdout, uscita automatica quando l'app chiude la stdin.
const APP_MODE = process.argv.includes("--app");
const PORT = APP_MODE ? 0 : Number(process.env.PORT) || 4823;
// Cartella che contiene i tuoi progetti (di default quella che contiene Skills Viewer)
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.dirname(__dirname);
const PLUGINS_DIR = path.join(HOME, ".claude", "plugins");

const SOURCES = [
  { id: "claude", label: "Claude Code", side: "claude", dir: path.join(HOME, ".claude", "skills") },
  { id: "codex", label: "Codex", side: "codex", dir: path.join(HOME, ".codex", "skills") },
  { id: "agents", label: "Codex (~/.agents)", side: "codex", dir: path.join(HOME, ".agents", "skills") },
];
const CODEX_IDS = SOURCES.filter((s) => s.side === "codex").map((s) => s.id);

// Campi di frontmatter che esistono solo in Claude Code
const CLAUDE_ONLY_KEYS = [
  "when_to_use", "argument-hint", "arguments", "disable-model-invocation",
  "user-invocable", "disallowed-tools", "model", "effort", "context", "agent",
  "background", "hooks", "paths", "shell",
];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

async function exists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

// Raccoglie le righe indentate che seguono una chiave (continuazione del valore)
function continuation(fm, from) {
  const lines = [];
  for (const l of fm.slice(from).split(/\r?\n/).slice(1)) {
    if (l === "" || /^\s/.test(l)) lines.push(l.trim()); else break;
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { keys: [], name: null, description: "" };
  const fm = m[1];
  const keys = [...fm.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((x) => x[1]);
  const name = (fm.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m) || [])[1] || null;
  let description = "";
  const d = fm.match(/^description:[ \t]*(.*)$/m);
  if (d) {
    const first = d[1].trim();
    const rest = continuation(fm, d.index);
    if (/^[>|][-+]?$/.test(first) || first === "") {
      // blocco ">" o "|": righe indentate
      description = rest.join(first.startsWith("|") ? "\n" : " ");
    } else {
      // valore semplice o tra virgolette, eventualmente spezzato su più righe
      description = [first, ...rest].join(" ");
      const q = description[0];
      if ((q === '"' || q === "'") && description.endsWith(q)) description = description.slice(1, -1);
    }
    description = description.replace(/[ \t]+/g, " ").trim();
  }
  return { keys, name, description };
}

// Memoria degli hash: un file si rilegge solo se cambiano data o dimensione
const hashCache = new Map(); // percorso reale -> { mtimeMs, size, hash }

async function fileHash(full, st) {
  let real = full;
  try { real = await fs.promises.realpath(full); } catch {}
  const c = hashCache.get(real);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.hash;
  const buf = await fs.promises.readFile(full);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  hashCache.set(real, { mtimeMs: st.mtimeMs, size: st.size, hash });
  return hash;
}

// Elenca i file di una skill (percorso relativo -> hash)
async function hashTree(root) {
  const files = {};
  let newest = 0;
  const seen = new Set();
  async function walk(dir, rel) {
    let real;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return; // evita cicli di collegamenti
    seen.add(real);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === ".DS_Store" || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      let st;
      try { st = await fs.promises.stat(full); } catch { continue; }
      if (st.isDirectory()) await walk(full, r);
      else if (st.isFile()) {
        try {
          files[r] = await fileHash(full, st);
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        } catch { /* file non leggibile: ignorato */ }
      }
    }
  }
  await walk(root, "");
  const overall = crypto.createHash("sha256");
  for (const k of Object.keys(files).sort()) overall.update(k + "\0" + files[k] + "\n");
  return { files, hash: overall.digest("hex"), count: Object.keys(files).length, newest };
}

// ---------- Cosa fa la skill e come si usa (letto da SKILL.md, senza AI) ----------

const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh", "console", "terminal", "fish"]);

// Valore semplice di una chiave del frontmatter (es. argument-hint: "[file]")
function fmValue(fm, key) {
  const m = fm.match(new RegExp("^" + key.replace(/[-]/g, "\\-") + ":[ \\t]*(.*)$", "m"));
  if (!m) return null;
  let v = [m[1].trim(), ...continuation(fm, m.index)].join(" ").replace(/\s+/g, " ").trim();
  if (/^[>|][-+]?\s/.test(v + " ")) v = v.replace(/^[>|][-+]?\s*/, "");
  if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
  return v || null;
}

function cleanInline(s) {
  return s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
}

function extractInfo(text, folder) {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = fmMatch ? fmMatch[1] : "";
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;
  const lines = body.split(/\r?\n/);

  let title = null;
  const sections = [];
  const commands = [];
  const whenToUse = [];
  let inFence = false, fenceLang = "", fenceMark = "", inWhen = false, pending = "";

  for (const raw of lines) {
    const fence = raw.match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    if (fence && (!inFence || raw.trim().startsWith(fenceMark))) {
      if (!inFence) { inFence = true; fenceMark = fence[1]; fenceLang = fence[2].toLowerCase(); }
      else { inFence = false; pending = ""; }
      continue;
    }
    if (inFence) {
      if (!SHELL_LANGS.has(fenceLang)) continue;
      let l = raw.trim().replace(/^\$\s+/, "");
      if (!l || l.startsWith("#")) continue;
      if (pending) { l = pending + " " + l; pending = ""; }
      if (l.endsWith("\\")) { pending = l.slice(0, -1).trim(); continue; }
      if (l.length > 400) l = l.slice(0, 397) + "…";
      if (!commands.includes(l)) commands.push(l);
      continue;
    }
    const h = raw.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (h) {
      const t = cleanInline(h[2]);
      if (h[1] === "#" && !title) title = t;
      else if (h[1] === "##") sections.push(t);
      inWhen = /^when to use|^quando usar|^use (this|when)|^triggers?\b/i.test(t);
      continue;
    }
    if (inWhen) {
      const b = raw.match(/^\s*[-*+]\s+(.+)/) || raw.match(/^\s*\d+[.)]\s+(.+)/);
      // senza simboli iniziali come ✅ o ❌
      if (b && whenToUse.length < 6) whenToUse.push(cleanInline(b[1]).replace(/^[\u2705\u274C\u2714\u2716\uFE0F\s]+/u, ""));
    }
  }

  const argHint = fmValue(fm, "argument-hint");
  const userInvocable = fmValue(fm, "user-invocable");
  const noModel = fmValue(fm, "disable-model-invocation");
  const whenFm = fmValue(fm, "when_to_use");
  return {
    title,
    whenToUse: whenFm ? [whenFm, ...whenToUse].slice(0, 6) : whenToUse,
    sections: sections.slice(0, 14),
    moreSections: Math.max(0, sections.length - 14),
    commands: commands.slice(0, 10),
    moreCommands: Math.max(0, commands.length - 10),
    argHint,
    slash: userInvocable !== "false",       // si può avviare con /nome in Claude Code
    auto: noModel !== "true",               // Claude la usa da solo quando serve
  };
}

// File eseguibili o script inclusi nella skill (cartella scripts/ o bin/)
async function listScripts(full) {
  const out = [];
  for (const sub of ["scripts", "bin"]) {
    let entries;
    try { entries = await fs.promises.readdir(path.join(full, sub), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "__pycache__") continue;
      out.push(sub + "/" + e.name + (e.isDirectory() ? "/" : ""));
    }
  }
  return out.slice(0, 20);
}

async function readSkillMeta(full) {
  const skillMd = path.join(full, "SKILL.md");
  const hasSkillMd = await exists(skillMd);
  let fm = { keys: [], name: null, description: "" };
  let info = null;
  if (hasSkillMd) {
    try {
      const text = await fs.promises.readFile(skillMd, "utf8");
      fm = parseFrontmatter(text);
      info = extractInfo(text);
    } catch {}
  }
  if (info) info.scripts = await listScripts(full);
  return { hasSkillMd, info, ...fm };
}

async function scanSource(src) {
  const out = { ...src, present: await exists(src.dir), skills: {} };
  if (!out.present) return out;
  let entries;
  try { entries = await fs.promises.readdir(src.dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // esclude .system e file nascosti
    const full = path.join(src.dir, e.name);
    let st;
    try { st = await fs.promises.stat(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    const meta = await readSkillMeta(full);
    const isLink = e.isSymbolicLink();
    let target = null;
    if (isLink) { try { target = await fs.promises.realpath(full); } catch {} }
    const tree = await hashTree(full);
    out.skills[e.name] = {
      folder: e.name, path: full, isLink, target, hasSkillMd: meta.hasSkillMd,
      name: meta.name, description: meta.description, keys: meta.keys, info: meta.info,
      claudeOnly: meta.keys.filter((k) => CLAUDE_ONLY_KEYS.includes(k)),
      hasOpenaiYaml: await exists(path.join(full, "agents", "openai.yaml")),
      ...tree,
    };
  }
  return out;
}

// Skill dentro una cartella "skills": ogni sottocartella con SKILL.md
async function listSkillsIn(dir, origin, side, kind) {
  const found = [];
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    let st;
    try { st = await fs.promises.stat(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    const meta = await readSkillMeta(full);
    if (!meta.hasSkillMd) continue;
    found.push({ folder: e.name, name: meta.name, description: meta.description, info: meta.info, path: full, origin, side, kind });
  }
  return found;
}

// Skill dei plugin di Claude Code: cerca le cartelle "skills" dentro ~/.claude/plugins
async function scanPlugins() {
  const out = [];
  const seen = new Set();
  async function walk(dir, depth) {
    if (depth > 7) return;
    let real;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name === "data") continue;
      const full = path.join(dir, e.name);
      if (e.name === "skills") {
        const rel = path.relative(PLUGINS_DIR, dir).split(path.sep).filter(Boolean);
        // .../cache/<marketplace>/<plugin>/<versione>/skills → nome del plugin
        const i = rel.indexOf("cache");
        const origin = "plugin " + (i >= 0 && rel[i + 2] ? rel[i + 2] : rel[rel.length - 1] || "?");
        out.push(...await listSkillsIn(full, origin, "claude", "plugin"));
      } else {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(PLUGINS_DIR, 0);
  return out;
}

// Skill dei progetti: <progetto>/.claude/skills (Claude) e <progetto>/.agents/skills (Codex)
async function scanProjects() {
  const out = [];
  let entries;
  try { entries = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || !e.isDirectory()) continue;
    const proj = path.join(PROJECTS_DIR, e.name);
    out.push(...await listSkillsIn(path.join(proj, ".claude", "skills"), "progetto " + e.name, "claude", "progetto"));
    out.push(...await listSkillsIn(path.join(proj, ".agents", "skills"), "progetto " + e.name, "codex", "progetto"));
  }
  return out;
}

function compareFiles(a, b) {
  const diff = [];
  const all = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const f of [...all].sort()) {
    if (!(f in a)) diff.push({ file: f, what: "manca in Claude" });
    else if (!(f in b)) diff.push({ file: f, what: "manca in questa copia" });
    else if (a[f] !== b[f]) diff.push({ file: f, what: "contenuto diverso" });
  }
  return diff;
}

async function buildReport() {
  const [sources, plugins, projects] = await Promise.all([
    Promise.all(SOURCES.map(scanSource)), scanPlugins(), scanProjects(),
  ]);
  const names = new Set();
  for (const s of sources) for (const n of Object.keys(s.skills)) names.add(n);
  const rows = [...names].sort((a, b) => a.localeCompare(b)).map((n) => {
    const per = {};
    for (const s of sources) {
      const k = s.skills[n];
      per[s.id] = k ? {
        path: k.path, isLink: k.isLink, target: k.target, hasSkillMd: k.hasSkillMd,
        count: k.count, newest: k.newest, hash: k.hash, files: k.files,
      } : null;
    }
    // le informazioni si leggono dalla copia di Claude, se c'è
    const any = sources.map((s) => s.skills[n]).find(Boolean);
    const codexIds = CODEX_IDS.filter((id) => per[id]);

    // Confronto di Claude con ogni copia Codex presente
    const comparisons = [];
    if (per.claude) {
      for (const id of codexIds) {
        const same = per.claude.hash === per[id].hash;
        comparisons.push({
          id, label: SOURCES.find((s) => s.id === id).label, same,
          diffFiles: same ? [] : compareFiles(per.claude.files, per[id].files),
          newer: same ? null : per.claude.newest > per[id].newest ? "claude" : per[id].newest > per.claude.newest ? "codex" : null,
        });
      }
    }
    let status;
    if (per.claude && codexIds.length) status = comparisons.every((c) => c.same) ? "identica" : "diversa";
    else if (per.claude) status = "solo-claude";
    else status = "solo-codex";
    // Le due copie Codex (~/.codex e ~/.agents) sono diverse tra loro?
    const codexCopiesDiffer = codexIds.length > 1 && new Set(codexIds.map((id) => per[id].hash)).size > 1;

    const perOut = Object.fromEntries(Object.entries(per).map(([id, p]) => {
      if (!p) return [id, null];
      const { files: _files, ...rest } = p; // l'elenco dei file serve solo qui sopra
      return [id, rest];
    }));
    return {
      folder: n, name: any.name, description: any.description, info: any.info,
      claudeOnly: any.claudeOnly, hasOpenaiYaml: any.hasOpenaiYaml,
      status, comparisons, codexCopiesDiffer, per: perOut,
    };
  });
  const extras = [...plugins, ...projects].sort((a, b) => a.origin.localeCompare(b.origin) || a.folder.localeCompare(b.folder));
  return {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: sources.map(({ id, label, dir, present, skills }) => ({ id, label, dir, present, count: Object.keys(skills).length })),
    extraDirs: { plugins: PLUGINS_DIR, projects: PROJECTS_DIR },
    rows,
    extras,
  };
}

// ---------- Copia delle skill (l'unica operazione che scrive nelle cartelle delle skill) ----------
// Regole: solo copia, mai cancellazioni. Se la destinazione esiste già, la vecchia versione
// viene SPOSTATA nel backup prima di copiare. Percorsi validati e collegamenti controllati.

const srcById = (id) => SOURCES.find((s) => s.id === id);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const COPY_SKIP = new Set([".git", "node_modules", ".DS_Store"]);

// Nome di cartella accettabile: un solo pezzo, niente "..", niente "/" o "\", niente nascosti
function validFolderName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 200 &&
    !/[\/\\\0]/.test(name) && name !== "." && name !== ".." && !name.startsWith(".");
}

// `child` sta dentro `root`? (dopo aver risolto i percorsi)
function isInside(root, child) {
  const rel = path.relative(root, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

// Le cartelle consentite, con i percorsi reali (se ~/.claude/skills è un collegamento, vale la destinazione)
async function allowedRoots() {
  const roots = [];
  for (const s of SOURCES) {
    roots.push(path.resolve(s.dir));
    try { roots.push(await fs.promises.realpath(s.dir)); } catch {}
  }
  return [...new Set(roots)];
}
const insideAllowed = (roots, p) => roots.some((r) => isInside(r, p));

// Sposta (non cancella) qualcosa nel backup
async function moveToBackup(full, when, sourceId, name) {
  const dest = path.join(BACKUP_DIR, when, sourceId, name);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.rename(full, dest);
  return dest;
}

// Copia file per file. Non sovrascrive mai (COPYFILE_EXCL), salta .git e node_modules,
// segue un collegamento solo se punta dentro le cartelle consentite.
async function copyTree(src, dest, roots, skipped, seen = new Set()) {
  const real = await fs.promises.realpath(src);
  if (seen.has(real)) return; // evita cicli
  seen.add(real);
  await fs.promises.mkdir(dest); // fallisce se esiste già: non scriviamo mai sopra
  for (const e of await fs.promises.readdir(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(e.name)) continue;
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    let target = from;
    if (e.isSymbolicLink()) {
      try { target = await fs.promises.realpath(from); } catch { skipped.push(path.relative(src, from) + " (collegamento rotto)"); continue; }
      if (!insideAllowed(roots, target)) { skipped.push(e.name + " (collegamento fuori dalle cartelle delle skill)"); continue; }
    }
    const st = await fs.promises.stat(target);
    if (st.isDirectory()) await copyTree(target, to, roots, skipped, seen);
    else if (st.isFile()) await fs.promises.copyFile(target, to, fs.constants.COPYFILE_EXCL);
  }
}

// Controlla una richiesta di copia e calcola cosa succederà, senza scrivere niente
async function planCopy(report, item, roots) {
  if (!item || !validFolderName(item.folder)) throw Object.assign(new Error("Nome di skill non valido"), { code: 400 });
  const from = srcById(item.from);
  if (!from) throw Object.assign(new Error("Origine non valida"), { code: 400 });
  const row = report.rows.find((r) => r.folder === item.folder);
  if (!row || !row.per[from.id]) throw Object.assign(new Error("Skill non trovata: " + item.folder), { code: 404 });

  // origine: dentro la sua cartella, e se è un collegamento deve puntare dentro le cartelle consentite
  const srcPath = path.join(path.resolve(from.dir), item.folder);
  if (!isInside(path.resolve(from.dir), srcPath)) throw Object.assign(new Error("Percorso non consentito"), { code: 400 });
  const srcReal = await fs.promises.realpath(srcPath);
  if (!insideAllowed(roots, srcReal)) {
    throw Object.assign(new Error(`"${item.folder}" è un collegamento a una cartella fuori da quelle delle skill: per sicurezza non la copio`), { code: 400 });
  }

  // destinazioni: dall'altra parte, ogni copia già presente; se non ce n'è nessuna, la cartella principale
  const targetIds = from.side === "claude" ? CODEX_IDS.filter((id) => row.per[id]) : ["claude"];
  if (!targetIds.length) targetIds.push("codex");
  const targets = [];
  for (const id of targetIds) {
    const existing = row.per[id];
    if (existing && existing.hash === row.per[from.id].hash) continue; // già identica
    const root = path.resolve(srcById(id).dir);
    const dest = path.join(root, item.folder);
    if (!isInside(root, dest) || path.dirname(dest) !== root) throw Object.assign(new Error("Percorso non consentito"), { code: 400 });
    targets.push({ id, root, dest, replace: !!existing });
  }
  return { row, from, srcPath, srcReal, targets };
}

async function runCopy(plan, roots, when) {
  const done = [];
  for (const t of plan.targets) {
    await fs.promises.mkdir(t.root, { recursive: true });
    let exists = false;
    try { await fs.promises.lstat(t.dest); exists = true; } catch {}
    let backup = null;
    if (exists) backup = await moveToBackup(t.dest, when, t.id, plan.row.folder);
    const skipped = [];
    try {
      await copyTree(plan.srcReal, t.dest, roots, skipped);
    } catch (err) {
      // copia non riuscita: la copia a metà va anch'essa nel backup, e torna quella di prima
      try { await fs.promises.lstat(t.dest); await moveToBackup(t.dest, when, t.id, plan.row.folder + "-copia-incompleta"); } catch {}
      if (backup) { try { await fs.promises.rename(backup, t.dest); } catch {} }
      throw err;
    }
    done.push({ folder: plan.row.folder, from: plan.from.id, to: t.id, dest: t.dest, backup, skipped });
  }
  return done;
}

// ---------- Traduzioni in italiano (fatte da Codex, salvate per non ripeterle) ----------

const TRANSLATIONS_FILE = path.join(HOME, ".skills-viewer", "traduzioni.json");
let translations = null; // testo originale -> testo in italiano
let translating = null;  // traduzione in corso (una alla volta)

async function loadTranslations() {
  if (translations) return translations;
  try { translations = JSON.parse(await fs.promises.readFile(TRANSLATIONS_FILE, "utf8")); }
  catch { translations = {}; }
  return translations;
}

// "comando   # spiegazione" → spiegazione (la stessa regola usata dalla pagina)
const commandNote = (line) => (line.match(/^(.*?\S)\s+#\s+(.+)$/) || [])[2] || null;

// Tutti i testi della pagina che vale la pena tradurre
function textsToTranslate(report) {
  const out = new Set();
  const addInfo = (description, info) => {
    if (description) out.add(description);
    if (!info) return;
    info.whenToUse.forEach((t) => out.add(t));
    info.sections.forEach((t) => out.add(t));
    info.commands.map(commandNote).filter(Boolean).forEach((t) => out.add(t));
  };
  report.rows.forEach((r) => addInfo(r.description, r.info));
  report.extras.forEach((x) => addInfo(x.description, x.info));
  // niente da tradurre se non ci sono lettere (es. "1. 2.") o se è solo codice
  return [...out].filter((t) => /[A-Za-z]{3}/.test(t));
}

async function findCodex() {
  const candidates = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", path.join(os.homedir(), ".local/bin/codex")];
  for (const c of candidates) {
    try { await fs.promises.access(c, fs.constants.X_OK); return c; } catch {}
  }
  // ultimo tentativo: chiedere alla shell di login
  return new Promise((resolve) => {
    exec("/bin/zsh -lc 'command -v codex'", (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

function runCodex(codex, prompt) {
  return new Promise(async (resolve, reject) => {
    const work = path.join(os.tmpdir(), "skills-viewer-codex");
    await fs.promises.mkdir(work, { recursive: true });
    // un solo file, riscritto ogni volta (le traduzioni sono una alla volta): niente da cancellare
    const outFile = path.join(work, "risposta.txt");
    await fs.promises.writeFile(outFile, "");
    // le app non vedono il PATH del Terminale: aggiungiamo quello di Node e i percorsi comuni
    const env = { ...process.env, PATH: [path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH].filter(Boolean).join(":") };
    const child = require("child_process").spawn(codex, [
      "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral",
      "-c", "model_reasoning_effort=low", "-o", outFile, "-",
    ], { cwd: work, env, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Codex non ha risposto entro 5 minuti")); }, 5 * 60 * 1000);
    child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", async (code) => {
      clearTimeout(timer);
      let text = "";
      try { text = await fs.promises.readFile(outFile, "utf8"); } catch {}
      if (code !== 0 || !text) {
        const last = err.trim().split("\n").filter(Boolean).pop() || `codice di uscita ${code}`;
        return reject(new Error(/login|auth/i.test(err) ? "Codex non è collegato al tuo account: apri il Terminale e scrivi codex login" : last));
      }
      resolve(text);
    });
    child.stdin.end(prompt);
  });
}

async function translateBatch(codex, texts) {
  const prompt = [
    "Traduci in italiano ogni stringa dell'array JSON qui sotto. Sono descrizioni e titoli di \"skill\" per assistenti AI.",
    "Regole: tono semplice e naturale; non tradurre nomi di prodotti, librerie, comandi, nomi di file, codice e testo tra `backtick`;",
    "se una stringa è già in italiano, lasciala uguale.",
    "Rispondi SOLO con un array JSON di stringhe della stessa lunghezza e nello stesso ordine, senza testo prima o dopo e senza blocchi di codice.",
    "",
    JSON.stringify(texts),
  ].join("\n");
  const raw = await runCodex(codex, prompt);
  const json = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
  let arr;
  try { arr = JSON.parse(json); } catch { throw new Error("Codex ha risposto in un formato inatteso"); }
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error("Codex ha restituito un numero di traduzioni diverso");
  return arr;
}

// ---------- Emoji e frase breve per ogni skill (fatte da Codex, salvate) ----------

// Chiave: cambia se cambia la descrizione, così la frase resta aggiornata
const cardKey = (folder, description) =>
  "skill:" + folder + ":" + crypto.createHash("sha256").update(description || "").digest("hex").slice(0, 16);

function skillsToDescribe(report) {
  const all = [...report.rows, ...report.extras].map((r) => ({ folder: r.folder, description: r.description, title: r.info && r.info.title }));
  const seen = new Set();
  return all.filter((s) => { const k = cardKey(s.folder, s.description); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Emoji di riserva se Codex non c'è: indovinata da parole chiave
const FALLBACK_EMOJI = [
  [/secur|vulnerab|audit|pentest/i, "🔒"], [/pdf|docx?|word|document|markdown/i, "📄"], [/xlsx|excel|spreadsheet|csv/i, "📊"],
  [/pptx|slide|presentation|deck/i, "📽️"], [/animat|gsap|motion|scroll/i, "🎞️"], [/video|film/i, "🎬"],
  [/voice|speech|audio|transcri|dubb/i, "🎙️"], [/design|website|landing|frontend|ui\b/i, "🎨"], [/reverse|decompil|binary/i, "🔍"],
  [/deploy|vercel|server/i, "🚀"], [/test/i, "🧪"], [/browser|chrome|web/i, "🌐"], [/data|chart|dashboard/i, "📈"],
];
const fallbackEmoji = (text) => (FALLBACK_EMOJI.find(([re]) => re.test(text || "")) || [, "🧩"])[1];

async function describeBatch(codex, skills) {
  const prompt = [
    "Per ogni skill (istruzioni per assistenti AI) dell'array JSON qui sotto, scegli un'emoji e scrivi una frase brevissima in italiano.",
    "- emoji: UNA sola emoji che faccia capire subito a cosa serve (es. 📄 documenti, 🎞️ animazioni, 🔒 sicurezza, 🎙️ voce).",
    "- frase: max 10 parole, linguaggio semplicissimo per chi non è tecnico, inizia con un verbo (es. \"Trasforma Word, PDF ed Excel in testo leggibile\").",
    "  Puoi nominare prodotti (es. GSAP, React) se servono. Niente punto finale.",
    "Rispondi SOLO con un array JSON della stessa lunghezza e nello stesso ordine, di oggetti {\"emoji\": \"…\", \"frase\": \"…\"}, senza testo prima o dopo e senza blocchi di codice.",
    "",
    JSON.stringify(skills.map((s) => ({ nome: s.folder, titolo: s.title || undefined, descrizione: (s.description || "").slice(0, 600) }))),
  ].join("\n");
  const raw = await runCodex(codex, prompt);
  let arr;
  try { arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)); } catch { throw new Error("Codex ha risposto in un formato inatteso"); }
  if (!Array.isArray(arr) || arr.length !== skills.length) throw new Error("Codex ha restituito un numero di risposte diverso");
  return arr;
}

// Emoji e frase già pronte per le skill della pagina (o l'emoji di riserva)
function skillCards(report, tr) {
  const out = {};
  for (const s of skillsToDescribe(report)) {
    const c = tr[cardKey(s.folder, s.description)];
    out[s.folder] = c ? { emoji: c.emoji, summary: c.frase } : { emoji: fallbackEmoji(s.folder + " " + s.description), summary: null };
  }
  return out;
}

async function translateMissing() {
  const report = await buildReport();
  const tr = await loadTranslations();
  const todo = textsToTranslate(report).filter((t) => !(t in tr));
  const toDescribe = skillsToDescribe(report).filter((s) => !(cardKey(s.folder, s.description) in tr));
  if (!todo.length && !toDescribe.length) return { translated: 0 };
  const codex = await findCodex();
  if (!codex) throw new Error("Codex non è installato, quindi non posso tradurre");
  const save = async () => {
    await fs.promises.mkdir(path.dirname(TRANSLATIONS_FILE), { recursive: true });
    await fs.promises.writeFile(TRANSLATIONS_FILE, JSON.stringify(tr, null, 1));
  };
  for (let i = 0; i < toDescribe.length; i += 20) {
    const batch = toDescribe.slice(i, i + 20);
    const result = await describeBatch(codex, batch);
    batch.forEach((s, j) => {
      const r = result[j];
      if (r && typeof r.emoji === "string" && typeof r.frase === "string" && r.frase.trim()) {
        tr[cardKey(s.folder, s.description)] = { emoji: r.emoji.trim().slice(0, 8), frase: r.frase.trim().replace(/\.$/, "") };
      }
    });
    await save();
  }
  let done = 0;
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const result = await translateBatch(codex, batch);
    batch.forEach((t, j) => { if (typeof result[j] === "string" && result[j].trim()) tr[t] = result[j].trim(); });
    done += batch.length;
    // salva dopo ogni gruppo: se qualcosa va storto, il lavoro fatto resta
    await fs.promises.mkdir(path.dirname(TRANSLATIONS_FILE), { recursive: true });
    await fs.promises.writeFile(TRANSLATIONS_FILE, JSON.stringify(tr, null, 1));
  }
  return { translated: done };
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10000) throw new Error("Richiesta troppo grande");
  }
  return body ? JSON.parse(body) : {};
}

// Token anti-CSRF: generato a ogni avvio e scritto solo dentro la pagina di Skills Viewer.
// Un'altra pagina web non lo conosce, quindi non può chiedere copie o traduzioni.
const CSRF_TOKEN = crypto.randomBytes(32).toString("hex");

function writeAllowed(req) {
  const ip = req.socket.remoteAddress;
  const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const token = Buffer.from(String(req.headers["x-skills-viewer-token"] || ""));
  const expected = Buffer.from(CSRF_TOKEN);
  return local && ALLOWED_ORIGINS.has(req.headers.origin) &&
    token.length === expected.length && crypto.timingSafeEqual(token, expected);
}

// Accetta solo richieste rivolte a questo computer (protezione dal DNS rebinding)
// (si riempiono quando il server è partito e conosce la sua porta)
const ALLOWED_HOSTS = new Set();
const ALLOWED_ORIGINS = new Set();

// ---------- Aggiornamento automatico: tiene d'occhio le cartelle delle skill ----------
// Quando cambia qualcosa avvisa la pagina (Server-Sent Events), che si ricarica da sola.

const listeners = new Set(); // pagine aperte in attesa di avvisi
const watchers = new Map();  // cartella -> osservatore
let changeTimer = null;

function changed(file) {
  if (file && /(^|\/)\.DS_Store$/.test(file)) return;
  clearTimeout(changeTimer);
  // aspetta un attimo: copiare una skill genera tanti eventi uno dietro l'altro
  changeTimer = setTimeout(() => { for (const res of listeners) res.write("data: cambiato\n\n"); }, 400);
}

function watchFolders() {
  let added = false;
  for (const dir of [...SOURCES.map((s) => s.dir), PLUGINS_DIR]) {
    if (watchers.has(dir)) continue;
    try {
      const w = fs.watch(dir, { recursive: true }, (_, file) => {
        // nei plugin conta solo quello che riguarda le skill (gli altri file cambiano spesso)
        if (dir === PLUGINS_DIR && !/(^|\/)skills(\/|$)/.test(String(file || ""))) return;
        changed(file && String(file));
      });
      w.on("error", () => { w.close(); watchers.delete(dir); changed(); });
      watchers.set(dir, w);
      added = true;
    } catch { /* la cartella non c'è ancora: si riprova tra poco */ }
  }
  return added;
}
watchFolders();
// se una cartella compare dopo (es. installi Codex), inizia a osservarla
setInterval(() => { if (watchFolders()) changed(); }, 5000).unref();
// tiene viva la connessione con la pagina
setInterval(() => { for (const res of listeners) res.write(": ping\n\n"); }, 25000).unref();

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  try {
    if (!ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase())) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Host non consentito");
    }
    const { pathname } = new URL(req.url, "http://localhost");

    // Le uniche due richieste che scrivono. Solo dalla pagina di Skills Viewer (Origin + token).
    if (req.method === "POST" && pathname === "/api/translate") {
      if (!writeAllowed(req)) return json(403, { error: "Richiesta non consentita" });
      // scrive solo nel file delle traduzioni, mai nelle cartelle delle skill
      if (!translating) translating = translateMissing().finally(() => { translating = null; });
      return json(200, await translating);
    }

    if (req.method === "POST" && pathname === "/api/copy") {
      if (!writeAllowed(req)) return json(403, { error: "Richiesta non consentita" });
      const body = await readJson(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 500) return json(400, { error: "Nessuna skill da copiare" });
      const report = await buildReport();
      const roots = await allowedRoots();
      // prima controlla tutto: se una sola richiesta non va bene, non si copia niente
      const plans = [];
      for (const item of items) {
        try { plans.push(await planCopy(report, item, roots)); }
        catch (e) { return json(e.code || 400, { error: e.message }); }
      }
      const when = stamp();
      const done = [];
      for (const plan of plans) done.push(...await runCopy(plan, roots, when));
      console.log(`Copiate ${done.length} ${done.length === 1 ? "skill" : "skill"}` + done.map((d) => `\n  ${d.folder}: ${d.from} → ${d.to}${d.backup ? " (vecchia versione spostata nel backup)" : ""}`).join(""));
      return json(200, { done, backupDir: done.some((d) => d.backup) ? path.join(BACKUP_DIR, when) : null });
    }

    if (req.method !== "GET") { res.writeHead(405); return res.end("Metodo non consentito"); }
    if (pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": ok\n\n");
      listeners.add(res);
      req.on("close", () => listeners.delete(res));
      return;
    }
    if (pathname === "/api/skills") {
      const data = await buildReport();
      // traduzioni già pronte per i testi di questa pagina, e quante ne mancano
      const tr = await loadTranslations();
      const texts = textsToTranslate(data);
      data.translations = Object.fromEntries(texts.filter((t) => t in tr).map((t) => [t, tr[t]]));
      data.cards = skillCards(data, tr);
      data.untranslated = texts.length - Object.keys(data.translations).length
        + Object.values(data.cards).filter((c) => !c.summary).length;
      data.translating = !!translating;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(data));
    }
    if (pathname === "/" || pathname === "/index.html") {
      const html = (await fs.promises.readFile(path.join(__dirname, "index.html"), "utf8")).replace("__SKILLS_VIEWER_TOKEN__", CSRF_TOKEN);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    res.writeHead(404); res.end("Non trovato");
  } catch (err) {
    json(500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const port = server.address().port;
  for (const h of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    ALLOWED_HOSTS.add(h);
    ALLOWED_ORIGINS.add("http://" + h);
  }
  if (APP_MODE) {
    console.log(`SKILLSVIEWER_URL http://127.0.0.1:${port}/`);
    process.stdin.on("end", () => process.exit(0)); // l'app si è chiusa (anche in crash)
    process.stdin.resume();
    return;
  }
  const url = `http://localhost:${port}`;
  console.log(`Skills Viewer ${VERSION} attivo su ${url}`);
  console.log("Non elimina mai niente: copia le skill solo quando lo confermi, e sposta nel backup le versioni sostituite.");
  console.log("Per fermarlo: Ctrl+C");
  if (!process.env.NO_OPEN) exec(`open ${url}`);
});

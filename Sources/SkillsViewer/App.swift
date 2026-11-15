import AppKit
import WebKit

// Skills Viewer.app: una finestra che mostra l'interfaccia di server.js.
// server.js e index.html stanno dentro l'app (Contents/Resources) e il server viene avviato
// in "modalità app": sceglie da solo una porta libera, scrive l'indirizzo su stdout e si chiude
// quando l'app chiude la sua stdin (anche se l'app va in crash).

@main
enum SkillsViewerApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var serverInput: Pipe?
    private var serverURL: URL?
    private var stderrText = ""

    private let home = FileManager.default.homeDirectoryForCurrentUser

    // MARK: avvio e chiusura

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let icon = NSImage(contentsOf: url), icon.isValid {
            NSApp.applicationIconImage = icon
        }
        installMenu()

        webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        webView.uiDelegate = self  // senza, confirm() nella pagina risponde sempre "no"
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Skills Viewer"
        window.minSize = NSSize(width: 640, height: 480)
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MainWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startLaunchCheckTimeout()
        startServer()
    }

    // tornando sull'app (da un'altra finestra) ricontrolla le skill
    func applicationDidBecomeActive(_ notification: Notification) {
        guard serverURL != nil else { return }
        webView.evaluateJavaScript("window.skillsViewerRefresh && window.skillsViewerRefresh()")
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    // MARK: server Node

    private func findNode() -> URL? {
        // le app non vedono il PATH del Terminale: proviamo i percorsi più comuni
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node",
                          home.appendingPathComponent(".volta/bin/node").path]
        let nvm = home.appendingPathComponent(".nvm/versions/node")
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm.path) {
            for v in versions.sorted(by: { $0.compare($1, options: .numeric) == .orderedDescending }) {
                candidates.append(nvm.appendingPathComponent(v).appendingPathComponent("bin/node").path)
            }
        }
        if let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return URL(fileURLWithPath: path)
        }
        // ultimo tentativo: chiedere alla shell di login dove sta node
        let shell = Process(), out = Pipe()
        shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
        shell.arguments = ["-lc", "command -v node"]
        shell.standardOutput = out
        shell.standardError = FileHandle.nullDevice
        guard (try? shell.run()) != nil else { return nil }
        shell.waitUntilExit()
        let path = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return FileManager.default.isExecutableFile(atPath: path) ? URL(fileURLWithPath: path) : nil
    }

    private func startServer() {
        stopServer()
        guard let script = Bundle.main.url(forResource: "server", withExtension: "js") else {
            return showMessage("Manca server.js", "L'app è incompleta: ricompilala con Scripts/build-app.sh.")
        }
        guard let node = findNode() else {
            return showMessage("Node.js non trovato",
                               "Skills Viewer ha bisogno di Node.js. Installalo da nodejs.org e riapri l'app.",
                               button: "Riprova")
        }
        showMessage("Leggo le skill…", "")

        let process = Process()
        process.executableURL = node
        process.arguments = [script.path, "--app"]
        var env = ProcessInfo.processInfo.environment
        // cartella dei progetti: quella che conteneva Skills Viewer quando è stata compilata l'app
        if let dir = Bundle.main.object(forInfoDictionaryKey: "SkillsViewerProjectsDir") as? String {
            env["PROJECTS_DIR"] = dir
        }
        process.environment = env

        let input = Pipe(), output = Pipe(), errors = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        stderrText = ""

        var buffer = ""
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            buffer += String(decoding: data, as: UTF8.self)
            guard let line = buffer.split(separator: "\n").first(where: { $0.hasPrefix("SKILLSVIEWER_URL ") }),
                  let url = URL(string: String(line.dropFirst("SKILLSVIEWER_URL ".count))) else { return }
            handle.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self, self.server === process else { return }
                self.serverURL = url
                self.webView.load(URLRequest(url: url))
            }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            let text = String(decoding: data, as: UTF8.self)
            DispatchQueue.main.async { self?.stderrText = String(((self?.stderrText ?? "") + text).suffix(4000)) }
        }
        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self, self.server === proc else { return }  // fermato da noi: tutto ok
                self.server = nil
                self.serverURL = nil
                self.showMessage("Skills Viewer si è fermato",
                                 self.stderrText.isEmpty ? "Codice di uscita \(proc.terminationStatus)" : self.stderrText,
                                 button: "Riprova")
            }
        }

        do {
            try process.run()
            server = process
            serverInput = input
        } catch {
            showMessage("Impossibile avviare Node.js", error.localizedDescription, button: "Riprova")
        }
    }

    private func stopServer() {
        guard let process = server else { return }
        server = nil
        serverURL = nil
        try? serverInput?.fileHandleForWriting.close()  // il server esce da solo
        serverInput = nil
        if process.isRunning { process.terminate() }
    }

    // MARK: comandi dei menu

    private func clickInPage(_ id: String) {
        guard serverURL != nil else { return startServer() }
        webView.evaluateJavaScript("document.getElementById('\(id)')?.click()")
    }

    @objc func reloadSkills(_ sender: Any?) { clickInPage("reload") }
    @objc func alignAll(_ sender: Any?) { clickInPage("alignAll") }

    @objc func focusSearch(_ sender: Any?) {
        webView.evaluateJavaScript("(document.querySelector('#wide:not([hidden]) #search') || document.querySelector('[data-search]'))?.focus()")
    }

    private func reveal(_ relative: String) {
        let url = home.appendingPathComponent(relative)
        if FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            let alert = NSAlert()
            alert.messageText = "Cartella non trovata"
            alert.informativeText = url.path
            alert.beginSheetModal(for: window)
        }
    }

    @objc func revealClaude(_ sender: Any?) { reveal(".claude/skills") }
    @objc func revealCodex(_ sender: Any?) { reveal(".codex/skills") }
    @objc func revealBackup(_ sender: Any?) { reveal(".skills-viewer-backup") }

    // MARK: pagine di messaggio

    private func showMessage(_ title: String, _ detail: String, button: String? = nil) {
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
        }
        let action = button.map { "<p><a href=\"skillsviewer:retry\">\(esc($0))</a></p>" } ?? ""
        let html = """
        <!DOCTYPE html><html><head><meta charset="utf-8"><style>
        :root{color-scheme:light dark}
        body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f4;
        color:#1d1d1b;font:14px/1.5 -apple-system,sans-serif;text-align:center}
        @media (prefers-color-scheme: dark){body{background:#1b1b1a;color:#ecebe7}}
        div{max-width:560px;padding:24px}h1{font-size:20px;margin:0 0 10px}
        pre{white-space:pre-wrap;color:#8d8d96;font:12px/1.5 ui-monospace,monospace;text-align:left}
        a{display:inline-block;margin-top:8px;background:#0a84ff;color:#fff;text-decoration:none;
        padding:8px 16px;border-radius:8px}
        </style></head><body><div><h1>\(esc(title))</h1><pre>\(esc(detail))</pre>\(action)</div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: finestre di conferma della pagina (confirm/alert)

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        let parts = message.components(separatedBy: "\n\n")
        alert.messageText = parts[0]
        alert.informativeText = parts.dropFirst().joined(separator: "\n\n")
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annulla")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    // MARK: verifica automatica (SkillsViewer --check-launch)

    private static let checking = CommandLine.arguments.contains("--check-launch")

    private func startLaunchCheckTimeout() {
        guard Self.checking else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
            fputs("Verifica non riuscita: la pagina non si è caricata entro 20 secondi.\n", stderr)
            exit(1)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard Self.checking, webView.url?.host == "127.0.0.1" else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            // conta le skill e prova una richiesta di copia su una skill inesistente:
            // deve passare i controlli di sicurezza (token compreso) e rispondere "Skill non trovata", senza scrivere niente
            let js = """
                const token = document.querySelector('meta[name="skills-viewer-token"]').content;
                const r = await fetch('/api/copy', {method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-Skills-Viewer-Token': token},
                    body: JSON.stringify({items: [{folder: '__verifica__', from: 'claude'}]})});
                const out = await r.json();
                return JSON.stringify({sources: document.querySelectorAll('.side').length,
                    rows: document.querySelectorAll('.item, .card, .nav-item').length,
                    error: document.getElementById('hero').classList.contains('err'),
                    align: r.status + ' ' + out.error});
                """
            webView.callAsyncJavaScript(js, in: nil, in: .page) { result in
                let text: String
                switch result {
                case .success(let value): text = (value as? String) ?? "\(value)"
                case .failure(let error): text = "errore: \(error.localizedDescription)"
                }
                let ok = !text.contains("\"sources\":0") && !text.contains("\"sources\":1,")
                    && text.contains("\"error\":false") && text.contains("404 Skill non trovata")
                    && !text.contains("\"rows\":0,")
                fputs((ok ? "Avvio verificato: " : "Verifica non riuscita: ") + text + "\n", stderr)
                if ok { NSApp.terminate(nil) } else { exit(1) }
            }
        }
    }

    // MARK: navigazione

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "skillsviewer" {
            decisionHandler(.cancel)
            startServer()
            return
        }
        if url.scheme == "about" || (url.host == "127.0.0.1" && url.port == serverURL?.port) {
            return decisionHandler(.allow)
        }
        decisionHandler(.cancel)  // qualsiasi link esterno si apre nel browser
        if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
    }

    // MARK: menu

    private func installMenu() {
        let main = NSMenu()

        func submenu(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            item.submenu = menu
            main.addItem(item)
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "",
                  _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            return i
        }

        submenu("Skills Viewer", [
            item("Informazioni su Skills Viewer", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Nascondi Skills Viewer", #selector(NSApplication.hide(_:)), "h"),
            item("Nascondi altre", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Mostra tutte", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Esci da Skills Viewer", #selector(NSApplication.terminate(_:)), "q"),
        ])
        submenu("Archivio", [
            item("Aggiorna", #selector(reloadSkills(_:)), "r"),
            item("Cerca", #selector(focusSearch(_:)), "f"),
            item("Copia le skill mancanti…", #selector(alignAll(_:)), "a", [.command, .shift]),
            .separator(),
            item("Mostra skill di Claude nel Finder", #selector(revealClaude(_:))),
            item("Mostra skill di Codex nel Finder", #selector(revealCodex(_:))),
            item("Mostra backup nel Finder", #selector(revealBackup(_:))),
            .separator(),
            item("Chiudi finestra", #selector(NSWindow.performClose(_:)), "w"),
        ])
        // senza questo menu ⌘C, ⌘V, ⌘Z e ⌘A non funzionano nei campi di testo
        submenu("Modifica", [
            item("Annulla", Selector(("undo:")), "z"),
            item("Ripeti", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Taglia", #selector(NSText.cut(_:)), "x"),
            item("Copia", #selector(NSText.copy(_:)), "c"),
            item("Incolla", #selector(NSText.paste(_:)), "v"),
            item("Seleziona tutto", #selector(NSText.selectAll(_:)), "a"),
        ])
        submenu("Finestra", [
            item("Contrai", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Ridimensiona", #selector(NSWindow.performZoom(_:))),
        ])
        NSApp.windowsMenu = main.items.last?.submenu
        NSApp.mainMenu = main
    }
}

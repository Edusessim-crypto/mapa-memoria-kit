import Cocoa
import WebKit
import Speech
import AVFoundation

// Segundo Cérebro — app nativo do Mac que abre o holomapa 3D em tela cheia.
// Ao abrir, inicia o servidor local (servidor.py, só 127.0.0.1) que monta o mapa com o vault atual e
// permite ler e editar notas pela interface; ⌘R recarrega. Se o servidor não subir, abre o arquivo
// gerado em modo somente leitura. Links obsidian:// e externos abrem fora do app.
//
// Argumentos de teste (opcionais):
//   --captura <arquivo.png>  tira uma foto da janela e fecha o app
//   --espera <segundos>      quanto esperar antes da foto (padrão 10)
//   --consulta "?estatico"   parâmetros acrescentados ao endereço do mapa
//   --tamanho 1600x1000      tamanho da janela (sem tela cheia)

/// Comandos de voz: reconhecimento de fala do macOS em português (no próprio Mac quando disponível).
/// A página pede "iniciar"/"parar" pela ponte "escuta"; os resultados voltam como SC.emit('escuta', {...}).
final class Escuta {
    private let reconhecedor = SFSpeechRecognizer(locale: Locale(identifier: "pt-BR"))
    private let motor = AVAudioEngine()
    private var pedido: SFSpeechAudioBufferRecognitionRequest?
    private var tarefa: SFSpeechRecognitionTask?
    private var ultimoNivel = Date.distantPast
    var enviar: (([String: Any]) -> Void)?
    /// nomes do vault (sistemas, projetos) — o reconhecedor passa a preferi-los ("Cliente X", não "cliente xis")
    private var termos: [String] = []

    func iniciar(termos: [String] = []) {
        self.termos = Array(termos.prefix(300))
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self.enviar?(["tipo": "erro", "texto": "Permita o Reconhecimento de Fala para o Segundo Cérebro em Ajustes do Sistema → Privacidade e Segurança."])
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { liberado in
                    DispatchQueue.main.async {
                        if liberado { self.comecar() }
                        else { self.enviar?(["tipo": "erro", "texto": "Permita o microfone para o Segundo Cérebro em Ajustes do Sistema → Privacidade e Segurança → Microfone."]) }
                    }
                }
            }
        }
    }

    private func comecar() {
        tarefa?.cancel(); tarefa = nil
        pararMotor()
        guard let reconhecedor = reconhecedor, reconhecedor.isAvailable else {
            enviar?(["tipo": "erro", "texto": "O reconhecimento de fala em português não está disponível agora."])
            return
        }
        let novo = SFSpeechAudioBufferRecognitionRequest()
        novo.shouldReportPartialResults = true
        if reconhecedor.supportsOnDeviceRecognition { novo.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { novo.addsPunctuation = false }
        if !termos.isEmpty { novo.contextualStrings = termos }
        pedido = novo
        let entrada = motor.inputNode
        entrada.installTap(onBus: 0, bufferSize: 1024, format: entrada.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            self?.pedido?.append(buffer)
            self?.medir(buffer)
        }
        motor.prepare()
        do { try motor.start() } catch {
            enviar?(["tipo": "erro", "texto": "Não consegui abrir o microfone."])
            return
        }
        tarefa = reconhecedor.recognitionTask(with: novo) { [weak self] resultado, erro in
            guard let self = self else { return }
            if let resultado = resultado {
                let texto = resultado.bestTranscription.formattedString
                let final = resultado.isFinal
                DispatchQueue.main.async {
                    self.enviar?(["tipo": final ? "final" : "parcial", "texto": texto])
                    if final { self.pararMotor() }
                }
            } else if erro != nil {
                DispatchQueue.main.async { self.pararMotor(); self.enviar?(["tipo": "fim"]) }
            }
        }
    }

    /// Para de ouvir; o reconhecedor ainda entrega o resultado final do que já foi dito.
    func parar() {
        pararMotor()
        pedido?.endAudio()
    }

    private func pararMotor() {
        if motor.isRunning { motor.stop() }
        motor.inputNode.removeTap(onBus: 0)
    }

    private func medir(_ buffer: AVAudioPCMBuffer) {
        guard let canal = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        if n == 0 { return }
        var soma: Float = 0
        for i in 0..<n { soma += canal[i] * canal[i] }
        let nivel = Double(sqrt(soma / Float(n)))
        let agora = Date()
        guard agora.timeIntervalSince(ultimoNivel) > 0.07 else { return }
        ultimoNivel = agora
        DispatchQueue.main.async { self.enviar?(["tipo": "nivel", "nivel": nivel]) }
    }
}

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let escuta = Escuta()
    var janela: NSWindow!
    var web: WKWebView!
    var servidor: Process?
    var urlServidor: URL?
    let pasta: URL
    let consulta: String
    let captura: String?
    let espera: Double
    let tamanho: NSSize?

    init(pasta: URL, consulta: String, captura: String?, espera: Double, tamanho: NSSize?) {
        self.pasta = pasta
        self.consulta = consulta
        self.captura = captura
        self.espera = espera
        self.tamanho = tamanho
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        montarMenu()

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        if captura != nil {
            // modo de teste: repassa erros e avisos do JavaScript para o terminal
            let coletor = WKUserScript(source: """
                window.__erros = [];
                addEventListener('error', function (e) { __erros.push(String(e.message || (e.target && (e.target.src || e.target.href)) || e) + ' @' + (e.filename || '') + ':' + (e.lineno || 0)); }, true);
                addEventListener('unhandledrejection', function (e) { __erros.push('promessa: ' + String(e.reason)); });
                ['error', 'warn'].forEach(function (nivel) { var original = console[nivel]; console[nivel] = function () { try { window.webkit.messageHandlers.log.postMessage(nivel + ': ' + Array.prototype.join.call(arguments, ' ')); } catch (x) {} original.apply(console, arguments); }; });
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            config.userContentController.addUserScript(coletor)
            config.userContentController.add(self, name: "log")
        }
        // comandos de voz: a página sabe que existe escuta nativa e conversa pela ponte "escuta"
        config.userContentController.addUserScript(WKUserScript(source: "window.__escutaNativa = true;",
                                                                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "escuta")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: config)
        escuta.enviar = { [weak self] dados in
            guard let self = self, let json = try? JSONSerialization.data(withJSONObject: dados),
                  let texto = String(data: json, encoding: .utf8) else { return }
            self.web.evaluateJavaScript("window.SC && SC.emit && SC.emit('escuta', \(texto))", completionHandler: nil)
        }
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        let tela = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let quadro = tamanho.map { NSRect(x: 60, y: 60, width: $0.width, height: $0.height) } ?? tela
        janela = NSWindow(contentRect: quadro,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        janela.title = "Segundo Cérebro"
        janela.titlebarAppearsTransparent = true
        janela.titleVisibility = .hidden
        janela.backgroundColor = NSColor(srgbRed: 0.004, green: 0.012, blue: 0.031, alpha: 1)
        janela.collectionBehavior = [.fullScreenPrimary]
        janela.contentView = web
        janela.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        iniciarServidor { url in
            DispatchQueue.main.async {
                self.urlServidor = url
                if url == nil { self.gerarMapa() }   // sem servidor: arquivo gerado, somente leitura
                self.carregar()
                if self.captura != nil { self.agendarCaptura() }
                // mantém o arquivo de reserva (somente leitura) atualizado, sem atrasar a abertura
                if url != nil { DispatchQueue.global(qos: .utility).async { self.gerarMapa() } }
            }
        }
        if captura == nil {
            DispatchQueue.main.async { self.janela.toggleFullScreen(nil) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        servidor?.terminate()
    }

    /// Inicia o servidor local numa porta livre e devolve o endereço (ou nil se não subir em 8 s).
    func iniciarServidor(_ pronto: @escaping (URL?) -> Void) {
        let script = pasta.appendingPathComponent("servidor.py")
        guard FileManager.default.fileExists(atPath: script.path) else { pronto(nil); return }
        let processo = Process()
        processo.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        processo.arguments = [script.path, "--porta", "0", "--pai", String(ProcessInfo.processInfo.processIdentifier)]
        let saida = Pipe()
        processo.standardOutput = saida
        processo.standardError = FileHandle.nullDevice
        let trava = NSLock()
        var entregue = false
        let entregar: (URL?) -> Void = { url in
            trava.lock(); defer { trava.unlock() }
            if entregue { return }
            entregue = true
            pronto(url)
        }
        let teste = captura != nil
        saida.fileHandleForReading.readabilityHandler = { arquivo in
            let dados = arquivo.availableData   // continua lendo: o log do servidor nunca enche o cano
            guard !dados.isEmpty, let texto = String(data: dados, encoding: .utf8) else { return }
            if teste { print(texto, terminator: ""); fflush(stdout) }
            for linha in texto.split(separator: "\n") where linha.hasPrefix("PRONTO ") {
                entregar(URL(string: linha.dropFirst(7).trimmingCharacters(in: .whitespaces)))
            }
        }
        do { try processo.run(); servidor = processo } catch { entregar(nil); return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 8) { entregar(nil) }
    }

    func carregar() {
        if let base = urlServidor, let endereco = URL(string: base.absoluteString + consulta) {
            web.load(URLRequest(url: endereco))
            return
        }
        let html = pasta.appendingPathComponent("Mapa do Segundo Cérebro.html")
        var endereco = html
        if !consulta.isEmpty, let comConsulta = URL(string: html.absoluteString + consulta) {
            endereco = comConsulta
        }
        web.loadFileURL(endereco, allowingReadAccessTo: pasta)
    }

    func gerarMapa() {
        let script = pasta.appendingPathComponent("gerar_mapa.py")
        guard FileManager.default.fileExists(atPath: script.path) else { return }
        let processo = Process()
        processo.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        processo.arguments = [script.path]
        processo.standardOutput = FileHandle.nullDevice
        processo.standardError = FileHandle.nullDevice
        try? processo.run()
        processo.waitUntilExit()
    }

    @objc func atualizarMapa(_ sender: Any?) {
        if urlServidor != nil { web.reload(); return }   // o servidor remonta o mapa a cada carregamento
        gerarMapa()
        carregar()
    }

    @objc func abrirNoNavegador(_ sender: Any?) {
        if let url = web.url, url.scheme?.hasPrefix("http") == true { NSWorkspace.shared.open(url) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive mensagem: WKScriptMessage) {
        if mensagem.name == "escuta" {
            let corpo = mensagem.body as? [String: Any]
            let acao = corpo?["acao"] as? String
            if acao == "iniciar" { escuta.iniciar(termos: corpo?["termos"] as? [String] ?? []) } else { escuta.parar() }
            return
        }
        print("JS", mensagem.body)
    }

    func agendarCaptura() {
        DispatchQueue.main.asyncAfter(deadline: .now() + espera) { [weak self] in
            guard let self = self, let saida = self.captura else { return }
            let estado = """
                JSON.stringify({ok: !!window.__ok, classe: document.body.className, boot: !!document.getElementById('boot'),
                  fallback: !document.getElementById('fallback').hidden, erros: window.__erros || [],
                  brand: getComputedStyle(document.querySelector('.brand')).opacity,
                  rotulos: document.querySelectorAll('#labels > div').length,
                  canvas: document.getElementById('gl') ? document.getElementById('gl').width + 'x' + document.getElementById('gl').height : 'sem canvas',
                  navegador: navigator.userAgent, diag: window.__diag ? window.__diag() : null, vozes: Array.from(document.querySelectorAll('#listaVozes .voz')).map(function (b) { return (b.classList.contains('sel') ? '[x] ' : '') + b.innerText.replace(/\\s+/g, ' '); })})
                """
            self.web.evaluateJavaScript(estado) { resultado, erro in
                print("ESTADO", resultado ?? "nil", erro?.localizedDescription ?? "")
                self.web.evaluateJavaScript("window.__foto ? window.__foto() : ''") { foto, _ in
                    if let texto = foto as? String, let virgula = texto.firstIndex(of: ","),
                       let dados = Data(base64Encoded: String(texto[texto.index(after: virgula)...])) {
                        try? dados.write(to: URL(fileURLWithPath: saida + ".cena.png"))
                    }
                    self.web.takeSnapshot(with: WKSnapshotConfiguration()) { imagem, _ in
                        if let imagem = imagem, let tiff = imagem.tiffRepresentation,
                           let bitmap = NSBitmapImageRep(data: tiff),
                           let png = bitmap.representation(using: .png, properties: [:]) {
                            try? png.write(to: URL(fileURLWithPath: saida))
                        }
                        fflush(stdout)
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }

    // obsidian:// e qualquer link externo abrem fora do app
    func webView(_ webView: WKWebView, decidePolicyFor acao: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = acao.request.url, let esquema = url.scheme?.lowercased() {
            let local = ["http", "https"].contains(esquema) && ["127.0.0.1", "localhost"].contains(url.host ?? "")
            if !["file", "about", "blob", "data"].contains(esquema) && !local {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for acao: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = acao.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func montarMenu() {
        let principal = NSMenu()

        let itemApp = NSMenuItem()
        principal.addItem(itemApp)
        let menuApp = NSMenu()
        menuApp.addItem(withTitle: "Ocultar Segundo Cérebro", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        menuApp.addItem(.separator())
        menuApp.addItem(withTitle: "Sair do Segundo Cérebro", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        itemApp.submenu = menuApp

        let itemEditar = NSMenuItem()
        principal.addItem(itemEditar)
        let editar = NSMenu(title: "Editar")
        editar.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
        editar.addItem(.separator())
        editar.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editar.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editar.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editar.addItem(withTitle: "Selecionar tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        itemEditar.submenu = editar

        let itemVer = NSMenuItem()
        principal.addItem(itemVer)
        let ver = NSMenu(title: "Visualizar")
        let atualizar = NSMenuItem(title: "Atualizar mapa", action: #selector(atualizarMapa(_:)), keyEquivalent: "r")
        atualizar.target = self
        ver.addItem(atualizar)
        let navegador = NSMenuItem(title: "Abrir no navegador", action: #selector(abrirNoNavegador(_:)), keyEquivalent: "o")
        navegador.keyEquivalentModifierMask = [.command, .shift]
        navegador.target = self
        ver.addItem(navegador)
        let telaCheia = NSMenuItem(title: "Tela cheia", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        telaCheia.keyEquivalentModifierMask = [.control, .command]
        ver.addItem(telaCheia)
        itemVer.submenu = ver

        NSApp.mainMenu = principal
    }
}

let argumentos = CommandLine.arguments
func valor(_ chave: String) -> String? {
    guard let i = argumentos.firstIndex(of: chave), i + 1 < argumentos.count else { return nil }
    return argumentos[i + 1]
}
let pastaPadrao = (Bundle.main.object(forInfoDictionaryKey: "MapaPasta") as? String) ?? ""
var tamanhoJanela: NSSize? = nil
if let texto = valor("--tamanho") {
    let partes = texto.split(separator: "x").compactMap { Double($0) }
    if partes.count == 2 { tamanhoJanela = NSSize(width: partes[0], height: partes[1]) }
}
let aplicativo = NSApplication.shared
aplicativo.setActivationPolicy(.regular)
let delegado = App(pasta: URL(fileURLWithPath: valor("--pasta") ?? pastaPadrao),
                   consulta: valor("--consulta") ?? "",
                   captura: valor("--captura"),
                   espera: Double(valor("--espera") ?? "10") ?? 10,
                   tamanho: tamanhoJanela)
aplicativo.delegate = delegado
aplicativo.run()

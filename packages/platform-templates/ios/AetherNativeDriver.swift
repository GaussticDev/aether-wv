//
//  AetherNativeDriver.swift
//  Aether-WV iOS WebKit Driver
//
//  Production WebKit multi-process integration using WKContentWorld and WKScriptMessageHandlerWithReply
//

import Foundation
import WebKit

public final class AetherIosDriver: NSObject, WKScriptMessageHandlerWithReply {
    private weak var webView: WKWebView?
    private let contentWorldName = "AetherIsolatedWorld"
    private let handlerName = "aether"
    private var onFrameReceived: ((Data) -> Void)?

    public init(webView: WKWebView, onFrameReceived: @escaping (Data) -> Void) {
        self.webView = webView
        self.onFrameReceived = onFrameReceived
        super.init()
        self.setupDriver()
    }

    private func setupDriver() {
        guard let webView = self.webView else { return }
        
        let world = WKContentWorld.world(name: contentWorldName)
        let ucc = webView.configuration.userContentController
        
        // Register script message handler in isolated content world to prevent page XSS access
        ucc.addScriptMessageHandler(self, contentWorld: world, name: handlerName)
        
        // Inject bootstrap hook to bridge message to page context
        let bootstrapScript = """
        (function() {
            if (window.__aether_initialized) return;
            window.__aether_initialized = true;
            console.log('[Aether-WV] Isolated bridge attached');
        })();
        """
        let userScript = WKUserScript(source: bootstrapScript, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: world)
        ucc.addUserScript(userScript)
    }

    // MARK: - WKScriptMessageHandlerWithReply
    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let dict = message.body as? [String: Any],
              let b64 = dict["payload"] as? String,
              let data = Data(base64Encoded: b64) else {
            replyHandler(nil, "[AetherIosDriver] Malformed binary payload")
            return
        }

        // Process incoming frame on background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.onFrameReceived?(data)
            replyHandler(["status": "ack"], nil)
        }
    }

    // MARK: - Dispatch frame back to WebView
    public func sendFrameToWeb(data: Data) {
        let b64 = data.base64EncodedString()
        let js = "window.__aether_native_dispatch && window.__aether_native_dispatch('\(b64)');"
        
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, in: nil, in: .page) { _, error in
                if let error = error {
                    print("[AetherIosDriver] evaluateJavaScript error: \(error.localizedDescription)")
                }
            }
        }
    }
}

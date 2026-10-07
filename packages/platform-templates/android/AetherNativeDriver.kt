//
//  AetherNativeDriver.kt
//  Aether-WV Android Chromium Driver
//
//  Production WebViewCompat integration with binary WebMessagePort and origin validation
//

package io.aether.webview

import android.net.Uri
import android.webkit.WebView
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebMessagePortCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.Executors

class AetherAndroidDriver(
    private val webView: WebView,
    private val allowedOrigins: Set<String>,
    private val onFrameReceived: (ByteArray) -> Unit
) {
    private val backgroundExecutor = Executors.newSingleThreadExecutor()
    private var nativePort: WebMessagePortCompat? = null

    init {
        setupDriver()
    }

    private fun setupDriver() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw UnsupportedOperationException("WEB_MESSAGE_LISTENER is required for Aether-WV")
        }

        // Establish channel messaging on document load
        WebViewCompat.addWebMessageListener(
            webView,
            "aetherNativeChannel",
            allowedOrigins
        ) { _, message, sourceOrigin, isMainFrame, _ ->
            // Extract raw bytes or channel port
            val bytes = message.data?.toByteArray(Charsets.ISO_8859_1)
            if (bytes != null) {
                backgroundExecutor.execute {
                    onFrameReceived(bytes)
                }
            }
        }
    }

    fun sendFrameToWeb(data: ByteArray) {
        val message = WebMessageCompat(data.toString(Charsets.ISO_8859_1))
        webView.post {
            nativePort?.postMessage(message)
        }
    }
}

package com.jstorrent.io.socket

import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Trust-all X509TrustManager for TLS connections that skip certificate validation.
 *
 * Used when connecting to peers with self-signed certificates or when
 * certificate validation should be bypassed (e.g., for testing or
 * compatibility with certain trackers).
 *
 * WARNING: This disables TLS certificate validation. Only use when the
 * skipValidation flag is explicitly set by the caller.
 */
internal object InsecureTrustManager : X509TrustManager {

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        // Accept all client certificates
    }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        // Accept all server certificates
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()

    /**
     * Create an SSLSocketFactory that uses this insecure trust manager.
     */
    fun createInsecureSocketFactory(): SSLSocketFactory {
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<TrustManager>(InsecureTrustManager), SecureRandom())
        return sslContext.socketFactory
    }
}

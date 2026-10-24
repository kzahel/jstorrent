package org.rstorrent.bootstrap

import org.rstorrent.bootstrap.uniffi.AndroidClientException

/** Return joined native cleanup failures without losing release or cancellation. */
internal suspend fun joinProductClientShutdown(
    shutdown: suspend () -> Unit,
    release: suspend () -> Unit,
): AndroidClientException? {
    var failure: AndroidClientException? = null
    try {
        shutdown()
    } catch (error: AndroidClientException) {
        failure = error
    } finally {
        try {
            release()
        } catch (error: Throwable) {
            failure?.let(error::addSuppressed)
            throw error
        }
    }
    return failure
}

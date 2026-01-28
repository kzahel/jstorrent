package com.jstorrent.app.cache

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Fake TorrentSummaryCache for testing.
 * Allows tests to control cached summaries without SharedPreferences.
 */
class FakeTorrentSummaryCache : TorrentSummaryCache(context = null) {

    private val _fakeSummaries = MutableStateFlow<List<CachedTorrentSummary>>(emptyList())
    private val _fakeIsLoaded = MutableStateFlow(true) // Default to loaded for tests

    override val summaries: Flow<List<CachedTorrentSummary>>
        get() = _fakeSummaries.asStateFlow()

    override val isLoaded: Flow<Boolean>
        get() = _fakeIsLoaded.asStateFlow()

    private var loadWasCalled = false
    private var simulateSlowLoad = false

    /**
     * Set the cached summaries for testing.
     */
    fun setCachedSummaries(summaries: List<CachedTorrentSummary>) {
        _fakeSummaries.value = summaries
    }

    /**
     * Set the isLoaded state for testing.
     * If simulateSlowLoad is true, load() won't automatically set isLoaded to true.
     */
    fun setIsLoaded(loaded: Boolean, simulateSlowLoad: Boolean = !loaded) {
        _fakeIsLoaded.value = loaded
        this.simulateSlowLoad = simulateSlowLoad
    }

    override suspend fun load(): List<CachedTorrentSummary> {
        loadWasCalled = true
        if (!simulateSlowLoad) {
            _fakeIsLoaded.value = true
        }
        return _fakeSummaries.value
    }

    override fun hasCachedTorrents(): Boolean {
        return _fakeSummaries.value.isNotEmpty()
    }

    fun wasLoadCalled(): Boolean = loadWasCalled

    fun reset() {
        _fakeSummaries.value = emptyList()
        _fakeIsLoaded.value = true
        loadWasCalled = false
    }
}

/**
 * Create a test cached torrent summary.
 */
fun createTestCachedSummary(
    infoHash: String = "abc123",
    name: String = "Test Torrent",
    progress: Double = 0.5,
    status: String = "stopped",
    totalSize: Long = 1000000000L,
    downloaded: Long = 500000000L,
    uploaded: Long = 100000000L,
    fileCount: Int = 10,
    addedAt: Long = System.currentTimeMillis(),
    hasMetadata: Boolean = true,
    userState: String = "active"
) = CachedTorrentSummary(
    infoHash = infoHash,
    name = name,
    progress = progress,
    status = status,
    totalSize = totalSize,
    downloaded = downloaded,
    uploaded = uploaded,
    fileCount = fileCount,
    addedAt = addedAt,
    hasMetadata = hasMetadata,
    userState = userState
)

package org.rstorrent.bootstrap

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductStorageReadinessTest {
    @Test
    fun startupDoesNotPresentUnknownFolderHealthAsRepair() {
        assertTrue(ProductState().checkingStorage)
        assertTrue(ProductState(ready = true).checkingStorage)
        assertTrue(ProductState(error = ProductError.Code.STORAGE_UNAVAILABLE).checkingStorage)
        assertTrue(ProductState(error = ProductError.Code.SELECT_DOWNLOAD_FOLDER).checkingStorage)
    }

    @Test
    fun completedProbeCanOfferRepairOrSelection() {
        assertFalse(ProductState(ready = true, storageRootChecking = false, error = ProductError.Code.STORAGE_UNAVAILABLE).checkingStorage)
        assertFalse(ProductState(ready = true, storageRootChecking = false, error = ProductError.Code.SELECT_DOWNLOAD_FOLDER).checkingStorage)
        assertFalse(ProductState(ready = true, storageRootChecking = false, storageRootReady = true).checkingStorage)
    }

    @Test
    fun initializationFailureMustRemainVisible() {
        assertFalse(ProductState(error = ProductError.Technical("initialization failed")).checkingStorage)
    }
}

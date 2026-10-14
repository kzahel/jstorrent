package org.rstorrent.bootstrap.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import org.rstorrent.bootstrap.ProductError
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.MediaFileAvailability

@Composable
internal fun productErrorText(error: ProductError): String =
    when (error) {
        is ProductError.Technical -> stringResource(R.string.error_technical, error.detail)
        is ProductError.MediaUnavailable -> mediaUnavailableText(error.reason)
        is ProductError.Code ->
            stringResource(
                when (error) {
                    ProductError.Code.SELECT_DOWNLOAD_FOLDER -> R.string.error_select_download_folder
                    ProductError.Code.STORAGE_UNAVAILABLE -> R.string.error_storage_unavailable
                    ProductError.Code.MEDIA_UNAVAILABLE -> R.string.error_media_unavailable
                    ProductError.Code.SETTINGS_UPDATE_EMPTY -> R.string.error_settings_update_empty
                    ProductError.Code.SETTINGS_LOADING -> R.string.error_settings_loading
                    ProductError.Code.POWER_SETTING_SAVE_FAILED -> R.string.error_power_save_failed
                    ProductError.Code.SHARE_SETTING_SAVE_FAILED -> R.string.error_share_setting_save_failed
                    ProductError.Code.TORRENT_SETTINGS_UPDATE_EMPTY ->
                        R.string.error_torrent_settings_update_empty
                    ProductError.Code.TORRENT_MISSING -> R.string.error_torrent_missing
                    ProductError.Code.NETWORK_PREFERENCE_SAVE_FAILED ->
                        R.string.error_network_preference_save_failed
                    ProductError.Code.NOTIFICATION_PREFERENCE_SAVE_FAILED ->
                        R.string.notification_setting_save_failed
                    ProductError.Code.BACKGROUND_NOTIFICATION_REQUIRED ->
                        R.string.error_background_notification_required
                    ProductError.Code.BACKGROUND_DOWNLOADS_REQUIRED ->
                        R.string.error_background_downloads_required
                    ProductError.Code.BACKGROUND_SETTING_SAVE_FAILED ->
                        R.string.error_background_setting_save_failed
                    ProductError.Code.DATA_RESET_IN_PROGRESS ->
                        R.string.error_data_reset_in_progress
                },
            )
    }

@Composable
private fun mediaUnavailableText(reason: MediaFileAvailability): String =
    stringResource(
        when (reason) {
            MediaFileAvailability.INCOMPLETE -> R.string.error_media_incomplete
            MediaFileAvailability.CHECKING -> R.string.error_media_checking
            MediaFileAvailability.UNVERIFIED -> R.string.error_media_unverified
            MediaFileAvailability.STORAGE_UNAVAILABLE -> R.string.error_media_storage_unavailable
            MediaFileAvailability.REMOVING -> R.string.error_media_removing
            MediaFileAvailability.RESOURCE_LIMIT -> R.string.error_media_resource_limit
            MediaFileAvailability.PADDING,
            MediaFileAvailability.INVALID_FILE,
            MediaFileAvailability.METADATA_UNAVAILABLE,
            -> R.string.error_media_unavailable
            MediaFileAvailability.SERVER_UNAVAILABLE -> R.string.error_media_server_unavailable
            MediaFileAvailability.AVAILABLE,
            MediaFileAvailability.STREAMABLE,
            -> R.string.error_media_start_failed
        },
    )

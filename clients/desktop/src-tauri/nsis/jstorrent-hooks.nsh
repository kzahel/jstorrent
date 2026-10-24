; Preserve the native page heading on the left, with brand artwork on
; the right. The pinned Tauri template includes this before MUI pages.
!define MUI_HEADERIMAGE_RIGHT

; Keep the JSTorrent file class private to this bundle and quote both the
; executable and the activated path. Tauri 2.11.5's generated APP_ASSOCIATE
; command quotes only %1, which breaks installations below a path containing
; spaces.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX \
    "Software\Classes\com.jstorrent.desktop.torrent\shell\open\command" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX \
    "Software\Google\Chrome\NativeMessagingHosts\com.jstorrent.rstorrent.native"
  DeleteRegKey SHCTX \
    "Software\Chromium\NativeMessagingHosts\com.jstorrent.rstorrent.native"
  RMDir /r "$APPDATA\com.jstorrent.desktop\native-host"
!macroend

; Keep the RSTorrent file class private to this bundle and quote both the
; executable and the activated path. Tauri 2.11.5's generated APP_ASSOCIATE
; command quotes only %1, which breaks installations below a path containing
; spaces.

!include "${__FILEDIR__}/native-host-ownership.nsh"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX \
    "Software\Classes\com.jstorrent.rstorrent.torrent\shell\open\command" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro RemoveOwnedNativeHost "Google\Chrome" "com.jstorrent.rstorrent.native" "com.jstorrent.rstorrent"
  !insertmacro RemoveOwnedNativeHost "Chromium" "com.jstorrent.rstorrent.native" "com.jstorrent.rstorrent"
  RMDir /r "$APPDATA\com.jstorrent.rstorrent\native-host"
!macroend

; Preserve the native page heading on the left, with brand artwork on
; the right. The pinned Tauri template includes this before MUI pages.
!define MUI_HEADERIMAGE_RIGHT
!include "${__FILEDIR__}/native-host-ownership.nsh"

!macro JSTorrentMsiReplacementPage
  !insertmacro MUI_HEADER_TEXT "Replace existing JSTorrent" "Windows Installer removal is required."
  ${NSD_CreateLabel} 0 0 100% 94u "Setup found a Windows Installer (MSI) version of JSTorrent. That version must be removed before this setup can continue.$\r$\n$\r$\nYour torrent library and downloaded files stay on this computer. Windows may ask for administrator approval.$\r$\n$\r$\nSelect Next to open the uninstall prompt, or Cancel to keep the existing installation."
  Pop $R1
!macroend

; Tauri writes generic associations before POSTINSTALL. Keep other clients'
; unprotected fallback defaults too, independently of protected UserChoice.
Var JSTPreviousTorrentClass
Var JSTPreviousMagnetCommand
Var JSTPreviousMagnetLabel
Var JSTPreviousMagnetIcon
Var JSTPreviousMagnetMarker
Var JSTMissingMagnetLabel
Var JSTMissingMagnetIcon
Var JSTMissingMagnetMarker

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $JSTPreviousTorrentClass SHCTX "Software\Classes\.torrent" ""
  ReadRegStr $JSTPreviousMagnetCommand SHCTX "Software\Classes\magnet\shell\open\command" ""
  ClearErrors
  ReadRegStr $JSTPreviousMagnetLabel SHCTX "Software\Classes\magnet" ""
  StrCpy $JSTMissingMagnetLabel 0
  ${If} ${Errors}
    StrCpy $JSTMissingMagnetLabel 1
  ${EndIf}
  ClearErrors
  ReadRegStr $JSTPreviousMagnetIcon SHCTX "Software\Classes\magnet\DefaultIcon" ""
  StrCpy $JSTMissingMagnetIcon 0
  ${If} ${Errors}
    StrCpy $JSTMissingMagnetIcon 1
  ${EndIf}
  ClearErrors
  ReadRegStr $JSTPreviousMagnetMarker SHCTX "Software\Classes\magnet" "URL Protocol"
  StrCpy $JSTMissingMagnetMarker 0
  ${If} ${Errors}
    StrCpy $JSTMissingMagnetMarker 1
  ${EndIf}
  ReadRegStr $R0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}_is1" "InstallLocation"
  ${If} $JSTPreviousMagnetCommand == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  ${OrIf} $JSTPreviousMagnetCommand == '$\"$INSTDIR\jstorrent-desktop.exe$\" $\"%1$\"'
  ${OrIf} $JSTPreviousMagnetCommand == '$\"$INSTDIR\JSTorrent Link Handler.exe$\" $\"%1$\"'
    StrCpy $JSTPreviousMagnetCommand ""
  ${ElseIf} $R0 != ""
    ${If} $JSTPreviousMagnetCommand == '$\"$R0JSTorrent Link Handler.exe$\" $\"%1$\"'
      StrCpy $JSTPreviousMagnetCommand ""
    ${EndIf}
  ${EndIf}
!macroend

; Keep the JSTorrent file class private to this bundle and quote both the
; executable and the activated path. The pinned Tauri generated APP_ASSOCIATE
; command quotes only %1, which breaks installations below a path containing
; spaces.

; Retain selected historical ProgIDs as aliases. Adopt only exact commands
; from this install directory or the independently identified Inno cohort.
; Never run its uninstaller: it unconditionally removes adopted keys/files.
!macro AdoptLegacyClass CLASS
  ReadRegStr $R0 SHCTX "Software\Classes\${CLASS}\shell\open\command" ""
  ReadRegStr $R1 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}_is1" "InstallLocation"
  ${If} $R0 == '$\"$INSTDIR\JSTorrent Link Handler.exe$\" $\"%1$\"'
  ${OrIf} $R0 == '$\"$INSTDIR\jstorrent-desktop.exe$\" $\"%1$\"'
  ${OrIf} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    WriteRegStr SHCTX "Software\Classes\${CLASS}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    WriteRegStr SHCTX "Software\Classes\${CLASS}\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  ${ElseIf} $R1 != ""
    ${If} $R0 == '$\"$R1JSTorrent Link Handler.exe$\" $\"%1$\"'
      WriteRegStr SHCTX "Software\Classes\${CLASS}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
      WriteRegStr SHCTX "Software\Classes\${CLASS}\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
    ${EndIf}
  ${EndIf}
!macroend

!macro RemoveOwnedClass CLASS
  ReadRegStr $R0 SHCTX "Software\Classes\${CLASS}\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegKey SHCTX "Software\Classes\${CLASS}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $JSTPreviousTorrentClass != ""
  ${AndIf} $JSTPreviousTorrentClass != "JSTorrent.Torrent"
  ${AndIf} $JSTPreviousTorrentClass != "com.jstorrent.desktop.torrent"
    WriteRegStr SHCTX "Software\Classes\.torrent" "" $JSTPreviousTorrentClass
  ${EndIf}
  ${If} $JSTPreviousMagnetCommand != ""
    WriteRegStr SHCTX "Software\Classes\magnet\shell\open\command" "" $JSTPreviousMagnetCommand
    ${If} $JSTMissingMagnetLabel = 1
      DeleteRegValue SHCTX "Software\Classes\magnet" ""
    ${Else}
      WriteRegStr SHCTX "Software\Classes\magnet" "" $JSTPreviousMagnetLabel
    ${EndIf}
    ${If} $JSTMissingMagnetIcon = 1
      DeleteRegValue SHCTX "Software\Classes\magnet\DefaultIcon" ""
      DeleteRegKey /ifempty SHCTX "Software\Classes\magnet\DefaultIcon"
    ${Else}
      WriteRegStr SHCTX "Software\Classes\magnet\DefaultIcon" "" $JSTPreviousMagnetIcon
    ${EndIf}
    ${If} $JSTMissingMagnetMarker = 1
      DeleteRegValue SHCTX "Software\Classes\magnet" "URL Protocol"
    ${Else}
      WriteRegStr SHCTX "Software\Classes\magnet" "URL Protocol" $JSTPreviousMagnetMarker
    ${EndIf}
  ${EndIf}
  !insertmacro AdoptLegacyClass "JSTorrent.Magnet"
  !insertmacro AdoptLegacyClass "JSTorrent.Torrent"
  ; Dedicated choice for Default Apps; do not replace another client's ProgID.
  WriteRegStr SHCTX "Software\Classes\com.jstorrent.desktop.magnet" "" "URL:JSTorrent magnet"
  WriteRegStr SHCTX "Software\Classes\com.jstorrent.desktop.magnet" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\com.jstorrent.desktop.magnet\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\com.jstorrent.desktop.magnet\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\JSTorrent\DesktopCapabilities" "ApplicationName" "JSTorrent"
  WriteRegStr SHCTX "Software\JSTorrent\DesktopCapabilities" "ApplicationDescription" "JSTorrent BitTorrent client"
  WriteRegStr SHCTX "Software\JSTorrent\DesktopCapabilities\FileAssociations" ".torrent" "com.jstorrent.desktop.torrent"
  WriteRegStr SHCTX "Software\JSTorrent\DesktopCapabilities\UrlAssociations" "magnet" "com.jstorrent.desktop.magnet"
  WriteRegStr SHCTX "Software\JSTorrent\DesktopCapabilities\UrlAssociations" "jstorrent" "jstorrent"
  WriteRegStr SHCTX "Software\RegisteredApplications" "JSTorrentDesktop" "Software\JSTorrent\DesktopCapabilities"
  ; Retire only the verified old advertised capability after both aliases work.
  ReadRegStr $R0 SHCTX "Software\RegisteredApplications" "JSTorrent"
  ReadRegStr $R1 SHCTX "Software\JSTorrent\Capabilities\FileAssociations" ".torrent"
  ReadRegStr $R2 SHCTX "Software\JSTorrent\Capabilities\UrlAssociations" "magnet"
  ReadRegStr $R3 SHCTX "Software\Classes\JSTorrent.Torrent\shell\open\command" ""
  ReadRegStr $R4 SHCTX "Software\Classes\JSTorrent.Magnet\shell\open\command" ""
  ${If} $R0 == "Software\JSTorrent\Capabilities"
  ${AndIf} $R1 == "JSTorrent.Torrent"
  ${AndIf} $R2 == "JSTorrent.Magnet"
  ${AndIf} $R3 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  ${AndIf} $R4 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegValue SHCTX "Software\RegisteredApplications" "JSTorrent"
  ${EndIf}
  WriteRegStr SHCTX \
    "Software\Classes\com.jstorrent.desktop.torrent\shell\open\command" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro RemoveOwnedClass "JSTorrent.Magnet"
  !insertmacro RemoveOwnedClass "JSTorrent.Torrent"
  ReadRegStr $R0 SHCTX "Software\Classes\com.jstorrent.desktop.magnet\shell\open\command" ""
  ${If} $R0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    !insertmacro RemoveOwnedClass "com.jstorrent.desktop.magnet"
    DeleteRegKey SHCTX "Software\JSTorrent\DesktopCapabilities"
    ReadRegStr $R0 SHCTX "Software\RegisteredApplications" "JSTorrentDesktop"
    ${If} $R0 == "Software\JSTorrent\DesktopCapabilities"
      DeleteRegValue SHCTX "Software\RegisteredApplications" "JSTorrentDesktop"
    ${EndIf}
  ${EndIf}
  !insertmacro RemoveOwnedNativeHost "Google\Chrome" "com.jstorrent.rstorrent.native" "com.jstorrent.desktop"
  !insertmacro RemoveOwnedNativeHost "Chromium" "com.jstorrent.rstorrent.native" "com.jstorrent.desktop"
  !insertmacro RemoveOwnedNativeHost "Google\Chrome" "com.jstorrent.native" "com.jstorrent.desktop"
  !insertmacro RemoveOwnedNativeHost "Chromium" "com.jstorrent.native" "com.jstorrent.desktop"
  !insertmacro RemoveOwnedNativeHost "BraveSoftware\Brave-Browser" "com.jstorrent.native" "com.jstorrent.desktop"
  !insertmacro RemoveOwnedNativeHost "Microsoft\Edge" "com.jstorrent.native" "com.jstorrent.desktop"
  RMDir /r "$APPDATA\com.jstorrent.desktop\native-host"
!macroend

; Native messaging is registered per user by Desktop at startup. The preview
; and production apps use the same current host name and different manifests.
!macro RemoveOwnedNativeHost BROWSER HOST IDENTIFIER
  ReadRegStr $R0 HKCU "Software\${BROWSER}\NativeMessagingHosts\${HOST}" ""
  ${If} $R0 == "$APPDATA\${IDENTIFIER}\native-host\${HOST}.json"
    DeleteRegKey HKCU "Software\${BROWSER}\NativeMessagingHosts\${HOST}"
  ${EndIf}
!macroend

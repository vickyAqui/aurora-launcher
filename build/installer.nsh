!macro customHeader
  BrandingText "Aurora Studios · Terra dos Sonhos"
!macroend

!macro customInit
  ; Brand colors and icons
  !define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
  !define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!macroend

!macro customInstallMode
  ; Default to current-user install
!macroend

!macro preInit
  DetailPrint "Aurora Studios Installer"
!macroend

!macro customInstall
  ; Post-install hook (empty = default behavior)
!macroend

!macro customUnInstall
  ; Clean up Aurora Studios data on uninstall
  RMDir /r "$APPDATA\aurora-studios"
!macroend

!macro customHeader
  BrandingText "Aurora Studios · Terra dos Sonhos"
!macroend

!macro customInit
  ; Branding only — electron-builder already defines MUI_ICON/MUI_UNICON
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

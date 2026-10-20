; Installer for the Electron-free test build (scripts/build-slim.mjs node). One click, per user, no admin.
; /S installs silently; /S /RUN also opens the app after (used by the in-app update).
Unicode true
!include "FileFunc.nsh"

Name "${PRODUCT}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${DIRNAME}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
Icon "${ICON}"
UninstallIcon "${ICON}"
ShowInstDetails nevershow
AutoCloseWindow true
BrandingText "${PRODUCT}"
Page instfiles
UninstPage instfiles

Section
  ; A running copy holds its files: close it first.
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Sleep 800
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\app"
  File /r "${STAGE}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${EXE}" '"$INSTDIR\app"' "$INSTDIR\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\${EXE}" '"$INSTDIR\app"' "$INSTDIR\${EXE}" 0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "Publisher" "${PRODUCT}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/RUN" $R1
  IfSilent 0 run
  IfErrors done
  run:
  Exec '"$INSTDIR\${EXE}" "$INSTDIR\app"'
  done:
SectionEnd

Section Uninstall
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Sleep 800
  Delete "$DESKTOP\${PRODUCT}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}"
SectionEnd

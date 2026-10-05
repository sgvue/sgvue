; Windows only (NSIS). On a laptop with two GPUs, Windows gives SGVue the integrated one and
; orbiting a large model stutters. This writes the per-app value Settings > System > Display >
; Graphics writes for "High performance" plus "Optimizations for windowed games" - and only when
; there is no value yet, so a choice the user made for SGVue.exe is never overwritten.
!define SGVUE_GPU_KEY "Software\Microsoft\DirectX\UserGpuPreferences"
!define SGVUE_GPU_DATA "GpuPreference=2;SwapEffectUpgradeEnable=1;"

!macro customInstall
  ClearErrors
  ReadRegStr $0 HKCU "${SGVUE_GPU_KEY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${if} ${Errors}
  ${andIf} $0 == ""
    WriteRegStr HKCU "${SGVUE_GPU_KEY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${SGVUE_GPU_DATA}"
  ${endIf}
!macroend

; A real uninstall removes the value only while it is still exactly ours. An update runs the old
; uninstaller with --updated, and that must leave it alone.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "${SGVUE_GPU_KEY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${if} $0 S== "${SGVUE_GPU_DATA}"
      DeleteRegValue HKCU "${SGVUE_GPU_KEY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${endIf}
  ${endIf}
!macroend

; ---------------------------------------------------------------------------------------------
; The assisted installer (electron-builder.yml: oneClick false): Welcome -> progress -> Finish.
; The same setup .exe is also the updater - the owner publishes a new one and the user runs it
; over the installed app - so every page says which of the three it is doing: a new install, an
; update, or a repair (this exact version is already installed). Modern UI's page texts are
; compile-time defines, so each one names a variable and the variables are filled in .onInit.
; Every function lives inside the macro that inserts it: makensis runs with -WX, and a function
; or variable the build does not use is a warning, so an error.

!define SGVUE_DESKTOP_LINK "$DESKTOP\${SHORTCUT_NAME}.lnk"

!ifndef BUILD_UNINSTALLER
  Var sgvueMode            ; new | update | repair
  Var sgvueOldVersion
  Var sgvueHadDesktopLink  ; 1 when the desktop shortcut existed before Setup touched anything
  Var sgvueWelcomeTitle
  Var sgvueWelcomeText
  Var sgvueButton
  Var sgvueProgressTitle
  Var sgvueProgressText
  Var sgvueFinishTitle
  Var sgvueFinishText
!endif

; Per-user only, as the one-click installers were: skip the "Only for me / Anyone" page. This is
; electron-builder's hook for forcing a mode (its multiUserUi.nsh reads it), in both builds.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Runs at the end of .onInit, after initMultiUser has pointed $INSTDIR at the existing install's
; InstallLocation (if there is one). The uninstall entry is the one every SGVue installer writes -
; the key is derived from the appId, so the old one-click installers wrote the same one.
!macro customInit
  StrCpy $sgvueMode "new"
  ReadRegStr $sgvueOldVersion HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${if} $sgvueOldVersion != ""
  ${andIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $sgvueMode "update"
    ${if} $sgvueOldVersion == "${VERSION}"
      StrCpy $sgvueMode "repair"
    ${endIf}
  ${endIf}

  StrCpy $sgvueHadDesktopLink "0"
  ${if} ${FileExists} "${SGVUE_DESKTOP_LINK}"
    StrCpy $sgvueHadDesktopLink "1"
  ${endIf}

  ${if} $sgvueMode == "update"
    StrCpy $sgvueWelcomeTitle "Update ${PRODUCT_NAME}"
    StrCpy $sgvueWelcomeText "${PRODUCT_NAME} $sgvueOldVersion is installed. Setup will update it to ${VERSION}. Your settings, recent files and saved views are kept.$\r$\n$\r$\nClick Update to continue."
    StrCpy $sgvueButton "&Update"
    StrCpy $sgvueProgressTitle "Updating ${PRODUCT_NAME}"
    StrCpy $sgvueProgressText "Please wait while ${PRODUCT_NAME} is updated to ${VERSION}."
    StrCpy $sgvueFinishTitle "Update complete"
    StrCpy $sgvueFinishText "${PRODUCT_NAME} has been updated to ${VERSION}."
  ${elseif} $sgvueMode == "repair"
    StrCpy $sgvueWelcomeTitle "Repair ${PRODUCT_NAME}"
    StrCpy $sgvueWelcomeText "${PRODUCT_NAME} ${VERSION} is already installed. Setup will reinstall it, which repairs a damaged installation. Your settings, recent files and saved views are kept.$\r$\n$\r$\nClick Repair to continue."
    StrCpy $sgvueButton "&Repair"
    StrCpy $sgvueProgressTitle "Repairing ${PRODUCT_NAME}"
    StrCpy $sgvueProgressText "Please wait while ${PRODUCT_NAME} ${VERSION} is reinstalled."
    StrCpy $sgvueFinishTitle "Repair complete"
    StrCpy $sgvueFinishText "${PRODUCT_NAME} ${VERSION} has been reinstalled."
  ${else}
    StrCpy $sgvueWelcomeTitle "Welcome to ${PRODUCT_NAME} ${VERSION} Setup"
    StrCpy $sgvueWelcomeText "Setup will install ${PRODUCT_NAME} ${VERSION} on this computer.$\r$\n$\r$\nClick Install to continue."
    StrCpy $sgvueButton "&Install"
    StrCpy $sgvueProgressTitle "Installing ${PRODUCT_NAME}"
    StrCpy $sgvueProgressText "Please wait while ${PRODUCT_NAME} ${VERSION} is installed."
    StrCpy $sgvueFinishTitle "Installation complete"
    StrCpy $sgvueFinishText "${PRODUCT_NAME} ${VERSION} has been installed."
  ${endIf}
  ; Windows has no supported way for an installer to pin to the taskbar, so Setup says how.
  StrCpy $sgvueFinishText "$sgvueFinishText$\r$\n$\r$\nTip: to pin ${PRODUCT_NAME} to the taskbar, right-click it in Start and choose Pin to taskbar.$\r$\n$\r$\nClick Finish to close Setup."
!macroend

; Welcome. The page after it is the (skipped) install-mode page, so NSIS labels the button
; "Next >"; it is the last page before the files are written, so it says what it will do.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$sgvueWelcomeTitle"
  !define MUI_WELCOMEPAGE_TEXT "$sgvueWelcomeText"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW sgvueWelcomeShow
  !insertmacro MUI_PAGE_WELCOME

  Function sgvueWelcomeShow
    SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$sgvueButton"
  FunctionEnd
!macroend

; Inserted right before MUI_PAGE_INSTFILES (assistedInstaller.nsh), so these two defines are the
; progress page's header.
!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "$sgvueProgressTitle"
  !define MUI_PAGE_HEADER_SUBTEXT "$sgvueProgressText"
!macroend

; Finish. "Open SGVue now" is electron-builder's own run-after-finish (its StartApp, unchanged).
; "Create a desktop shortcut" is the source of truth for that shortcut: ticked on a new install,
; and on an update or repair ticked only when the shortcut was there before Setup ran. Ticked,
; a missing shortcut is created (an existing one is left as the user has it); unticked, it is
; removed. The Start-menu shortcut is electron-builder's, as before.
!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "$sgvueFinishTitle"
  !define MUI_FINISHPAGE_TEXT "$sgvueFinishText"
  !define MUI_FINISHPAGE_TEXT_LARGE
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open ${PRODUCT_NAME} now"
  !define MUI_FINISHPAGE_RUN_FUNCTION sgvueStartApp
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION sgvueCreateDesktopLink
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW sgvueFinishShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE sgvueFinishLeave
  !insertmacro MUI_PAGE_FINISH

  Function sgvueStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function sgvueFinishShow
    ${if} $sgvueMode != "new"
    ${andIf} $sgvueHadDesktopLink != "1"
      ${NSD_Uncheck} $mui.FinishPage.ShowReadme
    ${endIf}
  FunctionEnd

  Function sgvueFinishLeave
    ${NSD_GetState} $mui.FinishPage.ShowReadme $0
    ${if} $0 <> ${BST_CHECKED}
    ${andIf} ${FileExists} "${SGVUE_DESKTOP_LINK}"
      WinShell::UninstShortcut "${SGVUE_DESKTOP_LINK}"
      Delete "${SGVUE_DESKTOP_LINK}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endIf}
  FunctionEnd

  Function sgvueCreateDesktopLink
    ${ifNot} ${FileExists} "${SGVUE_DESKTOP_LINK}"
      CreateShortCut "${SGVUE_DESKTOP_LINK}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "${SGVUE_DESKTOP_LINK}" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endIf}
  FunctionEnd
!macroend

; Uninstaller Welcome: same reason as the installer's - its button starts the uninstall, so it
; says Uninstall, and the text no longer says "Click Next".
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "Setup will remove ${PRODUCT_NAME} from this computer. Your settings, recent files and saved views are kept.$\r$\n$\r$\nClick Uninstall to continue."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.sgvueUnWelcomeShow
  !insertmacro MUI_UNPAGE_WELCOME

  Function un.sgvueUnWelcomeShow
    SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(^UninstallBtn)"
  FunctionEnd
!macroend

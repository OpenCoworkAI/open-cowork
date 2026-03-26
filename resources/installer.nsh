Var OpenCoworkCleanupDir
Var OpenCoworkCleanupCmd

Function OpenCoworkPrepareLegacyCleanupTool
  StrCpy $OpenCoworkCleanupDir "$TEMP\Open-Cowork-Legacy-Cleanup"
  StrCpy $OpenCoworkCleanupCmd ""

  CreateDirectory "$OpenCoworkCleanupDir"
  IfErrors cleanup_failed 0

  ClearErrors
  File "/oname=$OpenCoworkCleanupDir\Open-Cowork-Legacy-Cleanup.cmd" "${BUILD_RESOURCES_DIR}\windows\Open-Cowork-Legacy-Cleanup.cmd"
  IfErrors cleanup_failed 0

  ClearErrors
  File "/oname=$OpenCoworkCleanupDir\Open-Cowork-Legacy-Cleanup.ps1" "${BUILD_RESOURCES_DIR}\windows\Open-Cowork-Legacy-Cleanup.ps1"
  IfErrors cleanup_failed 0

  IfFileExists "$OpenCoworkCleanupDir\Open-Cowork-Legacy-Cleanup.cmd" 0 cleanup_failed
  StrCpy $OpenCoworkCleanupCmd "$OpenCoworkCleanupDir\Open-Cowork-Legacy-Cleanup.cmd"
  DetailPrint `Prepared embedded legacy cleanup helper: $OpenCoworkCleanupCmd`
  Return

  cleanup_failed:
    DetailPrint `Could not prepare embedded legacy cleanup helper in $OpenCoworkCleanupDir`
    StrCpy $OpenCoworkCleanupCmd ""
FunctionEnd

Function OpenCoworkShowLegacyUninstallHelp
  Exch $0
  DetailPrint `Legacy Open Cowork uninstall failed: $0`

  Call OpenCoworkPrepareLegacyCleanupTool
  StrCmp $OpenCoworkCleanupCmd "" check_external_cleanup_tool embedded_cleanup_tool

  embedded_cleanup_tool:
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "Open Cowork could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nThe installer has extracted an embedded cleanup tool here:$\r$\n$OpenCoworkCleanupCmd$\r$\n$\r$\nSelect Yes to launch it now. Select No to close this installer and run it yourself later.$\r$\n$\r$\nThe cleanup tool may request administrator approval if machine-wide leftovers are present.$\r$\nAdd -RemoveAppData only if you also want to clear local settings." IDYES launch_embedded_cleanup
    SetErrorLevel 2
    Quit

  launch_embedded_cleanup:
    ExecShell "open" "$OpenCoworkCleanupCmd"
    SetErrorLevel 2
    Quit

  check_external_cleanup_tool:
  IfFileExists "$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd" 0 no_cleanup_tool
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "Open Cowork could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nNext steps:$\r$\n1. Close all Open Cowork windows.$\r$\n2. Run:$\r$\n$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd$\r$\n3. Start this installer again.$\r$\n$\r$\nSelect Yes to launch it now. Select No to close this installer and run it yourself later.$\r$\n$\r$\nThe cleanup tool may request administrator approval if machine-wide leftovers are present.$\r$\nAdd -RemoveAppData only if you also want to clear local settings." IDYES launch_external_cleanup
    SetErrorLevel 2
    Quit

  launch_external_cleanup:
    ExecShell "open" "$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd"
    SetErrorLevel 2
    Quit

  no_cleanup_tool:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Open Cowork could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nPlease close Open Cowork, delete:$\r$\n$LOCALAPPDATA\Programs\Open Cowork$\r$\nand then run this installer again.$\r$\n$\r$\nLocal settings may remain in AppData by design."
    SetErrorLevel 2
    Quit
FunctionEnd

!macro customUnInstallCheck
  IfErrors 0 _oc_uninst_no_launch_err
    Push "could not launch the old uninstaller"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_uninst_no_launch_err:
  StrCmp $R0 0 _oc_uninst_ok
    Push "old uninstaller returned code $R0"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_uninst_ok:
!macroend

!macro customUnInstallCheckCurrentUser
  IfErrors 0 _oc_curuninst_no_launch_err
    Push "could not launch the old current-user uninstaller"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_curuninst_no_launch_err:
  StrCmp $R0 0 _oc_curuninst_ok
    Push "old current-user uninstaller returned code $R0"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_curuninst_ok:
!macroend

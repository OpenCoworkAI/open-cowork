Function OpenCoworkShowLegacyUninstallHelp
  Exch $0
  DetailPrint `Legacy Open Cowork uninstall failed: $0`

  IfFileExists "$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd" 0 no_cleanup_tool
    MessageBox MB_OK|MB_ICONEXCLAMATION "Open Cowork could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nNext steps:$\r$\n1. Close all Open Cowork windows.$\r$\n2. Run:$\r$\n$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd$\r$\n3. Start this installer again.$\r$\n$\r$\nAdd -RemoveAppData to the cleanup tool only if you also want to clear local settings."
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

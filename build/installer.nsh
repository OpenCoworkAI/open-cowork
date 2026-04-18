!include "nsProcess.nsh"

!macro customInit
  nsProcess::FindProcess "OpenCoworkAI.exe"
  Pop $R0
  
  StrCmp $R0 "1" 0 process_check_done
  
  nsProcess::KillProcess "OpenCoworkAI.exe"
  Pop $R0
  
  Sleep 3000
  
  nsProcess::FindProcess "OpenCoworkAI.exe"
  Pop $R0
  
  StrCmp $R0 "0" process_check_done
  
  MessageBox MB_OK "OpenCoworkAI is currently running. Please close the application manually and run the installer again."
  Abort
  
  process_check_done:
!macroend

!macro customInstall
  ExecWait 'taskkill /F /IM OpenCoworkAI.exe /FI "STATUS eq RUNNING"' $R0
!macroend
' Launches the print bridge with no console window.
'
' A visible black terminal on a shop counter gets closed — by a
' cashier tidying up, or by someone who thinks it is stuck. When it
' closes, nothing prints and no drawer opens. So it runs hidden and
' is supervised by Task Scheduler instead.
'
' Logs still go somewhere readable: bridge.log next to this file.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
' 0 = hidden window, False = do not wait
shell.Run "cmd /c node """ & here & "\print-bridge.mjs"" >> """ & here & "\bridge.log"" 2>&1", 0, False

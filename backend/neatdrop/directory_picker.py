"""Native folder selection isolated from the ASGI worker's GUI state."""
import base64
import json
import os
from pathlib import Path
import subprocess
from threading import Lock

from .files import SafetyError

_picker_lock = Lock()
_WINDOWS_SCRIPT = r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NeatDropFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")] private class FileOpenDialog {}
  [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint count, IntPtr types);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr bind, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint kind, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem item, uint hint, out int order);
  }
  public static string Choose(IntPtr owner) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    IShellItem item = null;
    IntPtr path = IntPtr.Zero;
    try {
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | 0x20u | 0x40u | 0x800u | 0x8u | 0x02000000u);
      dialog.SetTitle("NeatDrop - 选择待整理目录");
      dialog.SetOkButtonLabel("选择文件夹");
      int result = dialog.Show(owner);
      if (unchecked((uint)result) == 0x800704C7u) return null;
      Marshal.ThrowExceptionForHR(result);
      dialog.GetResult(out item);
      item.GetDisplayName(0x80058000u, out path);
      return Marshal.PtrToStringUni(path);
    } finally {
      if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
      if (item != null) Marshal.ReleaseComObject(item);
      Marshal.ReleaseComObject(dialog);
    }
  }
}
'@
$owner = New-Object System.Windows.Forms.Form
try {
    $owner.Text = 'NeatDrop - 选择待整理目录'
    $owner.ShowInTaskbar = $false
    $owner.TopMost = $true
    $owner.Opacity = 0
    $owner.Width = 1
    $owner.Height = 1
    $owner.StartPosition = 'CenterScreen'
    $owner.Show()
    $owner.Activate()
    $path = [NeatDropFolderPicker]::Choose($owner.Handle)
    [Console]::WriteLine((@{ path = $path } | ConvertTo-Json -Compress))
} finally {
    $owner.Dispose()
}
'''


def _is_windows():
    return os.name == 'nt'


def _windows_directory():
    executable = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe'
    encoded = base64.b64encode(_WINDOWS_SCRIPT.encode('utf-16-le')).decode('ascii')
    try:
        result = subprocess.run(
            [str(executable), '-NoProfile', '-NonInteractive', '-STA',
             '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
            capture_output=True,
            timeout=600, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SafetyError('PICKER_TIMEOUT') from exc
    if result.returncode or len(result.stdout) > 8192:
        raise SafetyError('PICKER_UNAVAILABLE')
    output = result.stdout.decode('utf-8-sig') if isinstance(result.stdout, bytes) else result.stdout
    payload = json.loads(output)
    if not isinstance(payload, dict) or set(payload) != {'path'}:
        raise SafetyError('PICKER_UNAVAILABLE')
    path = payload['path']
    if path is None:
        return None
    if not isinstance(path, str) or not path or len(path) > 1024 or '\0' in path or not Path(path).is_absolute():
        raise SafetyError('PICKER_UNAVAILABLE')
    return path


def _tk_directory():
    import tkinter
    from tkinter import filedialog
    window = tkinter.Tk()
    try:
        window.withdraw()
        window.attributes('-topmost', True)
        return filedialog.askdirectory(parent=window, title='NeatDrop - 选择待整理目录', mustexist=True) or None
    finally:
        window.destroy()


def choose_directory():
    if not _picker_lock.acquire(blocking=False):
        raise SafetyError('PICKER_BUSY')
    try:
        return _windows_directory() if _is_windows() else _tk_directory()
    except SafetyError:
        raise
    except Exception as exc:
        raise SafetyError('PICKER_UNAVAILABLE') from exc
    finally:
        _picker_lock.release()

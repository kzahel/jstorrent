"""Report only whether an observed process has an elevated Windows token."""
import ctypes as c
from ctypes import wintypes as w
import json
import sys

kernel = c.WinDLL("kernel32", use_last_error=True)
security = c.WinDLL("advapi32", use_last_error=True)
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.CloseHandle.argtypes = [w.HANDLE]
security.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
security.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
process = kernel.OpenProcess(0x1000, False, int(sys.argv[1]))
if not process:
    raise c.WinError(c.get_last_error())
token = w.HANDLE()
try:
    if not security.OpenProcessToken(process, 8, c.byref(token)):
        raise c.WinError(c.get_last_error())
    elevated, length = w.DWORD(), w.DWORD()
    if not security.GetTokenInformation(token, 20, c.byref(elevated), c.sizeof(elevated), c.byref(length)):
        raise c.WinError(c.get_last_error())
    print(json.dumps({"elevated": bool(elevated.value)}))
finally:
    if token:
        kernel.CloseHandle(token)
    kernel.CloseHandle(process)

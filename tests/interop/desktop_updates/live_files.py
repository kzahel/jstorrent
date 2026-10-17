"""Atomic test observations that tolerate concurrent Windows readers."""
import os
from pathlib import Path


def read_text(path):
    path = Path(path)
    if os.name != 'nt':
        return path.read_text(encoding='utf-8')
    import ctypes
    from ctypes import wintypes
    import msvcrt
    create = ctypes.WinDLL('kernel32', use_last_error=True).CreateFileW
    create.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                       ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    create.restype = wintypes.HANDLE
    handle = create(str(path), 0x80000000, 7, None, 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY)
    with os.fdopen(descriptor, encoding='utf-8') as stream:
        return stream.read()


def publish_text(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(value, encoding='utf-8')
    try:
        os.replace(temporary, path)
    except PermissionError:
        if os.name != 'nt':
            raise
        # An unrelated Windows reader may omit FILE_SHARE_DELETE. Retain the
        # last complete snapshot and retry on the next observation tick.
        return False
    return True

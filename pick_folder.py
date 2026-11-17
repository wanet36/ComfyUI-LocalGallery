"""弹出 Windows 原生文件夹选择框（Vista+ IFileOpenDialog，资源管理器同款）。

单独跑一个进程：对话框卡住时上层可以 kill 掉，不会把 ComfyUI 主线程拖死。

用法：python pick_folder.py [初始目录]
输出（最后一行 JSON）：
  {"ok": true, "paths": ["D:\\a", "D:\\b"]}     选了（支持多选）
  {"ok": false, "canceled": true}               取消
  {"ok": false, "error": "..."}                 出错
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

FOS_PICKFOLDERS = 0x20
FOS_FORCEFILESYSTEM = 0x40
FOS_PATHMUSTEXIST = 0x800
FOS_ALLOWMULTISELECT = 0x200
SIGDN_FILESYSPATH = 0x80058000

CLSID_FILE_OPEN_DIALOG = "{DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7}"
IID_IFILE_OPEN_DIALOG = "{d57c7288-d4ad-4768-be02-9d969532d960}"

ERROR_CANCELLED = -2147023673  # 0x800704C7


def _bring_to_front(title: str, seconds: float = 10.0) -> None:
    """Show() 会阻塞，另起线程把对话框提到最前 + 闪任务栏。

    不这么做的话，主窗口（浏览器）正好在前台时对话框可能被盖在下面，
    用户看着就像「点了浏览没反应」。
    """

    def worker() -> None:
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.WinDLL("user32", use_last_error=True)
            user32.FindWindowW.restype = wintypes.HWND
            user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
            user32.GetForegroundWindow.restype = wintypes.HWND

            class FLASHWINFO(ctypes.Structure):
                _fields_ = [
                    ("cbSize", wintypes.UINT),
                    ("hwnd", wintypes.HWND),
                    ("dwFlags", wintypes.DWORD),
                    ("uCount", wintypes.UINT),
                    ("dwTimeout", wintypes.DWORD),
                ]

            SWP_NOSIZE = 0x0001
            SWP_NOMOVE = 0x0002
            SWP_NOACTIVATE = 0x0010
            HWND_TOPMOST = wintypes.HWND(-1)
            HWND_NOTOPMOST = wintypes.HWND(-2)
            FLASHW_ALL = 0x00000003
            FLASHW_TIMERNOFG = 0x0000000C

            deadline = time.time() + seconds
            while time.time() < deadline:
                hwnd = user32.FindWindowW(None, title)
                if hwnd:
                    # 先压到最上层（不需要前台权限），再还给普通层级，避免永久置顶
                    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE)
                    user32.SetWindowPos(
                        hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
                    )
                    if user32.GetForegroundWindow() != hwnd:
                        user32.SetForegroundWindow(hwnd)
                    info = FLASHWINFO(
                        ctypes.sizeof(FLASHWINFO), hwnd, FLASHW_ALL | FLASHW_TIMERNOFG, 3, 0
                    )
                    user32.FlashWindowEx(ctypes.byref(info))
                    return
                time.sleep(0.1)
        except Exception:
            # 置顶只是锦上添花，失败也不影响选目录
            pass

    threading.Thread(target=worker, daemon=True).start()


def _pick_com(initial: str = "") -> list[str]:
    import ctypes
    from ctypes import POINTER, byref, c_ubyte, c_void_p, wintypes

    ole32 = ctypes.OleDLL("ole32")
    user32 = ctypes.WinDLL("user32")
    HRESULT = ctypes.c_long

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", c_ubyte * 8),
        ]

    def guid(text: str) -> GUID:
        value = GUID()
        ole32.CLSIDFromString(wintypes.LPCWSTR(text), byref(value))
        return value

    def method(ptr, index: int, *argtypes):
        vtable = ctypes.cast(ptr, POINTER(POINTER(c_void_p))).contents
        proto = ctypes.WINFUNCTYPE(HRESULT, c_void_p, *argtypes)
        return proto(vtable[index])

    ole32.CoInitializeEx.argtypes = [c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = HRESULT
    ole32.CoCreateInstance.argtypes = [
        POINTER(GUID),
        c_void_p,
        wintypes.DWORD,
        POINTER(GUID),
        POINTER(c_void_p),
    ]
    ole32.CoCreateInstance.restype = HRESULT

    initialized = False
    hr = ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
    if hr in (0, 1):
        initialized = True
    elif hr == -2147417850:  # RPC_E_CHANGED_MODE：别的线程已经用了 MTA，照样能弹
        ole32.CoInitializeEx(None, 0x0)

    dialog = c_void_p()
    try:
        clsid = guid(CLSID_FILE_OPEN_DIALOG)
        iid = guid(IID_IFILE_OPEN_DIALOG)
        hr = ole32.CoCreateInstance(byref(clsid), None, 1, byref(iid), byref(dialog))
        if hr < 0:
            raise OSError(f"创建对话框失败：0x{hr & 0xFFFFFFFF:08X}")

        get_options = method(dialog, 10, POINTER(wintypes.DWORD))
        options = wintypes.DWORD()
        get_options(dialog, byref(options))
        options.value |= (
            FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_ALLOWMULTISELECT
        )
        method(dialog, 9, wintypes.DWORD)(dialog, options)

        title = ctypes.c_wchar_p("选择要加入图库的文件夹（可多选）")
        method(dialog, 17, wintypes.LPCWSTR)(dialog, title)
        ok_label = ctypes.c_wchar_p("加入图库")
        method(dialog, 18, wintypes.LPCWSTR)(dialog, ok_label)

        _bring_to_front("选择要加入图库的文件夹（可多选）")

        owner = user32.GetForegroundWindow()
        hr = method(dialog, 3, wintypes.HWND)(dialog, owner)
        if hr == ERROR_CANCELLED or hr < 0:
            if hr == ERROR_CANCELLED:
                return []
            raise OSError(f"对话框返回错误：0x{hr & 0xFFFFFFFF:08X}")

        results = c_void_p()
        hr = method(dialog, 27, POINTER(c_void_p))(dialog, byref(results))
        if hr < 0 or not results:
            return []

        paths: list[str] = []
        try:
            get_count = method(results, 7, POINTER(wintypes.DWORD))
            count = wintypes.DWORD()
            get_count(results, byref(count))
            get_item = method(results, 8, wintypes.DWORD, POINTER(c_void_p))
            for index in range(count.value):
                item = c_void_p()
                if get_item(results, index, byref(item)) < 0 or not item:
                    continue
                try:
                    name = wintypes.LPWSTR()
                    get_name = method(item, 5, wintypes.DWORD, POINTER(wintypes.LPWSTR))
                    if get_name(item, SIGDN_FILESYSPATH, byref(name)) >= 0 and name.value:
                        paths.append(os.path.normpath(name.value))
                finally:
                    method(item, 2)(item)
        finally:
            method(results, 2)(results)
        return paths
    finally:
        if dialog:
            try:
                method(dialog, 2)(dialog)
            except Exception:
                pass
        if initialized:
            ole32.CoUninitialize()


def main() -> int:
    initial = sys.argv[1] if len(sys.argv) > 1 else ""
    if not os.path.isdir(initial):
        initial = ""

    # 调试用：不弹框，直接返回指定结果（自动化测试用）
    fake = os.environ.get("LG_PICK_FAKE", "")
    if fake:
        if fake == "cancel":
            print(json.dumps({"ok": False, "canceled": True}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": True, "paths": [os.path.normpath(fake)]}, ensure_ascii=False))
        return 0

    try:
        paths = _pick_com(initial)
    except Exception as exc:  # noqa: BLE001
        # 出错就如实上报，前端会退回「面板内浏览」，不再弹第二个框
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 0

    if not paths:
        print(json.dumps({"ok": False, "canceled": True}, ensure_ascii=False))
    else:
        print(json.dumps({"ok": True, "paths": paths}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

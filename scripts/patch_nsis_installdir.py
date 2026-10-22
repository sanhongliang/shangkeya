# -*- coding: utf-8 -*-
import pathlib

p = pathlib.Path(r"E:\上课鸭豆包\shangkeya\src-tauri\target\release\nsis\x64\installer.nsi")
s = p.read_text(encoding="utf-8-sig")

print("hook_injected=", "NSIS_HOOK_POSTINSTALL" in s)
print("installmode=", "perMachine" if '!define INSTALLMODE "perMachine"' in s else "currentUser")

# 将 perMachine 分支的默认安装目录改为 D:\Program Files\上课鸭
repl = [
    ('StrCpy $INSTDIR "$PROGRAMFILES64\\${PRODUCTNAME}"', 'StrCpy $INSTDIR "D:\\Program Files\\${PRODUCTNAME}"'),
    ('StrCpy $INSTDIR "$PROGRAMFILES\\${PRODUCTNAME}"',   'StrCpy $INSTDIR "D:\\Program Files\\${PRODUCTNAME}"'),
    ('StrCpy $INSTDIR "$LOCALAPPDATA\\${PRODUCTNAME}"',   'StrCpy $INSTDIR "D:\\Program Files\\${PRODUCTNAME}"'),
]
changed = 0
for old, new in repl:
    if old in s:
        s = s.replace(old, new)
        changed += 1
p.write_text(s, encoding="utf-8-sig")
print("installdir_patched_count=", changed)

# 打印最终结果
for ln in s.splitlines():
    if "StrCpy $INSTDIR" in ln:
        print("LINE:", ln)

; 上课鸭 NSIS 安装钩子
; 应用数据目录（appDirectoriesOverride: ./app-data）位于安装目录下，
; 安装完成后创建 app-data 目录并授予 Users 完全控制权限，保证运行时（普通用户权限）可写入 localStorage / 课件缓存等数据。
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\app-data"
  nsExec::ExecToLog 'icacls "$INSTDIR\app-data" /grant Users:(OI)(CI)F /T /Q'
!macroend

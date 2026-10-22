$ErrorActionPreference = 'Stop'
Set-Location 'E:\上课鸭豆包\shangkeya'
npm install -D @tauri-apps/cli@^2 2>&1 | Out-File 'E:\上课鸭豆包\shangkeya\npm-tauri-install.log' -Encoding utf8
npm install @tauri-apps/api@^2 @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-fs@^2 2>&1 | Add-Content 'E:\上课鸭豆包\shangkeya\npm-tauri-install.log' -Encoding utf8
Write-Output "npm tauri deps done"

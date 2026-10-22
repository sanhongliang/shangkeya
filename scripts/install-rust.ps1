$ErrorActionPreference = 'Continue'
$log = 'E:\上课鸭豆包\shangkeya\rust-install.log'
"=== rustup install start $(Get-Date) ===" | Out-File $log -Encoding utf8
$exe = Join-Path $env:TEMP 'rustup-init.exe'
try {
  "downloading rustup-init..." | Add-Content $log -Encoding utf8
  Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $exe -UseBasicParsing
  "downloaded $(Get-Item $exe).Length bytes" | Add-Content $log -Encoding utf8
} catch {
  "download failed: $_" | Add-Content $log -Encoding utf8
  exit 1
}
"installing rust stable (minimal)..." | Add-Content $log -Encoding utf8
$p = Start-Process $exe -ArgumentList '-y','--profile','minimal','--default-toolchain','stable' -Wait -PassThru -NoNewWindow
"rustup exit code: $($p.ExitCode)" | Add-Content $log -Encoding utf8
# cargo 环境变量持久化
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) {
  $cur = [Environment]::GetEnvironmentVariable('Path','User')
  if ($cur -notlike "*$cargoBin*") { [Environment]::SetEnvironmentVariable('Path', "$cur;$cargoBin", 'User') }
}
"=== done $(Get-Date) ===" | Add-Content $log -Encoding utf8

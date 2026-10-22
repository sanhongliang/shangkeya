$ErrorActionPreference = 'Continue'
$log = 'E:\上课鸭豆包\shangkeya\vs-install.log'
"=== VS Build Tools install start $(Get-Date) ===" | Out-File $log -Encoding utf8
$exe = Join-Path $env:TEMP 'vs_BuildTools.exe'
try {
  "downloading bootstrapper..." | Add-Content $log -Encoding utf8
  Invoke-WebRequest 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $exe -UseBasicParsing
  "bootstrapper downloaded $(Get-Item $exe).Length bytes" | Add-Content $log -Encoding utf8
} catch {
  "download failed: $_" | Add-Content $log -Encoding utf8
  exit 1
}
"starting silent install (VCTools workload)..." | Add-Content $log -Encoding utf8
$p = Start-Process $exe -ArgumentList '--quiet','--wait','--norestart','--nocache','--add','Microsoft.VisualStudio.Workload.VCTools','--includeRecommended' -PassThru -Wait -NoNewWindow
"installer exit code: $($p.ExitCode)" | Add-Content $log -Encoding utf8
"=== done $(Get-Date) ===" | Add-Content $log -Encoding utf8

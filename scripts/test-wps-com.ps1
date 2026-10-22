$ErrorActionPreference = 'Stop'
$src = 'E:\上课鸭豆包\shangkeya\ppt-test\test-ppt.pptx'
$out = 'E:\上课鸭豆包\shangkeya\ppt-test\test-ppt.pdf'
Remove-Item $out -Force -ErrorAction SilentlyContinue
$log = @()
$app = $null; $doc = $null
try {
  $app = New-Object -ComObject KWPP.Application
  $log += 'COM created'
  $app.Visible = $false
  $log += 'visible set'
  try { $doc = $app.Presentations.Open($src, $true, $false, $false); $log += 'open4 ok' }
  catch { $log += "open4 fail: $($_.Exception.Message)" }
  if (-not $doc) {
    try { $doc = $app.Presentations.Open($src); $log += 'open1 ok' }
    catch { $log += "open1 fail: $($_.Exception.Message)" }
  }
  if ($doc) { $log += "slides=$($doc.Slides.Count)" }
  if ($doc) {
    try { $doc.SaveAs($out, 32); $log += "saveas32 ok exists=$(Test-Path $out)" }
    catch { $log += "saveas32 fail: $($_.Exception.Message)" }
  }
} catch {
  $log += "outer fail: $($_.Exception.Message)"
} finally {
  try { if ($doc) { $doc.Close() } } catch {}
  try { if ($app) { $app.Quit() } } catch {}
}
[IO.File]::WriteAllText('E:\上课鸭豆包\shangkeya\ppt-test\conv-log.txt', ($log -join "`n"), (New-Object System.Text.UTF8Encoding $false))

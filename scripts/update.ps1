# update.ps1 - Tự động tải và cập nhật Shopee Extension từ GitHub Release
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Shopee to Sheet - Tự động cập nhật"

$repo = "lequanghuy19204/shopee-order-extension"
Write-Host "===================================================================" -ForegroundColor Green
Write-Host "     🛒 SHOPEE TO SHEET - TỰ ĐỘNG CẬP NHẬT TỪ GITHUB RELEASES" -ForegroundColor Green
Write-Host "===================================================================" -ForegroundColor Green
Write-Host ""

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host "[*] Đang kiểm tra phiên bản mới nhất từ GitHub..." -ForegroundColor Yellow
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "ShopeeUpdater" }
  $tag = $release.tag_name
  Write-Host "[+] Tìm thấy phiên bản phát hành: $tag" -ForegroundColor Cyan

  $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
  if (-not $asset) {
    throw "Không tìm thấy file zip đính kèm trong bản phát hành $tag"
  }

  $zipUrl = $asset.browser_download_url
  $tmpZip = Join-Path $env:TEMP "shopee-ext-update-$tag.zip"

  Write-Host "[*] Đang tải file cập nhật ($([math]::Round($asset.size / 1024, 1)) KB)..." -ForegroundColor Yellow
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing

  $targetDir = Split-Path -Parent $PSScriptRoot
  Write-Host "[*] Đang giải nén và cập nhật vào: $targetDir" -ForegroundColor Yellow
  Expand-Archive -Path $tmpZip -DestinationPath $targetDir -Force

  Remove-Item -Path $tmpZip -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "===================================================================" -ForegroundColor Green
  Write-Host "  🎉 CẬP NHẬT THÀNH CÔNG LÊN PHIÊN BẢN $tag!" -ForegroundColor Green
  Write-Host "  👉 Vui lòng mở chrome://extensions và bấm nút Reload (🔄) để áp dụng." -ForegroundColor White
  Write-Host "===================================================================" -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "[!] Lỗi cập nhật: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Bấm phím bất kỳ để thoát..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

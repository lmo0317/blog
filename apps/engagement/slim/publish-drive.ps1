# Test only: publishes a slim build (dist-slim/node) to the Google Drive folder NeighborMate-Test-Updates through
# rclone (remote 'gdrive', scope drive.file). latest.yml keeps its Drive file ID, so the feed link built into the app
# never changes; its path becomes the installer's direct download link.
#   powershell -File slim/publish-drive.ps1 1.0.46
param([string]$Version)
$ErrorActionPreference = 'Stop'
$r = (Get-Command rclone -ErrorAction SilentlyContinue).Source; if (-not $r) { $r = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter rclone.exe | Select-Object -First 1).FullName }
$dist = Join-Path $PSScriptRoot '..\dist-slim\node'
$exe = "NeighborMate-SlimTest-$Version.exe"
& $r copyto "$dist\$exe" "gdrive:NeighborMate-Test-Updates/$exe" 2>$null
$id = (& $r lsjson gdrive:NeighborMate-Test-Updates 2>$null | ConvertFrom-Json | Where-Object Name -eq $exe).ID
$url = "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t"
$yml = (Get-Content "$dist\latest.yml" -Raw) -replace "(?m)^path: .*$", "path: '$url'"
$tmp = Join-Path $dist 'latest.drive.yml'
Set-Content $tmp $yml -NoNewline
& $r copyto $tmp gdrive:NeighborMate-Test-Updates/latest.yml 2>$null
& $r lsjson gdrive:NeighborMate-Test-Updates 2>$null | ConvertFrom-Json | Select-Object Name, ID, Size
"installer: $url"

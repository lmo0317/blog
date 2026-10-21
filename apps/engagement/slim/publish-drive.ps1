# Publishes an 이웃메이트 라이트 build (dist-slim/node) to the Google Drive folder NeighborMate-Lite through
# rclone (remote 'gdrive', scope drive.file). latest.yml keeps its Drive file ID, so the feed link built into the app
# never changes; its path becomes the installer's direct download link.
#   powershell -File slim/publish-drive.ps1 1.0.46
param([string]$Version)
$ErrorActionPreference = 'Stop'
# -q: rclone prints notices on stderr, which Windows PowerShell would treat as a failure.
$r = (Get-Command rclone -ErrorAction SilentlyContinue).Source; if (-not $r) { $r = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter rclone.exe | Select-Object -First 1).FullName }
$dist = Join-Path $PSScriptRoot '..\dist-slim\node'
$exe = "NeighborMate-Lite-Setup-$Version.exe"
& $r -q copyto "$dist\$exe" "gdrive:NeighborMate-Lite/$exe"
$id = ((& $r -q lsjson gdrive:NeighborMate-Lite | ConvertFrom-Json) | Where-Object Name -eq $exe).ID
if (-not $id) { throw "$exe did not reach Drive" }
$url = "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t"
$yml = (Get-Content "$dist\latest.yml" -Raw) -replace "(?m)^path: .*$", "path: '$url'"
$tmp = Join-Path $dist 'latest.drive.yml'
Set-Content $tmp $yml -NoNewline
& $r -q copyto $tmp gdrive:NeighborMate-Lite/latest.yml
(& $r -q lsjson gdrive:NeighborMate-Lite | ConvertFrom-Json) | Select-Object Name, ID, Size
"installer: $url"

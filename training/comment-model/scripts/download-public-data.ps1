$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetDir = Join-Path (Split-Path -Parent $scriptDir) 'data\raw\public'
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$files = @(
  @{ Dataset = 'heegyu/open-korean-instructions'; File = 'OIG-smallchip2-ko.json'; License = 'MIT' },
  @{ Dataset = 'heegyu/open-korean-instructions'; File = 'koalpaca.json'; License = 'MIT' },
  @{ Dataset = 'heegyu/open-korean-instructions'; File = 'korquad-chat.json'; License = 'MIT' },
  @{ Dataset = 'heegyu/open-korean-instructions'; File = 'sharegpt_deepl_ko.json'; License = 'MIT' },
  @{ Dataset = 'nlpai-lab/kullm-v2'; File = 'kullm-v2.jsonl'; License = 'Apache-2.0' },
  @{ Dataset = 'changpt/ko-lima-vicuna'; File = 'ko_lima_vicuna.json'; License = 'CC-BY-2.0'; Revision = 'main' },
  @{ Dataset = 'mkd-chanwoo/keural-conversation-ko'; File = 'data/train-00000-of-00001.parquet'; License = 'CC-BY-4.0'; Revision = 'fcb975654651d55ff1a642455d620045b6d3f741' }
)

$results = foreach ($item in $files) {
  $datasetDir = Join-Path $targetDir ($item.Dataset -replace '/', '__')
  New-Item -ItemType Directory -Path $datasetDir -Force | Out-Null
  $destination = Join-Path $datasetDir (Split-Path -Leaf $item.File)
  $revision = if ($item.Revision) { $item.Revision } else { 'main' }
  $url = "https://huggingface.co/datasets/$($item.Dataset)/resolve/$revision/$($item.File)?download=true"
  if (-not (Test-Path -LiteralPath $destination)) {
    Write-Host "Downloading $($item.Dataset)/$($item.File)"
    Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
  }
  $fileInfo = Get-Item -LiteralPath $destination
  [pscustomobject]@{
    dataset = $item.Dataset
    file = $item.File
    license = $item.License
    bytes = $fileInfo.Length
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$reportDir = Join-Path (Split-Path -Parent $scriptDir) 'data\reports'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDir 'public-downloads.json') -Encoding utf8
$results | Format-Table -AutoSize

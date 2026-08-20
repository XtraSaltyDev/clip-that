param([string]$Version = '')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') { throw 'Unsigned Windows previews must be prepared on Windows x64.' }
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
  throw 'Only the Windows x64 experimental preview lane is configured.'
}

$packageVersion = (node -p "require('./package.json').version").Trim()
if (-not $Version) { throw 'Pass the exact package version with -Version <version>.' }
if ($Version -ne $packageVersion) {
  throw "package.json is version $packageVersion, not $Version"
}
foreach ($name in @('CSC_LINK', 'WIN_CSC_LINK', 'CSC_KEY_PASSWORD')) {
  if (Test-Path "Env:$name") { throw "$name must be unset for the unsigned Windows preview lane." }
}
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Host "Preparing ClipThat $packageVersion unsigned experimental Windows preview."
Write-Host 'This command does not sign, tag, publish, or enable auto-update.'

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Source gates failed.' }

bash scripts/build-ffmpeg-win.sh
if ($LASTEXITCODE -ne 0) { throw 'Audited Windows FFmpeg build failed.' }

npx electron-builder --win --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }

$sourceBundle = "dist/ClipThat-$packageVersion-windows-third-party-sources.tar.gz"
Copy-Item -LiteralPath 'build/vendor/ffmpeg/windows-x64/ClipThat-windows-third-party-sources.tar.gz' -Destination $sourceBundle -Force
$notice = "dist/ClipThat-$packageVersion-WINDOWS-UNSIGNED-PREVIEW.txt"
[IO.File]::WriteAllText(
  $notice,
  "ClipThat $packageVersion for Windows x64 is an unsigned experimental preview.`nWindows may warn before launch. It is not a supported or signed release.`nUse manual downloads for updates; production Windows auto-update is disabled.`n",
  [Text.Encoding]::UTF8
)
$artifacts = @(
  "dist/ClipThat-$packageVersion-unsigned-experimental-preview-x64-setup.exe",
  "dist/ClipThat-$packageVersion-unsigned-experimental-preview-x64-portable.exe",
  "dist/ClipThat-$packageVersion-unsigned-experimental-preview-x64.zip",
  $sourceBundle,
  $notice
)
foreach ($artifact in $artifacts) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Missing preview artifact: $artifact" }
}
foreach ($executable in $artifacts[0..1]) {
  if ((Get-AuthenticodeSignature -LiteralPath $executable).Status -ne 'NotSigned') {
    throw "Unsigned preview lane unexpectedly produced a signed executable: $executable"
  }
}

$extractDir = Join-Path $env:TEMP "clipthat-preview-$packageVersion-$PID"
New-Item -ItemType Directory -Path $extractDir | Out-Null
try {
  Expand-Archive -LiteralPath $artifacts[2] -DestinationPath $extractDir
  $packedExecutable = Get-ChildItem $extractDir -Filter ClipThat.exe -File -Recurse | Select-Object -First 1
  if ($null -eq $packedExecutable) { throw 'Preview ZIP does not contain ClipThat.exe.' }
  if ((Get-AuthenticodeSignature -LiteralPath $packedExecutable.FullName).Status -ne 'NotSigned') {
    throw 'Unsigned preview ZIP unexpectedly contains a signed ClipThat.exe.'
  }
  $resources = Join-Path $packedExecutable.DirectoryName 'resources'
  $ffmpeg = Join-Path $resources 'third-party\ffmpeg\bin\ffmpeg.exe'
  $ffprobe = Join-Path $resources 'third-party\ffmpeg\bin\ffprobe.exe'
  foreach ($tool in @($ffmpeg, $ffprobe)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing bundled media tool: $tool" }
    & $tool -version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Bundled media tool could not run: $tool" }
  }
  $forbidden = Get-ChildItem -Path $extractDir -File -Force -Recurse | Where-Object {
    $_.Name -eq '.env' -or
    $_.Name -like '.env.*' -or
    $_.Extension -in @('.p12', '.pfx', '.mobileprovision', '.provisionprofile') -or
    $_.FullName -match '@ffmpeg-installer' -or
    ($_.Name -eq 'ffmpeg.exe' -and $_.FullName -ne $ffmpeg)
  }
  if (@($forbidden).Count -ne 0) {
    throw 'Preview package contains a forbidden credential, environment, or unaudited FFmpeg file.'
  }
  node scripts/verify-package-secrets.mjs $resources
  if ($LASTEXITCODE -ne 0) { throw 'Package secret scan failed.' }
  node scripts/verify-ocr-assets.mjs --package $resources
  if ($LASTEXITCODE -ne 0) { throw 'Packaged OCR verification failed.' }
  node scripts/verify-js-licenses.mjs --package $resources
  if ($LASTEXITCODE -ne 0) { throw 'Packaged JavaScript license verification failed.' }
  $buildConfiguration = (& $ffmpeg -hide_banner -buildconf 2>&1) -join "`n"
  foreach ($flag in @('--disable-gpl', '--disable-nonfree', '--enable-mediafoundation', '--enable-libvpx', '--enable-libopus')) {
    if ($buildConfiguration -notmatch [regex]::Escape($flag)) { throw "Bundled FFmpeg is missing $flag" }
  }
  if ($buildConfiguration -match '--enable-(gpl|nonfree)' -or $buildConfiguration -match 'build[/\\]vendor|[A-Z]:[/\\]a[/\\]') {
    throw 'Bundled FFmpeg has a forbidden license mode or build-host path.'
  }
  $encoders = (& $ffmpeg -hide_banner -encoders 2>&1) -join "`n"
  foreach ($encoder in @('h264_mf', 'libvpx-vp9', 'libopus', 'gif', 'aac')) {
    if ($encoders -notmatch "\s$([regex]::Escape($encoder))\s") { throw "Bundled FFmpeg is missing $encoder" }
  }
  $smoke = Join-Path $extractDir 'smoke'
  New-Item -ItemType Directory -Path $smoke | Out-Null
  $webm = Join-Path $smoke 'smoke.webm'
  $mp4 = Join-Path $smoke 'smoke.mp4'
  $palette = Join-Path $smoke 'palette.png'
  $gif = Join-Path $smoke 'smoke.gif'
  & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=duration=1:size=320x180:rate=30' -f lavfi -i 'sine=frequency=440:duration=1' -c:v libvpx-vp9 -c:a libopus $webm
  if ($LASTEXITCODE -ne 0) { throw 'WebM smoke encode failed.' }
  & $ffmpeg -hide_banner -loglevel error -y -i $webm -vf 'format=yuv420p' -c:v h264_mf -rate_control quality -quality 70 -scenario archive -hw_encoding 0 -c:a aac -b:a 160k $mp4
  if ($LASTEXITCODE -ne 0) { throw 'MP4 smoke encode failed.' }
  & $ffmpeg -hide_banner -loglevel error -y -i $webm -vf 'fps=15,scale=320:-2,palettegen' $palette
  if ($LASTEXITCODE -ne 0) { throw 'GIF palette smoke encode failed.' }
  & $ffmpeg -hide_banner -loglevel error -y -i $webm -i $palette -lavfi 'fps=15,scale=320:-2[x];[x][1:v]paletteuse' -loop 0 $gif
  if ($LASTEXITCODE -ne 0) { throw 'GIF smoke encode failed.' }
} finally {
  if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
}

$checksumPath = "dist/ClipThat-$packageVersion-windows-SHA256SUMS.txt"
$lines = foreach ($artifact in $artifacts) {
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
  "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($artifact))"
}
[IO.File]::WriteAllText($checksumPath, ($lines -join "`n") + "`n", [Text.Encoding]::ASCII)
Write-Host "Prepared and verified unsigned preview artifacts in dist/. No release was published."

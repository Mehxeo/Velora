param([ValidateSet('x64','arm64')][string]$Architecture)
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$out = Join-Path $root 'store-output'
$stage = Join-Path $env:RUNNER_TEMP 'velora-msix-stage'
New-Item -ItemType Directory -Force $out,$stage | Out-Null
Expand-Archive -Path "store-input/Velora-Store-payload-$Architecture.zip" -DestinationPath "$env:RUNNER_TEMP/velora-store-unpack"
$folder = if ($Architecture -eq 'arm64') {'win-arm64-unpacked'} else {'win-unpacked'}
Move-Item "$env:RUNNER_TEMP/velora-store-unpack/$folder" "$stage/app"
(Get-Content scripts/store/AppxManifest.xml -Raw).Replace('ARCHITECTURE',$Architecture) | Set-Content "$stage/AppxManifest.xml" -Encoding utf8
New-Item -ItemType Directory "$stage/Assets" | Out-Null
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile("$stage/app/resources/resources/icon-release.png")
foreach ($asset in @(@('StoreLogo',50,50),@('Square150x150Logo',150,150),@('Square44x44Logo',44,44),@('Wide310x150Logo',310,150))) {
 $bitmap = [System.Drawing.Bitmap]::new([int]$asset[1],[int]$asset[2]); $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
 $graphics.Clear([System.Drawing.Color]::FromArgb(15,17,21)); $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
 $side=[Math]::Min([int]$asset[1],[int]$asset[2]); $graphics.DrawImage($source,([int]$asset[1]-$side)/2,0,$side,$side)
 $bitmap.Save("$stage/Assets/$($asset[0]).png",[System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose()
}
$source.Dispose()
$kit = Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin' -Directory | Where-Object {$_.Name -match '^10\.'} | Sort-Object Name -Descending | Select-Object -First 1
$tools = Join-Path $kit.FullName 'x64'
$unsigned = "$out/Velora-Store-3.0.8201.0-$Architecture.msix"
& "$tools/makeappx.exe" pack /d $stage /p $unsigned /o
if ($LASTEXITCODE -ne 0) {throw 'MakeAppx failed'}
# Only this copy gets a development certificate, only in this disposable runner.
$test = "$env:RUNNER_TEMP/Velora-test.msix"; Copy-Item $unsigned $test
$cert=New-SelfSignedCertificate -Type Custom -Subject 'CN=695D63C2-5C96-4278-81F0-E8F32E3219E6' -KeyUsage DigitalSignature -FriendlyName 'Velora ephemeral CI package test' -CertStoreLocation Cert:/CurrentUser/My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}') -NotAfter (Get-Date).AddDays(1)
$password=ConvertTo-SecureString ([guid]::NewGuid().ToString()) -AsPlainText -Force
$pfx="$env:RUNNER_TEMP/velora-test.pfx"; Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password | Out-Null
$public="$env:RUNNER_TEMP/velora-test.cer"; Export-Certificate -Cert $cert -FilePath $public | Out-Null
Import-Certificate -FilePath $public -CertStoreLocation Cert:/LocalMachine/TrustedPeople | Out-Null
& "$tools/signtool.exe" sign /fd SHA256 /sha1 $cert.Thumbprint $test
if ($LASTEXITCODE -ne 0) {throw 'Test-only signature failed'}
Add-AppxPackage -Path $test
$package=Get-AppxPackage -Name 'VelorabyUtsavDas.VeloraAIWorkspace'
if (!$package -or $package.Version -ne '3.0.8201.0') {throw 'MSIX installation identity failed'}
$exe=Join-Path $package.InstallLocation 'app/Velora.exe'
$env:VELORA_EXPECT_STORE='1'
node scripts/acceptance/verify-packaged-combined.cjs $exe "$out/packaged-ui.json"
if ($LASTEXITCODE -ne 0) {throw 'Installed MSIX renderer acceptance failed'}
@{architecture=$Architecture;version=$package.Version;family=$package.PackageFamilyName;sourceCommit=(Get-Content scripts/store/payloads.json | ConvertFrom-Json).sourceCommit;sha256=(Get-FileHash $unsigned -Algorithm SHA256).Hash;testSignature='Ephemeral CI certificate only; upload package remains unsigned for Microsoft signing'} | ConvertTo-Json | Set-Content "$out/acceptance.json"
Remove-AppxPackage $package.PackageFullName
Remove-Item "Cert:/LocalMachine/TrustedPeople/$($cert.Thumbprint)","Cert:/CurrentUser/My/$($cert.Thumbprint)",$pfx,$public,$test

$ErrorActionPreference='Stop'
$Architecture='x64'
$out=Join-Path (Get-Location).Path 'store-output'
New-Item -ItemType Directory -Force $out | Out-Null
$unsigned=Join-Path (Get-Location).Path 'existing-store/Velora-Store-3.0.8201.0-x64.msix'
$kit=Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin' -Directory | Where-Object {$_.Name -match '^10\.'} | Sort-Object Name -Descending | Select-Object -First 1
$tools=Join-Path $kit.FullName 'x64'
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

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DeploymentDirectory,
  [switch]$Rotate
)

$ErrorActionPreference = "Stop"
$deployment = [IO.Path]::GetFullPath($DeploymentDirectory)
$secrets = [IO.Path]::GetFullPath((Join-Path $deployment "secrets"))
$prefix = $deployment.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $secrets.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Secret destination must remain below DeploymentDirectory"
}
New-Item -ItemType Directory -Force -Path $secrets | Out-Null
$generator = (Resolve-Path (Join-Path $PSScriptRoot "generate-development-secrets.mjs")).Path
$generatorArgs = @($generator, "--directory", $secrets)
if ($Rotate) { $generatorArgs += "--rotate" }
& node @generatorArgs
if ($LASTEXITCODE -ne 0) { throw "Secret generation failed with exit code $LASTEXITCODE" }

if ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $secrets /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to apply restrictive secret-directory ACL" }
} else {
  & chmod 700 $secrets
  Get-ChildItem -LiteralPath $secrets -File | ForEach-Object { & chmod 600 $_.FullName }
}
Write-Output "Secret files initialized below $secrets; values were not printed."

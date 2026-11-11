<#
.SYNOPSIS
    Single-pool baseline AVD target-state designer (C11 + C19 + optional C27 -> C14 v1 + approval).
.DESCRIPTION
    Personal project, not for production. Provided as is, without warranty of any kind (MIT License).
    Not affiliated with, endorsed by or supported by the author's employer, Liquidware or Microsoft.

    Reads pseudonymous C11 (avd-current-state-facts/v1), C19 (avd-estate-intake/v1), and optional
    C27 (avd-measured-usage/v1) JSON files, merges all source host pools into a single baseline
    Pooled Desktop pool (tp-01, capped at 180 session hosts), and writes manifest.json
    (avd-target-state/v1) and manifest.approval.json (avd-target-approval/v1).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentStatePath,

    [Parameter(Mandatory = $true)]
    [string]$IntakePath,

    [Parameter(Mandatory = $false)]
    [string]$MeasuredUsagePath = '',

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $false)]
    [string]$GeneratedUtc = '2026-11-11T12:00:00Z'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-NoSensitiveLeak {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RawText,
        [Parameter(Mandatory = $true)]
        [string]$ContextName
    )
    if ($RawText -match '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b') {
        throw "Redaction guard refused ${ContextName}: raw UUID/GUID detected."
    }
    if ($RawText -match '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b') {
        throw "Redaction guard refused ${ContextName}: email/UPN detected."
    }
    if ($RawText -match '\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b') {
        throw "Redaction guard refused ${ContextName}: IPv4 address detected."
    }
    if ($RawText -match '\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+') {
        throw "Redaction guard refused ${ContextName}: UNC path detected."
    }
}

function ConvertTo-WindowsTimezoneName {
    param([string]$TimeZoneId)
    if ([string]::IsNullOrWhiteSpace($TimeZoneId)) {
        return 'Central Standard Time'
    }
    $map = @{
        'America/Chicago'     = 'Central Standard Time'
        'America/New_York'    = 'Eastern Standard Time'
        'America/Los_Angeles' = 'Pacific Standard Time'
        'America/Denver'      = 'Mountain Standard Time'
        'Europe/London'       = 'GMT Standard Time'
        'UTC'                 = 'UTC'
    }
    if ($map.ContainsKey($TimeZoneId)) {
        return $map[$TimeZoneId]
    }
    $cleaned = ($TimeZoneId -replace '/', ' ') -replace '_', ' '
    if ($cleaned -match '^[A-Za-z][A-Za-z .()+-]{1,63}$') {
        return $cleaned
    }
    return 'Central Standard Time'
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

$c11Raw = Get-Content -LiteralPath $CurrentStatePath -Raw -Encoding UTF8
$intakeRaw = Get-Content -LiteralPath $IntakePath -Raw -Encoding UTF8
Test-NoSensitiveLeak -RawText $c11Raw -ContextName 'C11 current-state-facts'
Test-NoSensitiveLeak -RawText $intakeRaw -ContextName 'C19 intake'

$c11 = $c11Raw | ConvertFrom-Json
$intake = $intakeRaw | ConvertFrom-Json

if ($c11.schema -ne 'avd-current-state-facts/v1') {
    throw "Invalid C11 input: expected schema 'avd-current-state-facts/v1'."
}
if ($intake.schema -ne 'avd-estate-intake/v1') {
    throw "Invalid C19 input: expected schema 'avd-estate-intake/v1'."
}

$estateId = [string]$c11.estate
if ([string]::IsNullOrWhiteSpace($estateId) -or ($estateId -notmatch '^est-[0-9a-f]{8}$')) {
    throw "Invalid or missing estate pseudonym '$estateId'."
}
if ($intake.PSObject.Properties['estate'] -and $intake.estate -and ([string]$intake.estate -ne $estateId)) {
    throw "Estate mismatch between C11 ($estateId) and C19 ($($intake.estate))."
}

$measured = $null
if (-not [string]::IsNullOrWhiteSpace($MeasuredUsagePath) -and (Test-Path -LiteralPath $MeasuredUsagePath)) {
    $c27Raw = Get-Content -LiteralPath $MeasuredUsagePath -Raw -Encoding UTF8
    Test-NoSensitiveLeak -RawText $c27Raw -ContextName 'C27 measured-usage'
    $measured = $c27Raw | ConvertFrom-Json
    if ($measured.schema -ne 'avd-measured-usage/v1') {
        throw "Invalid C27 input: expected schema 'avd-measured-usage/v1'."
    }
    if ([string]$measured.estate -ne $estateId) {
        throw "Estate mismatch between C11 ($estateId) and C27 ($($measured.estate))."
    }
}

$pinsPath = Join-Path $PSScriptRoot 'contracts/PINS.json'
$brainCommit = '36ccf1238cae450f10cac693620de89dc03b555e'
$rendererCommit = '2c808222df9874a7fc26902594d800a2da8900e3'
$factRegVersion = 1
if (Test-Path -LiteralPath $pinsPath) {
    $pinsObj = Get-Content -LiteralPath $pinsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pinsObj.brainCommit) { $brainCommit = [string]$pinsObj.brainCommit }
    if ($pinsObj.landingZoneCommit) { $rendererCommit = [string]$pinsObj.landingZoneCommit }
    if ($pinsObj.factRegisterVersion) { $factRegVersion = [int]$pinsObj.factRegisterVersion }
}

$sourcePools = @()
if ($c11.PSObject.Properties['hostPools'] -and $c11.hostPools) {
    $sourcePools = @($c11.hostPools)
}
elseif ($c11.PSObject.Properties['avd'] -and $c11.avd -and $c11.avd.PSObject.Properties['hostPools']) {
    $sourcePools = @($c11.avd.hostPools)
}

$replaces = New-Object System.Collections.Generic.List[string]
$totalUsersFromPools = 0
$hadPersonal = $false
$hadRemoteApp = $false

foreach ($sp in $sourcePools) {
    $spId = ''
    if ($sp.PSObject.Properties['id']) { $spId = [string]$sp.id }
    elseif ($sp.PSObject.Properties['poolId']) { $spId = [string]$sp.poolId }
    if ($spId -match '^hp-[0-9a-f]{8}$' -and (-not $replaces.Contains($spId))) {
        $replaces.Add($spId)
    }
    $pType = 'Pooled'
    if ($sp.PSObject.Properties['type'] -and $sp.type) { $pType = [string]$sp.type }
    elseif ($sp.PSObject.Properties['poolKind'] -and $sp.poolKind) { $pType = [string]$sp.poolKind }
    if ($pType -eq 'Personal') { $hadPersonal = $true }

    $agType = 'Desktop'
    if ($sp.PSObject.Properties['preferredAppGroupType'] -and $sp.preferredAppGroupType) { $agType = [string]$sp.preferredAppGroupType }
    elseif ($sp.PSObject.Properties['deliveryKind'] -and $sp.deliveryKind) { $agType = [string]$sp.deliveryKind }
    if ($agType -eq 'RemoteApp' -or $agType -eq 'RailApplications') { $hadRemoteApp = $true }

    $uVal = 0
    if ($sp.PSObject.Properties['assignedUsers'] -and ($null -ne $sp.assignedUsers)) { $uVal = [int]$sp.assignedUsers }
    elseif ($sp.PSObject.Properties['assignedUserCount'] -and ($null -ne $sp.assignedUserCount)) { $uVal = [int]$sp.assignedUserCount }
    elseif ($sp.PSObject.Properties['sessionHosts'] -and ($null -ne $sp.sessionHosts)) { $uVal = [int]$sp.sessionHosts }
    $totalUsersFromPools += $uVal
}

$boundaryNotices = New-Object System.Collections.Generic.List[string]
if ($sourcePools.Count -gt 1) {
    $boundaryNotices.Add("Merged $($sourcePools.Count) source host pools into single baseline pool tp-01.")
}
if ($hadPersonal -or $hadRemoteApp) {
    $boundaryNotices.Add("Flattened Personal or RemoteApp source pools into Pooled Desktop baseline pool tp-01.")
}

$gatePassed = $false
$measuredGroups = @()
if ($null -ne $measured -and $measured.PSObject.Properties['groups'] -and $measured.groups) {
    $measuredGroups = @($measured.groups)
    if ($measured.PSObject.Properties['measurementGate'] -and $measured.measurementGate) {
        $mg = $measured.measurementGate
        if ([bool]$mg.passed -and ([int]$mg.daysObserved -ge 28) -and ([double]$mg.coveragePercent -ge 80.0) -and ($measuredGroups.Count -gt 0)) {
            $gatePassed = $true
        }
    }
}

$totalUsers = [Math]::Max(5, $totalUsersFromPools)
$peakConcurrent = [Math]::Max(1, [int][Math]::Round($totalUsers * 0.80))
$cpuP95 = $null
$memP95 = $null
$profileP95GiB = 30.0

if ($measuredGroups.Count -gt 0) {
    $grpUsers = 0
    $grpPeak = 0
    foreach ($g in $measuredGroups) {
        $grpUsers += [int]$g.userCount
        $grpPeak += [int]$g.peakConcurrency
    }
    if ($grpUsers -gt $totalUsers) {
        $totalUsers = [Math]::Max(5, $grpUsers)
    }
    if ($grpPeak -gt 0) {
        $peakConcurrent = [Math]::Min(999, $grpPeak)
    }
    if ($gatePassed) {
        $cpuP95 = 0.0
        $memP95 = 0.0
        $profileP95GiB = 0.0
        foreach ($g in $measuredGroups) {
            if ([double]$g.cpuPerUserCores.p95 -gt $cpuP95) { $cpuP95 = [double]$g.cpuPerUserCores.p95 }
            if ([double]$g.memoryPerUserGiB.p95 -gt $memP95) { $memP95 = [double]$g.memoryPerUserGiB.p95 }
            if ([double]$g.profileSizeGiB.p95 -gt $profileP95GiB) { $profileP95GiB = [double]$g.profileSizeGiB.p95 }
        }
    }
}
$peakConcurrent = [Math]::Min(999, [Math]::Max(1, $peakConcurrent))

$tier = 'medium'
if ($null -ne $cpuP95 -and $null -ne $memP95) {
    if ($cpuP95 -le 0.65 -and $memP95 -le 3.5) { $tier = 'light' }
    elseif ($cpuP95 -gt 1.2 -or $memP95 -gt 6.0) { $tier = 'heavy' }
}

$usersPerVcpuMap = @{ 'light' = 6; 'medium' = 4; 'heavy' = 2; 'power' = 1 }
$vmSize = 'Standard_D8s_v5'
$vcpu = 8
$memGiB = 32
$vmRate = 280.32
if ($null -ne $cpuP95 -and $null -ne $memP95 -and $cpuP95 -gt 0 -and (($memP95 / $cpuP95) -gt 4.5)) {
    $vmSize = 'Standard_E8as_v5'
    $memGiB = 64
    $vmRate = 353.32
}

$guidanceCap = [Math]::Max(1, $vcpu * [int]$usersPerVcpuMap[$tier])
$maxSessions = $guidanceCap
$boundBy = 'guidance'

if ($gatePassed -and ($null -ne $cpuP95) -and ($null -ne $memP95)) {
    $cpuCap = [Math]::Max(1, [int][Math]::Floor(($vcpu * 0.80) / $cpuP95))
    $minMemFloor = 1.5
    if ($vmSize -eq 'Standard_E8as_v5') { $minMemFloor = 1.0 }
    $effMem = [Math]::Max($memP95, $minMemFloor)
    $memCap = [Math]::Max(1, [int][Math]::Floor(($memGiB * 0.80) / $effMem))
    $maxSessions = [Math]::Max(1, [Math]::Min($cpuCap, [Math]::Min($memCap, $guidanceCap)))
    if ($cpuCap -le $memCap -and $cpuCap -le $guidanceCap) { $boundBy = 'cpu' }
    elseif ($memCap -le $cpuCap -and $memCap -le $guidanceCap) { $boundBy = 'memory' }
}

$baseHosts = [int][Math]::Ceiling($peakConcurrent / [double][Math]::Max(1, $maxSessions))
$stormHeadroom = [Math]::Max(1, [int][Math]::Ceiling($baseHosts * 0.10))
$rawHosts = [Math]::Max(2, $baseHosts + $stormHeadroom)
$cappedHosts = [Math]::Min(180, $rawHosts)
if ($rawHosts -gt 180) {
    $boundaryNotices.Add("Capped session hosts at 180 (single-pool baseline ceiling; raw demand was $rawHosts hosts).")
}

$rawQuotaGiB = [int][Math]::Ceiling($totalUsers * $profileP95GiB * 1.20)
$profileQuotaGiB = [Math]::Max(100, [Math]::Min(102400, $rawQuotaGiB))
$monthlyEstimate = [Math]::Round(($cappedHosts * $vmRate) + ($profileQuotaGiB * 0.16), 2)

$identityVal = 'EntraOnly'
if ($intake.PSObject.Properties['identityConstraints'] -and ([string]$intake.identityConstraints -eq 'ad-ds-required')) {
    $identityVal = 'HybridADDS'
}

$regionVal = 'eastus2'
if ($intake.PSObject.Properties['preferredRegions'] -and $intake.preferredRegions -and @($intake.preferredRegions).Count -gt 0) {
    $regionVal = [string]@($intake.preferredRegions)[0]
}

$networkVal = 'Standalone'
if ($intake.PSObject.Properties['existingHub'] -and $intake.existingHub -and ([string]$intake.existingHub -ne 'none')) {
    $networkVal = 'HubPeered'
}

$sizingConf = if ($gatePassed) { 'high' } else { 'low' }
$identityConf = if ($gatePassed) { 'high' } else { 'low' }
$hpSuffix = if ($replaces.Count -gt 0) { "@$($replaces[0])" } else { '' }

$sizingEv = if ($gatePassed) { @('c12.group.perUser.p95CpuPercentOfCore', 'c12.group.perUser.p95MemoryMiB') } else { @("c11.hostPool.type$hpSuffix") }
$hostsEv = if ($gatePassed) { @('c12.group.concurrency.peak', 'c12.group.users') } else { @('c11.hostPool.count') }
$profileEv = if ($gatePassed) { @('c12.group.profile.p95SizeGiB', 'c12.group.users') } else { @('c11.storage.count') }
$typeEv = if ($gatePassed) { @('c12.group.users', "c11.hostPool.type$hpSuffix") } else { @("c11.hostPool.type$hpSuffix") }
$agEv = if ($gatePassed) { @('c12.group.apps.catalog', "c11.hostPool.preferredAppGroupType$hpSuffix") } else { @("c11.hostPool.preferredAppGroupType$hpSuffix") }

$tzId = 'America/Chicago'
$rampUp = '08:00'
$rampDown = '18:00'
if ($intake.PSObject.Properties['workingHours'] -and $intake.workingHours) {
    if ($intake.workingHours.PSObject.Properties['timeZone'] -and $intake.workingHours.timeZone) { $tzId = [string]$intake.workingHours.timeZone }
    if ($intake.workingHours.PSObject.Properties['start'] -and $intake.workingHours.start) { $rampUp = [string]$intake.workingHours.start }
    if ($intake.workingHours.PSObject.Properties['end'] -and $intake.workingHours.end) { $rampDown = [string]$intake.workingHours.end }
}
$tzWin = ConvertTo-WindowsTimezoneName -TimeZoneId $tzId
$peakClock = if ($rampUp -ne '09:00') { '09:00' } else { '10:00' }

$gaps = New-Object System.Collections.Generic.List[string]
if ($identityVal -ne 'EntraOnly') {
    $gaps.Add("identity.$identityVal")
}
if ($networkVal -ne 'Standalone') {
    $gaps.Add("network.$networkVal")
}

$lowConfidence = New-Object System.Collections.Generic.List[string]
if ($identityConf -eq 'low') {
    $lowConfidence.Add('/identity')
}
if ($sizingConf -eq 'low') {
    $lowConfidence.Add('/hostPools/0/vmSize')
    $lowConfidence.Add('/hostPools/0/maxSessions')
    $lowConfidence.Add('/hostPools/0/hosts')
    $lowConfidence.Add('/hostPools/0/profileQuotaGiB')
}

function Format-IsoUtcString {
    param($Value, [string]$Fallback)
    if ($null -eq $Value) { return $Fallback }
    if ($Value -is [DateTime]) {
        return $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    $s = [string]$Value
    if ($s -match '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$') {
        return $s
    }
    return $Fallback
}

function Format-IsoDateString {
    param($Value, [string]$Fallback)
    if ($null -eq $Value) { return $Fallback }
    if ($Value -is [DateTime]) {
        return $Value.ToUniversalTime().ToString('yyyy-MM-dd')
    }
    $s = [string]$Value
    if ($s -match '^[0-9]{4}-[0-9]{2}-[0-9]{2}') {
        return $s.Substring(0, 10)
    }
    return $Fallback
}

$answeredOn = if ($intake.PSObject.Properties['answeredOn'] -and $intake.answeredOn) { Format-IsoDateString -Value $intake.answeredOn -Fallback $GeneratedUtc.Substring(0, 10) } else { $GeneratedUtc.Substring(0, 10) }
$engagementId = "eng-$($answeredOn.Substring(0, 7))-$($estateId.Substring($estateId.Length - 4))"
$c11Utc = if ($c11.PSObject.Properties['generatedUtc'] -and $c11.generatedUtc) { Format-IsoUtcString -Value $c11.generatedUtc -Fallback $GeneratedUtc } else { $GeneratedUtc }
$forensicEnd = if ($gatePassed) { Format-IsoDateString -Value $measured.measurementGate.windowEnd -Fallback $GeneratedUtc.Substring(0, 10) } else { $null }
$qualityVerdict = if ($gatePassed) { 'pass' } else { 'low-confidence' }

$manifest = [ordered]@{
    schema       = 'avd-target-state/v1'
    estate       = $estateId
    engagement   = $engagementId
    generatedUtc = $GeneratedUtc
    producer     = [ordered]@{
        name    = 'avdmf'
        version = '0.1.0'
    }
    pins         = [ordered]@{
        brainCommit  = $brainCommit
        factRegister = $factRegVersion
    }
    evidence     = [ordered]@{
        currentState      = $c11Utc
        forensicWindowEnd = $forensicEnd
        quality           = $qualityVerdict
    }
    target       = [ordered]@{
        renderer       = if ($identityVal -eq 'EntraOnly') { 'lz-cloudnative' } else { 'avd-lza' }
        rendererCommit = $rendererCommit
        gaps           = @($gaps)
    }
    identity     = [ordered]@{
        value      = $identityVal
        evidence   = @('intake.identityConstraints', 'c11.hostPool.sessionHosts.entraJoined')
        confidence = $identityConf
    }
    region       = [ordered]@{
        value      = $regionVal
        evidence   = @('intake.preferredRegions', 'intake.residency')
        confidence = if ($gatePassed) { 'high' } else { 'medium' }
    }
    network      = [ordered]@{
        value      = $networkVal
        evidence   = @('intake.existingHub', 'c11.network.virtualNetworks')
        confidence = 'high'
    }
    hostPools    = @(
        [ordered]@{
            id              = 'tp-01'
            persona         = 'persona-1'
            replaces        = @($replaces)
            type            = [ordered]@{
                value      = 'Pooled'
                evidence   = @($typeEv)
                confidence = 'high'
            }
            appGroup        = [ordered]@{
                value      = 'Desktop'
                evidence   = @($agEv)
                confidence = 'high'
            }
            tier            = $tier
            users           = $totalUsers
            peakConcurrent  = $peakConcurrent
            vmSize          = [ordered]@{
                value      = $vmSize
                rule       = 'workload-tiers@v1'
                boundBy    = $boundBy
                evidence   = @($sizingEv)
                confidence = $sizingConf
            }
            maxSessions     = [ordered]@{
                value      = $maxSessions
                rule       = 'workload-tiers@v1'
                boundBy    = $boundBy
                evidence   = @($sizingEv)
                confidence = $sizingConf
            }
            hosts           = [ordered]@{
                value      = $cappedHosts
                rule       = 'workload-tiers@v1'
                evidence   = @($hostsEv)
                confidence = $sizingConf
            }
            power           = [ordered]@{
                value      = [ordered]@{
                    startVmOnConnect = $true
                    autoShutdownTime = 'none'
                }
                evidence   = @('intake.workingHours')
                confidence = 'high'
            }
            profileQuotaGiB = [ordered]@{
                value      = $profileQuotaGiB
                evidence   = @($profileEv)
                confidence = $sizingConf
            }
            monthlyEstimate = $monthlyEstimate
            scaling         = [ordered]@{
                timeZone = $tzWin
                rampUp   = $rampUp
                peak     = $peakClock
                rampDown = $rampDown
            }
            apps            = [ordered]@{
                image     = @('microsoft-m365-apps-16')
                appAttach = @()
                unknown   = 0
            }
        }
    )
    profiles     = [ordered]@{
        type    = 'FSLogix'
        storage = 'AzureFilesPremium'
    }
    cost         = [ordered]@{
        monthlyEstimate = $monthlyEstimate
        currency        = 'USD'
        unmatchedLines  = 0
    }
}

if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
}

$manifestJson = ($manifest | ConvertTo-Json -Depth 12) -replace "`r`n", "`n"
if (-not $manifestJson.EndsWith("`n")) {
    $manifestJson += "`n"
}
Test-NoSensitiveLeak -RawText $manifestJson -ContextName 'C14 target-state manifest'

$manifestBytes = [System.Text.Encoding]::UTF8.GetBytes($manifestJson)
$manifestPath = Join-Path $OutputDirectory 'manifest.json'
[System.IO.File]::WriteAllBytes($manifestPath, $manifestBytes)

$manifestSha = Get-Sha256Hex -Bytes $manifestBytes
$approval = [ordered]@{
    schema              = 'avd-target-approval/v1'
    manifestSha256      = $manifestSha
    approvedUtc         = $GeneratedUtc
    acceptLowConfidence = @($lowConfidence | Sort-Object -Unique)
}
$approvalJson = ($approval | ConvertTo-Json -Depth 6) -replace "`r`n", "`n"
if (-not $approvalJson.EndsWith("`n")) {
    $approvalJson += "`n"
}
$approvalBytes = [System.Text.Encoding]::UTF8.GetBytes($approvalJson)
$approvalPath = Join-Path $OutputDirectory 'manifest.approval.json'
[System.IO.File]::WriteAllBytes($approvalPath, $approvalBytes)

Write-Host "RESULT PASS designed $estateId -> tp-01 ($cappedHosts hosts, `$$monthlyEstimate/mo, sha256=$manifestSha)"
foreach ($notice in $boundaryNotices) {
    Write-Host "NOTICE: $notice"
}

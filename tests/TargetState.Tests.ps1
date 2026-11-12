#requires -Version 7.2
# Personal project, not for production, as is, not affiliated with the author's employer, Liquidware or Microsoft.

Describe 'ConvertTo-AvdTargetState.ps1 (avd-migrate single-pool baseline designer)' {
    BeforeAll {
        $script:RepoRoot = Split-Path -Parent $PSScriptRoot
        $script:ScriptPath = Join-Path $script:RepoRoot 'ConvertTo-AvdTargetState.ps1'
        $script:TargetSchemaPath = Join-Path $script:RepoRoot 'contracts/target-state.schema.json'
        $script:ApprovalSchemaPath = Join-Path $script:RepoRoot 'contracts/target-approval.schema.json'
    }

    It 'Generates schema-valid manifest.json (C14 v1) and manifest.approval.json for a single-pool estate with C27' {
        $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "avd-migrate-test-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        try {
            $c11Path = Join-Path $tmpDir 'c11.json'
            $intakePath = Join-Path $tmpDir 'intake.json'
            $c27Path = Join-Path $tmpDir 'c27.json'
            $outDir = Join-Path $tmpDir 'out'

            @{
                schema       = 'avd-current-state-facts/v1'
                estate       = 'est-828c157f'
                generatedUtc = '2026-11-11T12:00:00Z'
                hostPools    = @(
                    @{
                        id                    = 'hp-11a2b3c4'
                        type                  = 'Pooled'
                        preferredAppGroupType = 'Desktop'
                        assignedUsers         = 150
                        sessionHosts          = 8
                    }
                )
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $c11Path -Encoding UTF8

            @{
                schema              = 'avd-estate-intake/v1'
                estate              = 'est-828c157f'
                answeredOn          = '2026-11-11'
                preferredRegions    = @('eastus2')
                existingHub         = 'none'
                identityConstraints = 'entra-only'
                workingHours        = @{
                    timeZone = 'America/Chicago'
                    start    = '08:00'
                    end      = '18:00'
                }
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $intakePath -Encoding UTF8

            @{
                schema          = 'avd-measured-usage/v1'
                estate          = 'est-828c157f'
                generatedUtc    = '2026-11-11T12:00:00Z'
                tier            = 'tier-2-insights'
                producer        = @{ name = 'Export-AvdInsightsUsage'; version = '0.1.0' }
                measurementGate = @{
                    windowStart     = '2026-10-14'
                    windowEnd       = '2026-11-11'
                    daysObserved    = 28
                    coveragePercent = 94.0
                    peakIncluded    = $true
                    passed          = $true
                }
                groups          = @(
                    @{
                        id                       = 'grp-01'
                        sourcePoolId             = 'hp-11a2b3c4'
                        userCount                = 150
                        peakConcurrency          = 120
                        hourlyConcurrency        = @(4,4,4,4,6,12,35,85,115,120,118,110,105,116,119,112,88,45,18,10,6,5,4,4)
                        cpuPerUserCores          = @{ p50 = 0.42; p95 = 0.85 }
                        memoryPerUserGiB         = @{ p50 = 2.4; p95 = 4.2 }
                        steadyStateIopsPerUser   = @{ p50 = 8.0; p95 = 16.0 }
                        logonStormIopsPerUser    = @{ p50 = 32.0; p95 = 60.0 }
                        profileSizeGiB           = @{ p50 = 9.0; p95 = 18.0 }
                        dailyProfileChurnPercent = 7.5
                        logonDurationSeconds     = @{ p50 = 14.0; p95 = 26.0 }
                        experienceScore          = @{ p50 = 86.0; p95 = 74.0 }
                        gpuRequired              = $false
                        needsLocalAdmin          = $false
                    }
                )
            } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $c27Path -Encoding UTF8

            & $script:ScriptPath -CurrentStatePath $c11Path -IntakePath $intakePath -MeasuredUsagePath $c27Path -OutputDirectory $outDir

            $manifestPath = Join-Path $outDir 'manifest.json'
            $approvalPath = Join-Path $outDir 'manifest.approval.json'
            Test-Path -LiteralPath $manifestPath | Should -BeTrue
            Test-Path -LiteralPath $approvalPath | Should -BeTrue

            $manifestRaw = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
            $approvalRaw = Get-Content -LiteralPath $approvalPath -Raw -Encoding UTF8

            ($manifestRaw | Test-Json -SchemaFile $script:TargetSchemaPath) | Should -BeTrue
            ($approvalRaw | Test-Json -SchemaFile $script:ApprovalSchemaPath) | Should -BeTrue

            $manifestObj = $manifestRaw | ConvertFrom-Json
            $approvalObj = $approvalRaw | ConvertFrom-Json
            $manifestObj.hostPools.Count | Should -Be 1
            $manifestObj.hostPools[0].id | Should -Be 'tp-01'
            $manifestObj.evidence.quality | Should -Be 'pass'
            $approvalObj.acceptLowConfidence.Count | Should -Be 0
        }
        finally {
            Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Auto-merges multiple source pools into tp-01 and populates acceptLowConfidence when C27 is absent' {
        $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "avd-migrate-merge-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        try {
            $c11Path = Join-Path $tmpDir 'c11.json'
            $intakePath = Join-Path $tmpDir 'intake.json'
            $outDir = Join-Path $tmpDir 'out'

            @{
                schema       = 'avd-current-state-facts/v1'
                estate       = 'est-eb068234'
                generatedUtc = '2026-11-11T12:00:00Z'
                hostPools    = @(
                    @{ id = 'hp-aa000001'; type = 'Pooled'; preferredAppGroupType = 'Desktop'; assignedUsers = 200; sessionHosts = 10 },
                    @{ id = 'hp-bb000002'; type = 'Personal'; preferredAppGroupType = 'Desktop'; assignedUsers = 50; sessionHosts = 50 }
                )
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $c11Path -Encoding UTF8

            @{
                schema              = 'avd-estate-intake/v1'
                estate              = 'est-eb068234'
                answeredOn          = '2026-11-11'
                preferredRegions    = @('eastus2')
                existingHub         = 'none'
                identityConstraints = 'entra-only'
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $intakePath -Encoding UTF8

            & $script:ScriptPath -CurrentStatePath $c11Path -IntakePath $intakePath -OutputDirectory $outDir

            $manifestRaw = Get-Content -LiteralPath (Join-Path $outDir 'manifest.json') -Raw -Encoding UTF8
            $approvalRaw = Get-Content -LiteralPath (Join-Path $outDir 'manifest.approval.json') -Raw -Encoding UTF8
            ($manifestRaw | Test-Json -SchemaFile $script:TargetSchemaPath) | Should -BeTrue
            ($approvalRaw | Test-Json -SchemaFile $script:ApprovalSchemaPath) | Should -BeTrue

            $manifestObj = $manifestRaw | ConvertFrom-Json
            $approvalObj = $approvalRaw | ConvertFrom-Json
            $manifestObj.hostPools.Count | Should -Be 1
            $manifestObj.hostPools[0].users | Should -Be 250
            $manifestObj.hostPools[0].replaces.Count | Should -Be 2
            $approvalObj.acceptLowConfidence | Should -Contain '/hostPools/0/vmSize'
        }
        finally {
            Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'Supports BasicTenantToTenant mode, flattens target identity to EntraOnly, and emits t2t-checklist.json' {
        $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "avd-migrate-t2t-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        try {
            $c11Path = Join-Path $tmpDir 'c11.json'
            $intakePath = Join-Path $tmpDir 'intake.json'
            $outDir = Join-Path $tmpDir 'out'

            @{
                schema       = 'avd-current-state-facts/v1'
                estate       = 'est-7270ba51'
                generatedUtc = '2026-11-11T12:00:00Z'
                hostPools    = @(
                    @{ id = 'hp-7270ba51'; type = 'Pooled'; preferredAppGroupType = 'Desktop'; assignedUsers = 120; sessionHosts = 6 }
                )
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $c11Path -Encoding UTF8

            @{
                schema              = 'avd-estate-intake/v1'
                estate              = 'est-7270ba51'
                answeredOn          = '2026-11-11'
                preferredRegions    = @('eastus2')
                existingHub         = 'none'
                identityConstraints = 'ad-ds-required'
            } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $intakePath -Encoding UTF8

            & $script:ScriptPath -CurrentStatePath $c11Path -IntakePath $intakePath -OutputDirectory $outDir -MigrationMode BasicTenantToTenant

            $manifestRaw = Get-Content -LiteralPath (Join-Path $outDir 'manifest.json') -Raw -Encoding UTF8
            $approvalRaw = Get-Content -LiteralPath (Join-Path $outDir 'manifest.approval.json') -Raw -Encoding UTF8
            $checklistPath = Join-Path $outDir 't2t-checklist.json'
            Test-Path -LiteralPath $checklistPath | Should -BeTrue

            ($manifestRaw | Test-Json -SchemaFile $script:TargetSchemaPath) | Should -BeTrue
            ($approvalRaw | Test-Json -SchemaFile $script:ApprovalSchemaPath) | Should -BeTrue

            $manifestObj = $manifestRaw | ConvertFrom-Json
            $checklistObj = (Get-Content -LiteralPath $checklistPath -Raw -Encoding UTF8) | ConvertFrom-Json
            $manifestObj.identity.value | Should -Be 'EntraOnly'
            $manifestObj.target.renderer | Should -Be 'lz-cloudnative'
            $checklistObj.schema | Should -Be 'avd-t2t-basic-checklist/v1'
            $checklistObj.migrationMode | Should -Be 'basic-t2t'
            $checklistObj.steps.Count | Should -Be 4
        }
        finally {
            Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

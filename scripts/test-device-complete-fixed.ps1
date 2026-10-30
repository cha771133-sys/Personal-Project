# Device completion API test. ASCII-only for compatibility with Windows PowerShell 5.1.
# Only a pending demo-med-001 occurrence whose ID starts with demo- can be modified.
$ErrorActionPreference = 'Stop'
$base = 'https://personal-project-yctb.vercel.app'

$secret = Read-Host 'DEVICE_API_TOKEN (hidden input)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$headers = @{ Authorization = "Bearer $token" }

try {
    Write-Host '[1/3] Read current schedule (GET)'
    $before = Invoke-RestMethod -Uri "$base/api/device/medications" -Method Get -Headers $headers
    $demos = @(@($before.medications) | Where-Object {
        $_.medicationId -eq 'demo-med-001' -and
        $_.occurrenceId -like 'demo-*'
    })

    if ($demos.Count -eq 0) {
        Write-Host 'No demo-med-001 medication found. Nothing was changed.'
        Write-Host "Total medications: $(@($before.medications).Count)"
        exit 1
    }

    foreach ($d in $demos) {
        Write-Host "Demo entry: occurrenceId=$($d.occurrenceId), status=$($d.status)"
    }

    $demo = $demos | Where-Object { $_.status -eq 'pending' } | Select-Object -First 1
    if ($null -eq $demo) {
        Write-Host 'No pending demo entry. POST was not sent.'
        Write-Host 'To reset only the known one-item demo dataset, run:'
        Write-Host 'node --env-file=.env.local scripts/set-demo-alarm.mjs'
        exit 1
    }

    Write-Host "Selected demo occurrence: $($demo.occurrenceId)"
    Write-Host '[2/3] Mark demo as completed (POST)'
    $body = @{ occurrenceId = $demo.occurrenceId } | ConvertTo-Json -Compress
    $completed = Invoke-RestMethod -Uri "$base/api/device/complete" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body
    $completed | ConvertTo-Json -Depth 10

    Write-Host '[3/3] Verify saved status (GET)'
    $after = Invoke-RestMethod -Uri "$base/api/device/medications" -Method Get -Headers $headers
    $saved = @($after.medications) | Where-Object { $_.occurrenceId -eq $demo.occurrenceId } | Select-Object -First 1
    if ($null -eq $saved) { throw 'Updated demo occurrence was not returned by GET.' }
    Write-Host "Saved status: $($saved.status)"
    Write-Host "Saved completedAt: $($saved.completedAt)"
    Write-Host "scheduleVersion: $($before.scheduleVersion) -> $($after.scheduleVersion)"
    if ($saved.status -ne 'completed') { throw 'GET did not confirm completed status.' }
    Write-Host '[OK] Demo completion persisted in Redis.'
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    exit 1
}

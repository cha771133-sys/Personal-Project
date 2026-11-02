# PowerShell 5.1 compatible (ASCII-only source)
$ErrorActionPreference = 'Stop'
$url = 'https://personal-project-yctb.vercel.app/api/device/medications'
$secure = Read-Host 'DEVICE_API_TOKEN' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
try {
    $data = Invoke-RestMethod -Method Get -Uri $url -Headers @{Authorization = "Bearer $token"}
    Write-Host "deviceId = $($data.deviceId)"
    Write-Host "scheduleVersion = $($data.scheduleVersion)"
    Write-Host "medicationCount = $(@($data.medications).Count)"
    $data.medications | Select-Object -First 8 occurrenceId, name, dose, scheduledAt, status | Format-Table -AutoSize
} finally {
    Remove-Variable token, secure -ErrorAction SilentlyContinue
}

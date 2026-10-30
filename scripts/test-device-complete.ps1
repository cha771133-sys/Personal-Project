# 사전에 Vercel Production 재배포까지 완료해야 합니다.
# 경고: 테스트 데이터의 완료 상태를 Redis에 실제로 저장합니다.
$base = 'https://personal-project-yctb.vercel.app'
$secret = Read-Host 'DEVICE_API_TOKEN 입력 (입력 내용 숨김)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$headers = @{ Authorization = "Bearer $token" }

Write-Host '[1/3] GET으로 현재 일정 조회'
$before = Invoke-RestMethod -Uri "$base/api/device/medications" -Method Get -Headers $headers
$demo = @($before.medications) | Where-Object { $_.medicationId -eq 'demo-med-001' -and $_.name -eq '통신 테스트' -and $_.status -eq 'pending' } | Select-Object -First 1
if ($null -eq $demo) {
    Write-Host '미완료 테스트용 일정이 없습니다. 실제 처방전 데이터는 변경하지 않았습니다.'
    exit 1
}
Write-Host "테스트 일정 ID: $($demo.occurrenceId)"

Write-Host '[2/3] POST 완료 요청'
$body = @{ occurrenceId = $demo.occurrenceId } | ConvertTo-Json -Compress
$completed = Invoke-RestMethod -Uri "$base/api/device/complete" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body
$completed | ConvertTo-Json -Depth 10

Write-Host '[3/3] GET으로 저장 결과 재확인'
$after = Invoke-RestMethod -Uri "$base/api/device/medications" -Method Get -Headers $headers
@($after.medications) | Where-Object { $_.occurrenceId -eq $demo.occurrenceId } | ConvertTo-Json -Depth 10
Write-Host "scheduleVersion: $($before.scheduleVersion) -> $($after.scheduleVersion)"

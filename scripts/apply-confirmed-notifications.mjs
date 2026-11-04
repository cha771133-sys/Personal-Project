import fs from 'node:fs';
import path from 'node:path';

// Applies precise edits to the GitHub version from Nov 4, 2026.
// Aborts BEFORE writing when any expected anchor is absent.
// Run from the Next.js project root. Original files are backed up once.

const MARKER = 'CONFIRMED_NOTIFICATIONS_V1';
const patches = new Map();

function file(rel) {
  const absolute = path.join(process.cwd(), rel);
  if (!fs.existsSync(absolute)) throw new Error(`Missing: ${rel}`);
  const raw = fs.readFileSync(absolute, 'utf8');
  return { raw, normalized: raw.replace(/\r\n/g, '\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}
function replaceOnce(text, needle, replacement, name) {
  const first = text.indexOf(needle);
  if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${name}: missing or duplicated anchor`);
  }
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}
function rangeReplace(text, start, end, replacement, name) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || text.indexOf(start, a + start.length) >= 0) {
    throw new Error(`${name}: start/end anchors not uniquely found`);
  }
  return text.slice(0, a) + replacement + text.slice(b);
}
function stage(rel, transform) {
  const original = file(rel);
  if (original.normalized.includes(MARKER)) {
    console.log(`[SKIP] Already applied: ${rel}`);
    return;
  }
  const patched = transform(original.normalized);
  if (patched === original.normalized || !patched.includes(MARKER)) {
    throw new Error(`${rel}: patch did not apply`);
  }
  patches.set(rel, { ...original, patched });
}

try {
  stage('src/app/api/analyze/route.ts', s => {
    s = replaceOnce(s, "import { scheduleNotification, deleteSchedules } from '@/lib/qstash';\n", '', 'analyze qstash import');
    s = replaceOnce(s, "import { redis, saveScheduleIds, getScheduleIds } from '@/lib/redis';\n", '', 'analyze redis import');
    s = replaceOnce(s, "import type { GuardianData } from '@/types/prescription';\n", '', 'analyze guardian import');
    s = rangeReplace(s, 'async function sendTelegramMessage(', 'async function sendToN8N(', '', 'analyze telegram helpers');
    s = replaceOnce(s, "  let phone: string | undefined;\n  const patientChatId = process.env.TELEGRAM_CHAT_ID || '';\n  if (!patientChatId) {\n    console.error('❌ TELEGRAM_CHAT_ID 환경변수가 설정되지 않았습니다.');\n  }\n", '', 'analyze chat ID');
    s = replaceOnce(s, "    phone = formData.get('phone_number')?.toString() ?? undefined;\n", '', 'analyze phone');
    s = rangeReplace(s, '    // ── 8. QStash cron 등록', '    return NextResponse.json<AnalyzeResponse>({',
      '    // CONFIRMED_NOTIFICATIONS_V1: analysis must never schedule/send alerts.\n' +
      '    // An authorized POST /api/notifications/confirm is required after review.\n', 'analyze auto scheduling');
    s = replaceOnce(s, '      alerts_registered: alertsRegistered,', '      alerts_registered: false,', 'analyze response');
    return s;
  });

  stage('src/lib/qstash.ts', s => {
    s = replaceOnce(s, '  alertType: AlertType  // 보호자 알림 조건 필터링에 사용\n',
      '  alertType: AlertType  // 보호자 알림 조건 필터링에 사용\n' +
      '  planId?: string\n  startsOn?: string // YYYY-MM-DD (Asia/Seoul)\n' +
      '  expiresOn?: string // YYYY-MM-DD (Asia/Seoul), inclusive\n', 'qstash payload');
    s += `\n// CONFIRMED_NOTIFICATIONS_V1: strict cleanup reports exact failed schedule IDs.\nexport async function deleteSchedulesWithFailures(ids: string[]): Promise<string[]> {\n  const results = await Promise.allSettled(ids.map(id => qstash.schedules.delete(id)))\n  return ids.filter((_, i) => results[i].status === 'rejected')\n}\n`;
    return s;
  });

  stage('src/app/api/notify/route.ts', s => {
    const needle = "  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)\n";
    const gate = `\n  // CONFIRMED_NOTIFICATIONS_V1: only the active, reviewed plan may send alerts.\n  // Existing legacy jobs are allowed until the first confirmed plan is registered.\n  const active = await redis.get<{ planId: string }>(\`notifications:active:\${patientChatId}\`)\n  if (payload.planId) {\n    if (!active || active.planId !== payload.planId) {\n      return NextResponse.json({ skipped: true, reason: 'stale-plan' })\n    }\n    const validDate = (s: unknown): s is string =>\n      typeof s === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(s)\n    if (!validDate(payload.startsOn) || !validDate(payload.expiresOn) ||\n        today < payload.startsOn || today > payload.expiresOn) {\n      return NextResponse.json({ skipped: true, reason: 'outside-prescription-period' })\n    }\n  } else if (active?.planId) {\n    return NextResponse.json({ skipped: true, reason: 'superseded-legacy-job' })\n  }\n`;
    s = replaceOnce(s, needle, needle + gate, 'notify date check');
    return s;
  });

  stage('src/app/result/page.tsx', s => {
    s = replaceOnce(s, '  const [scheduledCount, setScheduledCount] = useState(0);\n',
      '  const [scheduledCount, setScheduledCount] = useState(0);\n' +
      '  // CONFIRMED_NOTIFICATIONS_V1: admin-authenticated actual QStash registration.\n' +
      '  const [notificationToken, setNotificationToken] = useState(\'\');\n' +
      '  const [notificationMessage, setNotificationMessage] = useState(\'\');\n', 'result state');
    const handler = `  // Confirmed schedule registration: do not claim success after only sending a message.\n  const handleTelegram = async () => {\n    if (!reviewConfirmed || !result?.data) return;\n    if (!notificationToken.trim()) {\n      setNotificationMessage('관리자 등록 토큰을 입력하세요.');\n      setTelegramState('error');\n      return;\n    }\n    const selected = result.data.medications.filter(\n      med => alarmEnabled[med.drug_name_simple] !== false\n    );\n    if (selected.length === 0) {\n      setTelegramMessageError('알림을 받을 약을 하나 이상 선택하세요.');\n      return;\n    }\n    if (!window.confirm(\n      '최종 확인한 복약 정보로 Telegram/QStash 알림을 등록할까요?\\n' +\n      '기존 Telegram 예약은 교체되지만 ESP32의 Redis 일정은 바뀌지 않습니다.'\n    )) return;\n    setTelegramState('sending');\n    setNotificationMessage('');\n    try {\n      const res = await fetch('/api/notifications/confirm', {\n        method: 'POST',\n        headers: {\n          'Content-Type': 'application/json',\n          Authorization: \`Bearer \${notificationToken}\`,\n        },\n        body: JSON.stringify({\n          confirmed: true,\n          patientName: result.data.patient_name ?? '',\n          medications: selected,\n        }),\n        cache: 'no-store',\n      });\n      const data: {\n        success?: boolean; error?: string; scheduleCount?: number;\n        alreadyScheduled?: boolean; warning?: string;\n      } = await res.json();\n      if (!res.ok || !data.success) throw new Error(data.error || \`HTTP \${res.status}\`);\n      setScheduledCount(data.scheduleCount ?? 0);\n      setTelegramState('done');\n      setNotificationMessage(\n        (data.alreadyScheduled\n          ? '동일한 내용이 이미 예약되어 있어 중복 등록하지 않았습니다.'\n          : '최종 확인한 복약 정보로 QStash 알림을 등록했습니다.') +\n        (data.warning ? \` 주의: \${data.warning}\` : '')\n      );\n      setNotificationToken('');\n    } catch (e) {\n      setTelegramState('error');\n      setNotificationMessage(e instanceof Error ? e.message : '알림 예약에 실패했습니다.');\n    }\n  };\n\n`;
    // Variable name normalized below; keep text stable for easier review.
    s = rangeReplace(s, '  // 예약 확인 메시지 즉시 발송 (약별 개별 발송은 QStash cron이 담당)\n',
      '  // PRESCRIPTION_REVIEW_V1: reviewed data becomes the single client-side source.\n',
      handler, 'result old fake Telegram');
    s = s.replace('setTelegramMessageError(', 'setNotificationMessage(');
    s = replaceOnce(s, '          onDirty={() => setReviewConfirmed(false)}',
      '          onDirty={() => {\n' +
      '            setReviewConfirmed(false);\n            setTelegramState(\'idle\');\n' +
      '            setNotificationMessage(\'복약 정보를 수정했습니다. 기존 Telegram 예약은 새로 등록할 때까지 유지될 수 있습니다.\');\n' +
      '          }}', 'result dirty');
    s=replaceOnce(s, "    setAlarmEnabled(prev => ({ ...prev, [drugName]: !prev[drugName] }));\n",
      "    setAlarmEnabled(prev => ({ ...prev, [drugName]: !prev[drugName] }));\n" +
      "    setTelegramState('idle');\n" +
      "    setNotificationMessage('알림 대상 약이 변경됐습니다. 변경된 예약을 다시 등록하세요.');\n", 'result selection changed');
    const buttonAnchor='          {/* 텔레그램 버튼 */}\n';
    const tokenBlock=`          {/* 최종 확인된 내용으로 실제 예약을 생성합니다. */}\n` +
      `          <label htmlFor="confirmed-notify-token" className="block text-sm font-semibold text-gray-800">\n`+
      `            관리자 등록 토큰 (DEVICE_PUBLISH_TOKEN)\n`+
      `          </label>\n`+
      `          <input id="confirmed-notify-token" type="password" autoComplete="off"\n`+
      `            value={notificationToken} onChange={e => {\n`+
      `              setNotificationToken(e.target.value);\n`+
      `              if (telegramState === 'done') setTelegramState('idle');\n`+
      `            }}\n`+
      `            placeholder="스마트 약통 등록 때 사용하는 관리자 토큰"\n`+
      `            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900"\n`+
      `          />\n`+
      `          <p className="text-xs text-orange-800">\n`+
      `            최종 확인 후 Telegram/QStash 예약 버튼을 눌러야 실제 알림이 등록됩니다.\n`+
      `            기존 예약은 변경된 복약 정보를 다시 등록할 때까지 유지될 수 있습니다.\n`+
      `          </p>\n`;
    s=replaceOnce(s, buttonAnchor, tokenBlock + buttonAnchor, 'result token UI');
    s=replaceOnce(s, "              `✅ ${scheduledCount}개 알림 예약 완료! (복용 시간에 전송)`",
      "              `✅ ${scheduledCount}건 QStash 예약 완료`", 'result success label');
    s=replaceOnce(s, "            disabled={!reviewConfirmed || telegramState === 'sending' || telegramState === 'done'}",
      "            disabled={!reviewConfirmed || telegramState === 'sending' || !notificationToken.trim()}", 'result button available for update');
    s=replaceOnce(s, "              '💬 텔레그램으로 전체 알림 받기'",
      "              '💬 Telegram/QStash 알림 예약·갱신'", 'result button label');
    s=replaceOnce(s, '          {/* 브라우저 알림 버튼 */}',
      `          {notificationMessage && (\n            <p role="status" className={\`rounded-xl p-3 text-sm font-semibold \${telegramState === 'error' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}\`}>\n              {notificationMessage}\n            </p>\n          )}\n\n          {/* 브라우저 알림 버튼 */}`, 'result message UI');
    return s;
  });

  stage('src/components/PrescriptionReviewPanel.tsx', s => {
    s = replaceOnce(s,
      '현재 Telegram/QStash 알림은 AI 분석 직후 별도로 예약됩니다. 여기서 수정해도 이미 예약된 Telegram/QStash 알림은 자동 변경되지 않습니다. 이번 단계에서는 스마트 약통 등록과 브라우저 알림에만 수정값이 반영됩니다.',
      'Telegram/QStash 알림은 분석 직후 자동 예약되지 않습니다. 최종 확인 후 아래 알림 설정에서 관리자 토큰을 입력하고 Telegram/QStash 알림 예약·갱신 버튼을 눌러 등록하세요. 기존 예약은 새로 등록할 때까지 유지될 수 있습니다.\n        {/* CONFIRMED_NOTIFICATIONS_V1 */}', 'review warning');
    return s;
  });

  // The legacy schedules endpoint previously allowed unauthenticated deletion.
  stage('src/app/api/schedules/route.ts', s => {
    s = replaceOnce(s, "import 'server-only';\n", "import 'server-only';\nimport { timingSafeEqual } from 'node:crypto';\n", 'schedules crypto import');
    s = replaceOnce(s, "import { getScheduleIds, saveScheduleIds } from '@/lib/redis';",
      "import { redis, getScheduleIds, saveScheduleIds } from '@/lib/redis';", 'schedules redis import');
    s = replaceOnce(s, "import { deleteSchedules } from '@/lib/qstash';",
      "import { deleteSchedulesWithFailures } from '@/lib/qstash';", 'schedules delete import');
    s = replaceOnce(s, '/**\n * GET /api/schedules?patientChatId=xxx',
      `// CONFIRMED_NOTIFICATIONS_V1: protect enumeration and deletion of QStash jobs.\n`+
      `function isAuthorized(request: NextRequest): boolean {\n`+
      `  const expected = process.env.DEVICE_PUBLISH_TOKEN;\n`+
      `  const supplied = request.headers.get('authorization') ?? '';\n`+
      `  if (!expected || expected.length < 32 || !supplied.startsWith('Bearer ')) return false;\n`+
      `  const a = Buffer.from(supplied.slice(7), 'utf8');\n`+
      `  const b = Buffer.from(expected, 'utf8');\n`+
      `  return a.length === b.length && timingSafeEqual(a, b);\n`+
      `}\n\n/**\n * GET /api/schedules?patientChatId=xxx`, 'schedules auth helper');
    s = replaceOnce(s, 'export async function GET(request: NextRequest) {\n',
      `export async function GET(request: NextRequest) {\n`+
      `  if (!isAuthorized(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });\n`, 'schedules GET auth');
    s = replaceOnce(s, 'export async function DELETE(request: NextRequest) {\n',
      `export async function DELETE(request: NextRequest) {\n`+
      `  if (!isAuthorized(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });\n`, 'schedules DELETE auth');
    s = rangeReplace(s, '  const scheduleIds = await getScheduleIds(patientChatId)\n\n  if (scheduleIds.length === 0)',
      '  console.log(`🗑️ [schedules]',
      `  const active = await redis.get<{ scheduleIds?: string[] }>(\`notifications:active:\${patientChatId}\`)\n`+
      `  const scheduleIds = [...new Set([\n`+
      `    ...(Array.isArray(active?.scheduleIds) ? active.scheduleIds : []),\n`+
      `    ...await getScheduleIds(patientChatId),\n`+
      `  ])]\n`+
      `  const failed = await deleteSchedulesWithFailures(scheduleIds)\n`+
      `  if (failed.length > 0) {\n`+
      `    await saveScheduleIds(patientChatId, failed)\n`+
      `    return NextResponse.json({ error: 'QSTASH_DELETE_PARTIAL_FAILURE', failed: failed.length }, { status: 502 })\n`+
      `  }\n`+
      `  await saveScheduleIds(patientChatId, [])\n`+
      `  await redis.del(\`notifications:active:\${patientChatId}\`)\n`+
      `  await redis.del(\`notifications:retired:\${patientChatId}\`)\n`+
      `\n`, 'schedules cleanup logic');
    return s;
  });

  // All anchors validated. Only now touch the working tree.
  for (const [rel, p] of patches) {
    const abs = path.join(process.cwd(), rel);
    const backup = abs + '.backup-before-confirmed-notifications';
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, p.raw);
    fs.writeFileSync(abs, p.patched.replace(/\n/g, p.eol));
    console.log(`[OK] ${rel} | backup: ${path.basename(backup)}`);
  }
  const target = 'src/app/api/notifications/confirm/route.ts';
  if (!fs.existsSync(target)) console.warn(`[IMPORTANT] New API file missing: ${target}`);
  console.log('[NEXT] npm.cmd run build');
} catch (error) {
  console.error('[STOP] No changes were written:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

/**
 * Safe, idempotent source patch for existing src/app/calendar/page.tsx.
 * Node.js 18+; no npm dependencies. Preserves manual checkStorage.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), 'src/app/calendar/page.tsx');
if (!existsSync(file)) {
  console.error('ERROR: src/app/calendar/page.tsx not found. Run from Personal-Project root.');
  process.exit(1);
}
// Normalize Windows CRLF line endings only while matching. Preserve original style on write.
const originalContent = readFileSync(file, 'utf8');
const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
let content = originalContent.replace(/\r\n/g, '\n');
if (content.includes('CALENDAR_SERVER_SYNC_V2')) {
  console.log('[OK] Calendar synchronization patch already applied. No changes.');
  process.exit(0);
}

function replaceOnce(oldText, newText, label) {
  const pos = content.indexOf(oldText);
  if (pos < 0 || content.indexOf(oldText, pos + oldText.length) !== -1) {
    throw new Error(`Could not find exactly one anchor: ${label}. No files changed.`);
  }
  content = content.replace(oldText, newText);
}

try {
  replaceOnce(
    "import DeviceCalendarPanel from '@/components/DeviceCalendarPanel';",
    "import DeviceCalendarPanel, { type DeviceCalendarEntry } from '@/components/DeviceCalendarPanel';",
    'DeviceCalendarPanel import'
  );

  replaceOnce(
    '  const [calendarData, setCalendarData] = useState<CalendarData>({});',
    `  const [calendarData, setCalendarData] = useState<CalendarData>({});
  // CALENDAR_SERVER_SYNC_V2: records are in memory only, not localStorage.
  const [serverEntries, setServerEntries] = useState<DeviceCalendarEntry[] | null>(null);`,
    'calendarData state'
  );

  replaceOnce(
    '  // 이번 달 복약률 계산',
    `  // Match by Korean calendar date, simple medication name, and time.
  // The server view has no prescription/account ID yet; single-device demo only.
  const isDeviceCompleted = useCallback((simpleName: string, day: string, time: string): boolean => {
    return serverEntries?.some(entry =>
      entry.name === simpleName &&
      entry.scheduledAt.slice(0, 10) === day &&
      entry.scheduledAt.slice(11, 16) === time &&
      entry.status === 'completed'
    ) ?? false;
  }, [serverEntries]);

  // 이번 달 복약률 계산`,
    'adherence header'
  );

  replaceOnce(
    `  const calcAdherence = useCallback((): number => {
    if (medications.length === 0) return 0;`,
    `  const calcAdherence = useCallback((): number | null => {
    if (serverEntries !== null) {
      // Only doses already due are in the denominator. No scheduled doses -> N/A.
      const month = String(viewYear) + '-' + String(viewMonth + 1).padStart(2, '0');
      const due = serverEntries.filter(entry =>
        entry.scheduledAt.startsWith(month) && Date.parse(entry.scheduledAt) <= Date.now()
      );
      if (due.length === 0) return null;
      const done = due.filter(entry => entry.status === 'completed').length;
      return Math.round((done / due.length) * 100);
    }
    if (medications.length === 0) return 0;`,
    'calcAdherence opening'
  );

  replaceOnce(
    '  }, [calendarData, medications, viewYear, viewMonth, todayKey]);',
    '  }, [calendarData, medications, viewYear, viewMonth, todayKey, serverEntries]);',
    'calcAdherence deps'
  );

  replaceOnce(
    `    return times.every(t => state?.checks[t] === true);
  });`,
    `    return times.every(t => state?.checks[t] === true ||
      isDeviceCompleted(med.drug_name_simple, todayKey, t));
  });`,
    'todayDone'
  );

  replaceOnce(
    `  const adherence = calcAdherence();`,
    `  const adherence = calcAdherence();
  const isServerMode = serverEntries !== null;
  const highAdherence = adherence !== null && adherence >= 80;`,
    'adherence call'
  );

  replaceOnce(
    `  const getDayStatus = (date: Date): 'done' | 'miss' | 'none' => {
    const key = toDateKey(date);
    if (key > todayKey) return 'none'; // 미래`,
    `  const getDayStatus = (date: Date): 'done' | 'miss' | 'none' | 'scheduled' | 'partial' => {
    const key = toDateKey(date);
    if (serverEntries !== null) {
      const entries = serverEntries.filter(e => e.scheduledAt.slice(0, 10) === key);
      if (entries.length === 0) return 'none';
      if (key > todayKey) return 'scheduled';
      if (entries.every(e => e.status === 'completed')) return 'done';
      if (key < todayKey) return 'miss';
      return entries.some(e => e.status === 'completed') ? 'partial' : 'scheduled';
    }
    if (key > todayKey) return 'none'; // 미래`,
    'getDayStatus'
  );

  replaceOnce(
    `          adherence >= 80 ? 'bg-green-50 border-2 border-green-400' : 'bg-orange-50 border-2 border-orange-400'`,
    `          highAdherence ? 'bg-green-50 border-2 border-green-400' : 'bg-orange-50 border-2 border-orange-400'`,
    'adherence box color'
  );
  replaceOnce(
    `<p className="text-lg font-semibold text-gray-600">이번 달 복약률</p>`,
    `<p className="text-lg font-semibold text-gray-600">{isServerMode ? '이번 달 스마트 약통 복약률' : '이번 달 복약률 (수동 기록)'}</p>`,
    'adherence label'
  );
  replaceOnce(
    `            {adherence}%`,
    `            {adherence === null ? '—' : String(adherence) + '%'}`, 
    'adherence display'
  );
  replaceOnce(
    `adherence >= 80 ? 'text-green-700' : 'text-orange-600'`,
    `highAdherence ? 'text-green-700' : 'text-orange-600'`,
    'adherence text color'
  );
  replaceOnce(
    `            {adherence >= 80 ? '정말 잘 챙겨 드시고 있어요 👏' : '조금 더 꼼꼼하게 챙겨봐요 💪'}`,
    `            {isServerMode
              ? (adherence === null
                  ? '이번 달에는 아직 복용 시간이 지난 서버 일정이 없습니다.'
                  : '복용 시각이 지난 서버 일정 중 완료된 비율입니다. (수동 체크 미포함)')
              : (highAdherence ? '정말 잘 챙겨 드시고 있어요 👏' : '조금 더 꼼꼼하게 챙겨봐요 💪')}`, 
    'adherence description'
  );

  replaceOnce(
    '<DeviceCalendarPanel />',
    '<DeviceCalendarPanel onRecordsLoaded={setServerEntries} />',
    'server panel prop'
  );

  replaceOnce(
    `{status === 'miss' && <span className="text-xs leading-none">❌</span>}`,
    `{status === 'miss' && <span className="text-xs leading-none">❌</span>}
                  {status === 'scheduled' && <span className="text-xs leading-none text-blue-500" title="복약 일정 있음">●</span>}
                  {status === 'partial' && <span className="text-xs leading-none text-amber-600" title="일부 복용 완료">◐</span>}`, 
    'calendar dot rendering'
  );

  replaceOnce(
    `const allChecked = times.every(t => drugState?.checks[t] === true);`,
    `const allChecked = times.every(t => drugState?.checks[t] === true ||
                  isDeviceCompleted(med.drug_name_simple, todayKey, t));`,
    'medication card summary'
  );

  replaceOnce(
    `const isChecked = drugState?.checks[alertTime] === true;`,
    `const manualChecked = drugState?.checks[alertTime] === true;
                        const deviceChecked = isDeviceCompleted(med.drug_name_simple, todayKey, alertTime);
                        const isChecked = manualChecked || deviceChecked;`,
    'checkbox completed state'
  );

  replaceOnce(
    `                              checked={isChecked}
                              onChange={(e) =>`,
    `                              checked={isChecked}
                              disabled={deviceChecked}
                              onChange={(e) =>`,
    'checkbox disabled when server completed'
  );

  replaceOnce(
    `{isChecked && (
                              <span className="ml-auto text-sm font-semibold text-green-600">완료 ✓</span>
                            )}`,
    `{isChecked && (
                              <span className="ml-auto text-sm font-semibold text-green-600">
                                {deviceChecked ? '기기 완료 ✓' : '수동 완료 ✓'}
                              </span>
                            )}`, 
    'check source badge'
  );
} catch (error) {
  console.error('[STOP] ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

const backup = file + '.before-server-sync-v2.bak';
if (!existsSync(backup)) writeFileSync(backup, readFileSync(file));
writeFileSync(file, lineEnding === '\r\n' ? content.replace(/\n/g, '\r\n') : content, 'utf8');
console.log('[OK] src/app/calendar/page.tsx updated.');
console.log('[BACKUP] ' + backup);

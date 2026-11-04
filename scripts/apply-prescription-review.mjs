// 2026 학술제 약속: reviewed prescriptions before device publishing.
// Run from the root of Personal-Project: node scripts/apply-prescription-review.mjs
// Stops without writing if any of the expected code anchors changed.
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const paths = {
  result: resolve(root, 'src/app/result/page.tsx'),
  history: resolve(root, 'src/lib/historyStorage.ts'),
  panel: resolve(root, 'src/components/PrescriptionReviewPanel.tsx'),
};

if (!existsSync(paths.panel)) {
  console.error('[STOP] src/components/PrescriptionReviewPanel.tsx not found. Copy it first.');
  process.exit(1);
}
if (!existsSync(paths.result) || !existsSync(paths.history)) {
  console.error('[STOP] result/page.tsx or historyStorage.ts not found.');
  process.exit(1);
}

const files = [paths.result, paths.history];
const snapshots = new Map();
const lineEndings = new Map();
for (const p of files) {
  const bytes = readFileSync(p, 'utf8');
  snapshots.set(p, bytes.replace(/\r\n/g, '\n'));
  lineEndings.set(p, bytes.includes('\r\n') ? '\r\n' : '\n');
}

if (snapshots.get(paths.result).includes('PRESCRIPTION_REVIEW_V1')) {
  console.log('[SKIP] Review feature is already applied. No files changed.');
  process.exit(0);
}

function replaceOne(input, before, after, label) {
  const count = input.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`Could not find exactly one anchor: ${label} (found ${count})`);
  }
  return input.replace(before, after);
}

let result = snapshots.get(paths.result);
let history = snapshots.get(paths.history);
try {
  result = replaceOne(result,
    "import { saveHistory } from '@/lib/historyStorage';",
    "import { saveHistory, replaceHistoryMedications } from '@/lib/historyStorage';\nimport PrescriptionReviewPanel from '@/components/PrescriptionReviewPanel';",
    'import');

  result = replaceOne(result,
    "  const [isLoading, setIsLoading] = useState(true);",
    `  const [isLoading, setIsLoading] = useState(true);
  // PRESCRIPTION_REVIEW_V1: require explicit review before registration.
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const historyIdRef = useRef<string | null>(null);`,
    'review state');

  // Do not permanently save unreviewed AI text into history.
  result = replaceOne(result,
    "        // 히스토리 자동 저장 (처음 로드 시 1회)\n        saveHistory(parsed.data);",
    "        // AI 원문은 검토 전이므로 히스토리에 확정 저장하지 않습니다.",
    'unreviewed history save');

  result = replaceOne(result,
    "  // 브라우저 푸시 알람 설정 (ON 상태인 약만)\n  const handleBrowserAlarm = async () => {\n    if (!result?.data) return;",
    "  // 브라우저 푸시 알람 설정 (ON 상태인 약만)\n  const handleBrowserAlarm = async () => {\n    if (!reviewConfirmed) { window.alert('처방전 내용을 먼저 수정·확인하세요.'); return; }\n    if (!result?.data) return;",
    'browser notification guard');

  result = replaceOne(result,
    "  const handleTelegram = async () => {\n    if (!result?.data) return;",
    "  const handleTelegram = async () => {\n    if (!reviewConfirmed) { window.alert('처방전 내용을 먼저 수정·확인하세요.'); return; }\n    if (!result?.data) return;",
    'telegram button guard');

  result = replaceOne(result,
    "  // ── 로딩 ────────────────────────────────────────────────────",
    `  // PRESCRIPTION_REVIEW_V1: reviewed data becomes the single client-side source.
  const handleReviewedPrescription = (reviewed: Medication[]): boolean => {
    if (!result?.data) return false;
    const previous = result.data.medications;
    const next: AnalyzeResponse = {
      ...result,
      data: { ...result.data, medications: reviewed },
    };
    try {
      sessionStorage.setItem('yaksouk_result', JSON.stringify(next));
      const historyId = historyIdRef.current ?? saveHistory(next.data!);
      replaceHistoryMedications(historyId, next.data!);
      historyIdRef.current = historyId;
    } catch (error) {
      console.error('Failed to store reviewed prescription:', error);
      return false;
    }
    setAlarmEnabled(old => {
      const updated: Record<string, boolean> = {};
      reviewed.forEach((med, index) => {
        const oldName = previous[index]?.drug_name_simple;
        updated[med.drug_name_simple] = oldName ? old[oldName] !== false : true;
      });
      return updated;
    });
    if (browserAlarmSet) {
      notification.cancelAllAlerts();
      setBrowserAlarmSet(false);
    }
    setCardIndex(index => Math.min(index, reviewed.length - 1));
    setResult(next);
    setReviewConfirmed(true);
    return true;
  };

  // ── 로딩 ────────────────────────────────────────────────────`,
    'review handler insertion');

  result = replaceOne(result,
    "        {/* ── 2. 약품 카드 목록 ─────────────────────────── */}",
    `        <PrescriptionReviewPanel
          medications={data.medications}
          confirmed={reviewConfirmed}
          onDirty={() => setReviewConfirmed(false)}
          onConfirm={handleReviewedPrescription}
        />

        {/* ── 2. 약품 카드 목록 ─────────────────────────── */}`,
    'review panel insertion');

  result = replaceOne(result,
    `<DevicePublishPanel
  medications={data.medications.filter(
    m => alarmEnabled[m.drug_name_simple] !== false
  )}
/>`,
    `{reviewConfirmed ? (
          <DevicePublishPanel
            medications={data.medications.filter(
              m => alarmEnabled[m.drug_name_simple] !== false
            )}
          />
        ) : (
          <div className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5 text-sm font-semibold text-orange-900">
            스마트 약통 등록은 위의 처방전 정보를 수정·확인한 다음 사용할 수 있습니다.
          </div>
        )}`,
    'device publishing gate');

  result = replaceOne(result,
    "disabled={telegramState === 'sending' || telegramState === 'done'}",
    "disabled={!reviewConfirmed || telegramState === 'sending' || telegramState === 'done'}",
    'telegram disabled');
  result = replaceOne(result,
    "disabled={isSetting || browserAlarmSet}",
    "disabled={!reviewConfirmed || isSetting || browserAlarmSet}",
    'browser disabled');

  history = replaceOne(history,
    'export function getHistoryList(): PrescriptionHistory[] {',
    `// Update a history entry after the user reviews AI recognition.
export function replaceHistoryMedications(id: string, prescription: PrescriptionResult): void {
  if (typeof window === 'undefined') return;
  const items = getHistoryList();
  const index = items.findIndex(item => item.id === id);
  if (index === -1) throw new Error('History item not found');
  items[index] = {
    ...items[index],
    hospitalName: prescription.hospital || '병원 정보 없음',
    medications: prescription.medications,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function getHistoryList(): PrescriptionHistory[] {`,
    'history update helper');
} catch (e) {
  console.error('[STOP] ' + (e instanceof Error ? e.message : String(e)));
  console.error('[INFO] No files changed. Ensure you have the current GitHub version.');
  process.exit(1);
}

// All anchors verified. Save backups, then write; restore if write fails.
const nextByPath = new Map([[paths.result, result], [paths.history, history]]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backups = [];
try {
  for (const p of files) {
    const backup = `${p}.before-review-${timestamp}.bak`;
    copyFileSync(p, backup);
    backups.push([p, backup]);
  }
  for (const p of files) {
    const content = nextByPath.get(p).replace(/\n/g, lineEndings.get(p));
    const temporary = `${p}.review-tmp`;
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, p);
  }
  console.log('[OK] src/app/result/page.tsx updated.');
  console.log('[OK] src/lib/historyStorage.ts updated.');
  for (const [, backup] of backups) console.log('[BACKUP] ' + backup);
  console.log('[NEXT] npm.cmd run build');
} catch (e) {
  for (const [p, backup] of backups) {
    try { copyFileSync(backup, p); } catch { /* keep backups */ }
  }
  for (const p of files) {
    try { if (existsSync(`${p}.review-tmp`)) unlinkSync(`${p}.review-tmp`); } catch { /* ignore */ }
  }
  console.error('[ERROR] Write failed; original files restored where possible:', e);
  process.exit(1);
}

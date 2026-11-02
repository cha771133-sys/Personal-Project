// CALENDAR_WEB_COMPLETE_V3 — patch current v2 files only; no partial writes.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const edits = {
  "src/app/calendar/page.tsx": [
    {
      "old": "  const [serverEntries, setServerEntries] = useState<DeviceCalendarEntry[] | null>(null);\n",
      "new": "  const [serverEntries, setServerEntries] = useState<DeviceCalendarEntry[] | null>(null);\n  // CALENDAR_WEB_COMPLETE_V3: authenticated web completion shares the ESP32 Redis store.\n  const [serverToken, setServerToken] = useState(\"\");\n  const [serverRefreshVersion, setServerRefreshVersion] = useState(0);\n  const [savingOccurrenceId, setSavingOccurrenceId] = useState<string | null>(null);\n  const [serverWriteError, setServerWriteError] = useState(\"\");\n"
    },
    {
      "old": "  // 시간대별 체크 핸들러 — calendarData(달력 도트)도 함께 동기화\n",
      "new": "  // 서버 일정은 브라우저의 로컬 체크 대신 occurrenceId로 정확히 완료 처리합니다.\n  const completeServerOccurrence = useCallback(async (entry: DeviceCalendarEntry) => {\n    if (savingOccurrenceId !== null) return;\n    if (!serverToken) {\n      window.alert(\"먼저 관리자 토큰으로 서버 기록을 불러와 주세요.\");\n      return;\n    }\n    if (entry.status === \"completed\") return;\n    if (Date.parse(entry.scheduledAt) > Date.now()) {\n      window.alert(\"아직 복약 예정 시간이 되지 않았습니다.\");\n      return;\n    }\n    if (!window.confirm(`${entry.name} (${entry.scheduledAt.slice(0, 16).replace(\"T\", \" \")}) 복용을 완료하셨나요?\\n서버에 기록한 완료 상태는 이 화면에서 취소할 수 없습니다.`)) return;\n\n    setSavingOccurrenceId(entry.occurrenceId);\n    setServerWriteError(\"\");\n    try {\n      const response = await fetch(\"/api/device/calendar/complete\", {\n        method: \"POST\",\n        headers: {\n          \"Content-Type\": \"application/json\",\n          Authorization: `Bearer ${serverToken}`,\n        },\n        body: JSON.stringify({ occurrenceId: entry.occurrenceId }),\n        cache: \"no-store\",\n      });\n      const body: { error?: string; completedAt?: string; status?: string } = await response.json();\n      if (!response.ok || body.status !== \"completed\") {\n        throw new Error(body.error || `HTTP ${response.status}`);\n      }\n      // Only update the UI after server confirmation. Then re-read to verify.\n      setServerEntries(previous => previous?.map(record =>\n        record.occurrenceId === entry.occurrenceId\n          ? { ...record, status: \"completed\", completedAt: body.completedAt ?? null }\n          : record\n      ) ?? null);\n      setServerRefreshVersion(v => v + 1);\n      speak(`${entry.name} 복약 완료가 서버에 기록됐습니다.`);\n    } catch (error) {\n      setServerWriteError(error instanceof Error ? error.message : \"서버 저장 실패\");\n    } finally {\n      setSavingOccurrenceId(null);\n    }\n  }, [savingOccurrenceId, serverToken, speak]);\n\n  // 시간대별 체크 핸들러 — calendarData(달력 도트)도 함께 동기화\n"
    },
    {
      "old": "  ) => {\n    const newStates = toggleCheckState(checkStates, drugName, alertTime, checked);\n",
      "new": "  ) => {\n    const med = medications.find(m => m.drug_name === drugName);\n    const matches = serverEntries?.filter(entry =>\n      entry.name === med?.drug_name_simple &&\n      entry.scheduledAt.slice(0, 10) === todayKey &&\n      entry.scheduledAt.slice(11, 16) === alertTime\n    ) ?? [];\n    if (serverEntries !== null && matches.length > 0) {\n      if (!checked) {\n        window.alert(\"서버에 기록된 완료 상태는 이 화면에서 해제할 수 없습니다.\");\n        return;\n      }\n      if (matches.length !== 1) {\n        window.alert(\"일치하는 서버 복약 일정이 여러 개여서 완료 처리하지 않았습니다.\");\n        return;\n      }\n      void completeServerOccurrence(matches[0]);\n      return;\n    }\n    // 서버 일정과 일치하지 않는 체크는 기존처럼 브라우저에만 저장합니다.\n    const newStates = toggleCheckState(checkStates, drugName, alertTime, checked);\n"
    },
    {
      "old": "  }, [checkStates, todayKey, medications, speak]);\n",
      "new": "  }, [checkStates, todayKey, medications, speak, serverEntries, completeServerOccurrence]);\n"
    },
    {
      "old": "    return times.every(t => state?.checks[t] === true ||\n      isDeviceCompleted(med.drug_name_simple, todayKey, t));\n",
      "new": "    return times.every(t => {\n      const serverMatch = serverEntries?.find(e =>\n        e.name === med.drug_name_simple &&\n        e.scheduledAt.slice(0, 10) === todayKey && e.scheduledAt.slice(11, 16) === t\n      );\n      return serverMatch ? serverMatch.status === \"completed\" : state?.checks[t] === true;\n    });\n"
    },
    {
      "old": "        <DeviceCalendarPanel onRecordsLoaded={setServerEntries} />\n",
      "new": "        <DeviceCalendarPanel\n          onRecordsLoaded={setServerEntries}\n          onAuthorizedToken={setServerToken}\n          onCompleteRequest={(entry) => { void completeServerOccurrence(entry); }}\n          savingOccurrenceId={savingOccurrenceId}\n          refreshVersion={serverRefreshVersion}\n        />\n        {serverWriteError && (\n          <p role=\"alert\" className=\"rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700\">\n            웹 복용 완료 저장 실패: {serverWriteError}\n          </p>\n        )}\n"
    },
    {
      "old": "          <h2 className=\"text-xl font-bold text-gray-800\">\n            오늘 복약 체크 ({today.getMonth() + 1}/{today.getDate()})\n          </h2>\n",
      "new": "          <h2 className=\"text-xl font-bold text-gray-800\">\n            오늘 복약 체크 ({today.getMonth() + 1}/{today.getDate()})\n          </h2>\n          {serverEntries !== null && (\n            <p className=\"text-sm text-blue-800\">\n              스마트 약통에 등록된 약은 체크하면 Redis에도 기록됩니다.\n              그 외 체크는 현재 브라우저에만 저장됩니다. 서버 완료는 취소할 수 없습니다.\n            </p>\n          )}\n"
    },
    {
      "old": "                const allChecked = times.every(t => drugState?.checks[t] === true ||\n                  isDeviceCompleted(med.drug_name_simple, todayKey, t));\n",
      "new": "                const allChecked = times.every(t => {\n                  const serverMatch = serverEntries?.find(e =>\n                    e.name === med.drug_name_simple &&\n                    e.scheduledAt.slice(0, 10) === todayKey && e.scheduledAt.slice(11, 16) === t\n                  );\n                  return serverMatch ? serverMatch.status === \"completed\" : drugState?.checks[t] === true;\n                });\n"
    },
    {
      "old": "                        const manualChecked = drugState?.checks[alertTime] === true;\n                        const deviceChecked = isDeviceCompleted(med.drug_name_simple, todayKey, alertTime);\n                        const isChecked = manualChecked || deviceChecked;\n",
      "new": "                        const manualChecked = drugState?.checks[alertTime] === true;\n                        const serverMatch = serverEntries?.find(e =>\n                          e.name === med.drug_name_simple &&\n                          e.scheduledAt.slice(0, 10) === todayKey &&\n                          e.scheduledAt.slice(11, 16) === alertTime\n                        );\n                        const deviceChecked = serverMatch?.status === \"completed\";\n                        const isChecked = serverMatch ? deviceChecked : manualChecked;\n                        const notDue = serverMatch ? Date.parse(serverMatch.scheduledAt) > Date.now() : false;\n"
    },
    {
      "old": "                              disabled={deviceChecked}\n",
      "new": "                              disabled={deviceChecked || notDue || savingOccurrenceId !== null}\n"
    },
    {
      "old": "                                {deviceChecked ? '기기 완료 ✓' : '수동 완료 ✓'}\n",
      "new": "                                {deviceChecked ? '서버 완료 ✓' : '수동 완료(로컬) ✓'}\n"
    },
    {
      "old": "                            {isChecked && (\n                              <span className=\"ml-auto text-sm font-semibold text-green-600\">\n                                {deviceChecked ? '서버 완료 ✓' : '수동 완료(로컬) ✓'}\n                              </span>\n                            )}\n",
      "new": "                            {isChecked && (\n                              <span className=\"ml-auto text-sm font-semibold text-green-600\">\n                                {deviceChecked ? '서버 완료 ✓' : '수동 완료(로컬) ✓'}\n                              </span>\n                            )}\n                            {!isChecked && notDue && (\n                              <span className=\"ml-auto text-xs text-blue-600\">복약 예정</span>\n                            )}\n                            {!isChecked && serverMatch && !notDue && (\n                              <span className=\"ml-auto text-xs text-blue-700\">\n                                {savingOccurrenceId === serverMatch.occurrenceId ? '서버 저장 중...' : '서버 기록 대상'}\n                              </span>\n                            )}\n"
    },
    {
      "old": "  // Match by Korean calendar date, simple medication name, and time.\n  // The server view has no prescription/account ID yet; single-device demo only.\n  const isDeviceCompleted = useCallback((simpleName: string, day: string, time: string): boolean => {\n    return serverEntries?.some(entry =>\n      entry.name === simpleName &&\n      entry.scheduledAt.slice(0, 10) === day &&\n      entry.scheduledAt.slice(11, 16) === time &&\n      entry.status === 'completed'\n    ) ?? false;\n  }, [serverEntries]);\n\n",
      "new": ""
    }
  ],
  "src/components/DeviceCalendarPanel.tsx": [
    {
      "old": "import { useMemo, useState } from \"react\";\n",
      "new": "import { useEffect, useMemo, useState } from \"react\";\n"
    },
    {
      "old": "type Props = {\n  onRecordsLoaded?: (records: DeviceCalendarEntry[] | null) => void;\n};\n",
      "new": "type Props = {\n  onRecordsLoaded?: (records: DeviceCalendarEntry[] | null) => void;\n  onAuthorizedToken?: (token: string) => void;\n  onCompleteRequest?: (entry: DeviceCalendarEntry) => void;\n  savingOccurrenceId?: string | null;\n  refreshVersion?: number;\n};\n"
    },
    {
      "old": "export default function DeviceCalendarPanel({ onRecordsLoaded }: Props) {\n",
      "new": "export default function DeviceCalendarPanel({\n  onRecordsLoaded, onAuthorizedToken, onCompleteRequest,\n  savingOccurrenceId = null, refreshVersion = 0,\n}: Props) {\n"
    },
    {
      "old": "      setData(json);\n      onRecordsLoaded?.(json.medications);\n",
      "new": "      setData(json);\n      onRecordsLoaded?.(json.medications);\n      onAuthorizedToken?.(token);\n"
    },
    {
      "old": "      setData(null);\n      onRecordsLoaded?.(null); // 조회 실패 시 기존 서버 상태를 남겨두지 않음\n",
      "new": "      setData(null);\n      onRecordsLoaded?.(null); // 조회 실패 시 기존 서버 상태를 남겨두지 않음\n      onAuthorizedToken?.(\"\");\n"
    },
    {
      "old": "  const grouped = useMemo(() => {\n",
      "new": "  // After completing a dose, re-read Redis so the panel and calendar agree.\n  useEffect(() => {\n    if (refreshVersion === 0) return;\n    void loadFromServer();\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [refreshVersion]);\n\n  const grouped = useMemo(() => {\n"
    },
    {
      "old": "          서버 기록을 불러오면 달력의 날짜 표시와 오늘의 체크리스트에도\n          ESP32 완료 상태가 반영됩니다. 수동 체크는 브라우저에만 저장됩니다.\n",
      "new": "          서버 기록을 불러온 뒤, 복약 시간이 지난 일정은 웹에서도 완료 처리할 수 있습니다.\n          ESP32와 웹의 완료 상태는 같은 Redis 데이터에 저장됩니다.\n"
    },
    {
      "old": "        value={token} onChange={(e) => setToken(e.target.value)}\n",
      "new": "        value={token} onChange={(e) => {\n          setToken(e.target.value);\n          onAuthorizedToken?.(\"\");\n        }}\n"
    },
    {
      "old": "                    <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${\n                      item.status === \"completed\"\n                        ? \"bg-green-100 text-green-800\"\n                        : \"bg-amber-100 text-amber-800\"\n                    }`}>\n                      {item.status === \"completed\" ? \"복용 완료\" : \"미완료\"}\n                    </span>\n",
      "new": "                    <div className=\"flex shrink-0 flex-col items-end gap-2\">\n                      <span className={`rounded-lg px-2 py-1 text-xs font-bold ${\n                        item.status === \"completed\"\n                          ? \"bg-green-100 text-green-800\"\n                          : \"bg-amber-100 text-amber-800\"\n                      }`}>\n                        {item.status === \"completed\" ? \"복용 완료\" : \"미완료\"}\n                      </span>\n                      {item.status === \"pending\" && onCompleteRequest &&\n                        Date.parse(item.scheduledAt) <= Date.now() && (\n                          <button type=\"button\"\n                            disabled={savingOccurrenceId !== null}\n                            onClick={() => onCompleteRequest(item)}\n                            className=\"rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50\">\n                            {savingOccurrenceId === item.occurrenceId ? \"저장 중...\" : \"웹에서 복용 완료\"}\n                          </button>\n                      )}\n                    </div>\n"
    },
    {
      "old": "          <p className=\"text-xs text-gray-500\">\n            현재 Redis에 남아 있는 일정만 표시합니다. 새 처방전을 등록하면\n            기존 일정 목록과 완료 기록은 교체될 수 있습니다.\n          </p>\n",
      "new": "          <p className=\"text-xs text-gray-500\">\n            웹에서 완료 처리한 기록은 서버에 저장되며 취소할 수 없습니다.\n            새 처방전을 등록하면 기존 일정 목록과 완료 기록은 교체될 수 있습니다.\n          </p>\n"
    }
  ]
};
const marker = "CALENDAR_WEB_COMPLETE_V3";
const files = Object.keys(edits);
function replaceOne(content, before, after, label) {
  const first = content.indexOf(before);
  const second = first === -1 ? -1 : content.indexOf(before, first + before.length);
  if (first === -1 || second !== -1) {
    throw new Error(`[STOP] Expected exactly one match: ${label} (found ${first === -1 ? 0 : 2}+)`);
  }
  return content.slice(0, first) + after + content.slice(first + before.length);
}
const original = {};
for (const file of files) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) throw new Error(`[STOP] Missing ${file}. Start from latest deployed v2.`);
  original[file] = fs.readFileSync(full, "utf8");
}
if (files.every(file => original[file].includes(marker) ||
  (file.includes("DeviceCalendarPanel") && original[file].includes("onCompleteRequest?:")))) {
  console.log("[OK] Already applied. No files changed.");
  process.exit(0);
}
if (files.some(file => original[file].includes(marker))) {
  throw new Error("[STOP] Partial previous apply detected. No files changed.");
}
const updated = {};
// Build all changes in memory first. Abort without writes if any anchor differs.
for (const file of files) {
  let content = original[file].replace(/\r\n/g, "\n");
  for (const [index, change] of edits[file].entries()) {
    content = replaceOne(content, change.old, change.new, `${file} #${index+1}`);
  }
  updated[file] = content;
}
for (const file of files) {
  const full = path.join(ROOT, file);
  fs.writeFileSync(full + ".before-web-complete-v3.bak", original[file], "utf8");
}
for (const file of files) {
  fs.writeFileSync(path.join(ROOT, file), updated[file], "utf8");
  console.log(`[OK] ${file} updated. Backup saved.`);
}
console.log("[NEXT] npm.cmd run build");

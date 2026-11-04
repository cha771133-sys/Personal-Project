// 학술제 시제품 PILLBOX-001: 같은 시각 2건 알람 테스트.
// Node 20.6+: node --env-file=.env.local scripts/test-dual-alarm.mjs add|status|cleanup
// 기존 Redis 목록을 보존한 채 'demo-dual-' 2건만 추가/제거합니다.
// 실제 복약 데이터로 사용하지 마세요.
import { Redis } from '@upstash/redis';
import { randomBytes } from 'node:crypto';

const DEVICE_ID = 'PILLBOX-001';
const KEY = `device:${DEVICE_ID}:medications`;
const PREFIX = 'demo-dual-';
const action = process.argv[2] || 'status';

if (!['add', 'status', 'cleanup'].includes(action)) {
  console.error('Usage: node --env-file=.env.local scripts/test-dual-alarm.mjs add|status|cleanup');
  process.exit(1);
}
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error('[ERROR] .env.local에 UPSTASH_REDIS_REST_URL 및 UPSTASH_REDIS_REST_TOKEN이 필요합니다.');
  process.exit(1);
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ADD_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NO_SCHEDULE', '0', '0'} end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.medications) ~= 'table'
  or type(data.scheduleVersion) ~= 'number' then
  return {'INVALID_DATA', '0', '0'}
end
for _, item in ipairs(data.medications) do
  if type(item.occurrenceId) == 'string' and string.sub(item.occurrenceId, 1, 10) == 'demo-dual-' then
    return {'DEMO_EXISTS', tostring(data.scheduleVersion), tostring(#data.medications)}
  end
end
if #data.medications > 22 then
  return {'TOO_MANY', tostring(data.scheduleVersion), tostring(#data.medications)}
end
local at = ARGV[3]
local a = {
  occurrenceId = ARGV[1], medicationId = ARGV[4], name = 'DEMO A',
  dose = 'TEST ONLY', scheduledAt = at, status = 'pending'
}
local b = {
  occurrenceId = ARGV[2], medicationId = ARGV[4], name = 'DEMO B',
  dose = 'TEST ONLY', scheduledAt = at, status = 'pending'
}
table.insert(data.medications, a)
table.insert(data.medications, b)
table.sort(data.medications, function(x, y)
  if x.scheduledAt ~= y.scheduledAt then return x.scheduledAt < y.scheduledAt end
  return x.occurrenceId < y.occurrenceId
end)
data.scheduleVersion = data.scheduleVersion + 1
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return {'ADDED', tostring(data.scheduleVersion), tostring(#data.medications)}
`;

const CLEAN_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NO_SCHEDULE', '0', '0'} end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.medications) ~= 'table'
  or type(data.scheduleVersion) ~= 'number' then
  return {'INVALID_DATA', '0', '0'}
end
local demoCount = 0
local demoPending = 0
for _, item in ipairs(data.medications) do
  if type(item.occurrenceId) == 'string' and string.sub(item.occurrenceId, 1, 10) == 'demo-dual-' then
    demoCount = demoCount + 1
    if item.status ~= 'completed' then demoPending = demoPending + 1 end
  end
end
if demoCount == 0 then
  return {'NOTHING_TO_CLEAN', tostring(data.scheduleVersion), tostring(#data.medications)}
end
if demoPending > 0 then
  return {'STILL_PENDING', tostring(demoPending), tostring(demoCount)}
end
local preserved = {}
for _, item in ipairs(data.medications) do
  if type(item.occurrenceId) ~= 'string' or string.sub(item.occurrenceId, 1, 10) ~= 'demo-dual-' then
    table.insert(preserved, item)
  end
end
data.medications = preserved
data.scheduleVersion = data.scheduleVersion + 1
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return {'CLEANED', tostring(data.scheduleVersion), tostring(#preserved)}
`;

function showResult(r) {
  if (!Array.isArray(r) || r.length < 3) throw Error('예상하지 못한 Redis 응답');
  console.log(`[REDIS] ${String(r[0])} | scheduleVersion=${r[1]} | count/info=${r[2]}`);
  return String(r[0]);
}

function koreaDateTime(epochMs) {
  const s = new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return `${s}+09:00`;
}

async function main() {
  if (action === 'add') {
    // 현재 시간에서 4~5분 후의 한국 시간 기준 정각 분.
    const scheduledMs = Math.ceil((Date.now() + 4 * 60_000) / 60_000) * 60_000;
    const at = koreaDateTime(scheduledMs);
    const tag = randomBytes(5).toString('hex');
    const idBase = `${PREFIX}${tag}`;
    const result = await redis.eval(ADD_LUA, [KEY], [
      `${idBase}-A`, `${idBase}-B`, at, idBase,
    ]);
    const code = showResult(result);
    if (code !== 'ADDED') {
      console.error('[STOP] 추가하지 않았습니다. DEMO_EXISTS면 status로 기존 데모를 확인하세요.');
      process.exitCode = 1;
      return;
    }
    console.log(`[TEST] 동일 복약 시각 (KST): ${at}`);
    console.log(`[TEST] A: ${idBase}-A`);
    console.log(`[TEST] B: ${idBase}-B`);
    console.log('[INFO] 기존 실제/가상 복약 일정과 완료 상태는 보존됐습니다.');
    console.log('[NEXT] ESP32 시리얼 모니터에서 두 번의 [ALARM] DUE, 두 번의 [POST] SAVED를 확인하세요.');
    console.log('[NEXT] 완료 후 status를 확인하고 cleanup으로 데모 2건만 제거하세요.');
    return;
  }
  if (action === 'cleanup') {
    const code = showResult(await redis.eval(CLEAN_LUA, [KEY], []));
    if (code === 'STILL_PENDING') {
      console.error('[STOP] 데모 약이 아직 미완료입니다. 두 건의 [POST] SAVED 확인 후 정리하세요.');
      process.exitCode = 1;
    } else if (code === 'CLEANED') {
      console.log('[OK] demo-dual- 일정만 제거했습니다. 다른 일정과 완료 상태는 유지했습니다.');
    }
    return;
  }
  // status: 읽기 전용. 다른 약 이름, 환자 정보를 출력하지 않습니다.
  const stored = await redis.get(KEY);
  if (!stored) { console.log('[STATUS] 기기 복약 일정이 없습니다.'); return; }
  const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
  if (!parsed || !Array.isArray(parsed.medications)) throw Error('INVALID_STORED_DATA');
  const demo = parsed.medications.filter(e =>
    typeof e?.occurrenceId === 'string' && e.occurrenceId.startsWith(PREFIX));
  console.log(`[STATUS] device=${DEVICE_ID}, version=${parsed.scheduleVersion}, total=${parsed.medications.length}, demo=${demo.length}`);
  for (const entry of demo) {
    console.log(`[DEMO] ${entry.name} | ${entry.scheduledAt} | ${entry.status} | ${entry.occurrenceId}`);
  }
}

main().catch(e => {
  console.error('[ERROR]', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

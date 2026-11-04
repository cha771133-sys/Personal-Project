/**
 * YAKSOUK single-device resilience suite (demo schedules only).
 * Node >=20; run from project root:
 *   node --env-file=.env.local scripts/test-resilience.mjs setup
 *   node --env-file=.env.local scripts/test-resilience.mjs status
 *   node --env-file=.env.local scripts/test-resilience.mjs verify
 *   node --env-file=.env.local scripts/test-resilience.mjs cleanup
 */
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';

const DEVICE_ID = 'PILLBOX-001';
const MEDS_KEY = `device:${DEVICE_ID}:medications`;
const SESSION_KEY = `device:${DEVICE_ID}:resilience-test-session`;
const BASE_URL = (process.env.RESILIENCE_BASE_URL || 'https://personal-project-yctb.vercel.app').replace(/\/$/, '');
const PREFIX = 'demo-res-';
const KST_OFFSET = 9 * 60 * 60 * 1000;
const command = process.argv[2];
const validCommands = ['setup', 'status', 'verify', 'cleanup'];

if (!validCommands.includes(command)) {
  console.log('Usage: node --env-file=.env.local scripts/test-resilience.mjs <setup|status|verify|cleanup>');
  process.exit(1);
}
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error('[STOP] Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in .env.local');
  process.exit(1);
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ADD_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then return {'ACTIVE_TEST', '0', '0'} end
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NO_SCHEDULE', '0', '0'} end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.medications) ~= 'table' or type(data.scheduleVersion) ~= 'number' then
  return {'BAD_STORED_DATA', '0', '0'}
end
if #data.medications > 60 then return {'TOO_MANY_SCHEDULES', '0', '0'} end
for _, med in ipairs(data.medications) do
  if type(med.occurrenceId) == 'string' and string.sub(med.occurrenceId, 1, 9) == '${PREFIX}' then
    return {'ORPHAN_TEST_EXISTS', '0', '0'}
  end
end
local ok2, session = pcall(cjson.decode, ARGV[1])
if not ok2 or type(session) ~= 'table' or type(session.items) ~= 'table' or #session.items ~= 2 then
  return {'BAD_TEST_INPUT', '0', '0'}
end
for _, item in ipairs(session.items) do
  table.insert(data.medications, item)
end
table.sort(data.medications, function(a,b)
  return a.scheduledAt < b.scheduledAt or (a.scheduledAt == b.scheduledAt and a.occurrenceId < b.occurrenceId)
end)
data.scheduleVersion = data.scheduleVersion + 1
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
redis.call('SET', KEYS[2], ARGV[1])
return {'ADDED', tostring(data.scheduleVersion), tostring(#data.medications)}
`;

const REMOVE_LUA = `
local metaRaw = redis.call('GET', KEYS[2])
if not metaRaw then return {'NO_SESSION','0','0','0'} end
local okMeta, meta = pcall(cjson.decode, metaRaw)
if not okMeta or type(meta) ~= 'table' or type(meta.ids) ~= 'table' then return {'BAD_SESSION','0','0','0'} end
local raw = redis.call('GET', KEYS[1])
if not raw then return {'NO_SCHEDULE','0','0','0'} end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or type(data.medications) ~= 'table' or type(data.scheduleVersion) ~= 'number' then return {'BAD_STORED_DATA','0','0','0'} end
local removing = {}
for _, id in ipairs(meta.ids) do removing[id] = true end
local kept = {}
local removed = 0
for _, med in ipairs(data.medications) do
  if removing[med.occurrenceId] then removed = removed + 1 else table.insert(kept,med) end
end
if removed ~= #meta.ids then return {'COUNT_MISMATCH', tostring(removed), tostring(data.scheduleVersion), tostring(#data.medications)} end
data.medications = kept
data.scheduleVersion = data.scheduleVersion + 1
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
redis.call('DEL', KEYS[2])
return {'CLEANED', tostring(removed), tostring(data.scheduleVersion), tostring(#data.medications)}
`;

function evalResponse(raw, size) {
  if (!Array.isArray(raw) || raw.length !== size) throw new Error(`Unexpected Redis EVAL result: ${String(raw)}`);
  return raw.map(String);
}

function kstIso(utcMillis) {
  return new Date(utcMillis + KST_OFFSET).toISOString().replace('Z', '+09:00');
}
function futureMinute(mins) {
  const ts = Math.ceil((Date.now() + mins * 60_000) / 60_000) * 60_000;
  return kstIso(ts);
}
async function readSession() {
  return await redis.get(SESSION_KEY);
}
async function readStore() {
  const stored = await redis.get(MEDS_KEY);
  if (!stored || !Array.isArray(stored.medications) || !Number.isSafeInteger(stored.scheduleVersion)) {
    throw new Error('Missing/invalid Redis medications data');
  }
  return stored;
}
function getDemoEntries(store, session) {
  return session.ids.map(id => store.medications.find(m => m.occurrenceId === id) ?? null);
}
function printSchedule(store, session) {
  const items = getDemoEntries(store, session);
  console.log(`[STATUS] version=${store.scheduleVersion} total=${store.medications.length}`);
  items.forEach((m,i) => {
    console.log(`[${i===0?'WIFI':'REBOOT'}] ${m?.occurrenceId || session.ids[i]} | ${m?.status || 'NOT_FOUND'} | ${m?.scheduledAt || '?'} | completedAt=${m?.completedAt ?? '-'}`);
  });
  return items;
}
async function callComplete(occurrenceId) {
  const token = process.env.DEVICE_API_TOKEN;
  if (!token) return {skipped:true,why:'DEVICE_API_TOKEN missing in .env.local'};
  const response = await fetch(`${BASE_URL}/api/device/complete`, {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'},
    body:JSON.stringify({occurrenceId}),
    signal:AbortSignal.timeout(15000),
  });
  let body;
  try {body = await response.json();}catch{body={error:'INVALID_RESPONSE_BODY'}}
  return {status:response.status,body};
}

try {
  if (command === 'setup') {
    const stamp = randomUUID().replaceAll('-','').slice(0,10);
    const a = `${PREFIX}${stamp}-wifi`;
    const b = `${PREFIX}${stamp}-reboot`;
    const atA = futureMinute(6); // intentionally separate for sequential physical tests
    const atB = futureMinute(14);
    const items = [
      {occurrenceId:a, medicationId:`${PREFIX}${stamp}-wifi`, name:'DEMO WIFI TEST', dose:'TEST ONLY', scheduledAt:atA, status:'pending'},
      {occurrenceId:b, medicationId:`${PREFIX}${stamp}-reboot`, name:'DEMO REBOOT TEST', dose:'TEST ONLY', scheduledAt:atB, status:'pending'},
    ];
    const session = {createdAt:new Date().toISOString(),ids:[a,b],items, baselineCount:null};
    const out = evalResponse(await redis.eval(ADD_LUA,[MEDS_KEY,SESSION_KEY],[JSON.stringify(session)]),3);
    if(out[0]!=='ADDED'){
      console.error(`[STOP] ${out[0]} | No schedules changed.`);
      process.exitCode = 2;
    }else{
      console.log(`[ADDED] version=${out[1]} total=${out[2]} | 2 demo schedules added`);
      console.log(`[WIFI] ${atA}  /  ${a}`);
      console.log(`[REBOOT] ${atB}  /  ${b}`);
      console.log('[NEXT] Keep ESP32 online until it has fetched these two demo entries.');
      console.log('[NEXT] For WIFI: turn hotspot OFF before due, tap COMPLETE at alarm, turn hotspot ON again without reboot.');
      console.log('[NEXT] For REBOOT: turn hotspot OFF before due, tap COMPLETE, reboot ESP32 while offline, then turn hotspot ON.');
      console.log('[NOTE] If timing is missed, use cleanup and setup again.');
      console.log('[NOTE] Run this test only on a demo device; the added alarms are test-only.');
    }
  }
  else if(command === 'status'){
    const session = await readSession();
    if(!session){console.log('[STOP] No active resilience test session.');process.exitCode=2;}
    else printSchedule(await readStore(), session);
  }
  else if(command === 'verify'){
    const session = await readSession();
    if(!session){console.log('[STOP] No active resilience test session.');process.exitCode=2;}
    else {
      const before = await readStore();
      const items = printSchedule(before,session);
      if(items.some(m=>!m || m.status!=='completed' || !m.completedAt)){
        console.log('[WAIT] Both demo schedules must be completed before idempotency testing.');
        process.exitCode=2;
      }else{
        const result = await callComplete(session.ids[0]);
        if(result.skipped){console.log(`[SKIP] Duplicate HTTP check: ${result.why}`);}
        else {
          const after = await readStore();
          const updated=after.medications.find(m=>m.occurrenceId===session.ids[0]);
          const pass = result.status===200 && result.body?.alreadyCompleted===true &&
            result.body?.completedAt===items[0].completedAt &&
            after.scheduleVersion===before.scheduleVersion &&
            updated?.completedAt===items[0].completedAt;
          console.log(`[IDEMPOTENT] ${pass?'PASS':'FAIL'} HTTP=${result.status} alreadyCompleted=${result.body?.alreadyCompleted} versionBefore=${before.scheduleVersion} versionAfter=${after.scheduleVersion}`);
          if(!pass)process.exitCode=3;
        }
        console.log('[NOTE] WIFI/reboot endurance tests require confirming the ESP32 serial log. Redis status alone cannot prove the physical sequence.');
      }
    }
  }
  else if(command === 'cleanup'){
    const session = await readSession();
    if(!session){console.log('[STOP] No active session; nothing deleted.');process.exitCode=2;}
    else{
      const out=evalResponse(await redis.eval(REMOVE_LUA,[MEDS_KEY,SESSION_KEY],[]),4);
      if(out[0]!=='CLEANED'){console.log(`[STOP] ${out[0]}; no cleanup changes made.`);process.exitCode=3;}
      else{
        console.log(`[CLEANUP] removed=${out[1]} version=${out[2]} total=${out[3]}`);
        console.log('[OK] Only the two session-specific demo IDs were removed; other schedule entries were kept.');
        const afterCleanup = await readStore();
        const removedIdsAbsent = session.ids.every(id => !afterCleanup.medications.some(m => m.occurrenceId === id));
        if (!removedIdsAbsent) { console.log('[ERROR] Cleanup verification failed: demo IDs still present.'); process.exitCode=3; }
        const beforeStaleVersion = afterCleanup.scheduleVersion;
        const result=await callComplete(session.ids[0]);
        if(result.skipped){console.log(`[SKIP] Stale-ID HTTP check: ${result.why}`);}
        else{
          const afterStale = await readStore();
          const pass=result.status===404 && result.body?.error==='OCCURRENCE_NOT_FOUND' && afterStale.scheduleVersion===beforeStaleVersion;
          console.log(`[STALE-ID] ${pass?'PASS':'FAIL'} HTTP=${result.status} error=${result.body?.error??'-'} versionUnchanged=${afterStale.scheduleVersion===beforeStaleVersion}`);
          if(!pass)process.exitCode=3;
        }
      }
    }
  }
}catch(error){
  console.error('[ERROR]',error instanceof Error?error.message:String(error));
  process.exitCode=1;
}

#!/usr/bin/env node
// 기존 웹의 90초 데모 API를 유지하면서 ESP32 DEVICE_API_TOKEN 인증만 추가합니다.
// 입력 파일을 변경하기 전 모든 일치조건을 검사하고 .bak 파일을 생성합니다.
import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] ?? 'src/app/api/demo/start/route.ts');
if (!fs.existsSync(target)) { console.error('파일을 찾을 수 없습니다:', target); process.exit(1); }
let code = fs.readFileSync(target, 'utf8');
if (code.includes('const isDevice =') && code.includes('학술제 시연약 A')) {
  console.log('이미 적용되어 있습니다.'); process.exit(0);
}

function replaceOnce(oldText, newText, label) {
  const occurrences = code.split(oldText).length - 1;
  if (occurrences !== 1) throw new Error(`${label}: 패턴이 ${occurrences}건 발견됨. 파일을 변경하지 않았습니다.`);
  code = code.replace(oldText, newText);
}
replaceOnce(
`  const admin = process.env.DEVICE_PUBLISH_TOKEN;
  if (!admin || admin.length < 32) return fail("PUBLISH_TOKEN_NOT_CONFIGURED", 503);
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), admin)) {
    return fail("UNAUTHORIZED", 401);
  }`,
`  // 웹에서는 관리자 토큰, ESP32의 시연 버튼에서는 기존 장치 토큰을 사용합니다.
  // 관리자 토큰을 ESP32 펌웨어에 넣지 않습니다.
  const admin = process.env.DEVICE_PUBLISH_TOKEN;
  const device = process.env.DEVICE_API_TOKEN;
  if ((!admin || admin.length < 32) && !device) return fail("DEMO_AUTH_NOT_CONFIGURED", 503);
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const isAdmin = !!admin && admin.length >= 32 && safeEqual(token, admin);
  const isDevice = !!device && !!token && safeEqual(token, device);
  if (!isAdmin && !isDevice) return fail("UNAUTHORIZED", 401);`,
  '토큰 인증');
replaceOnce(
`  if (request.confirmed !== true || !validName(request.name) || !validName(request.dose)) {
    return fail("INVALID_DEMO_MEDICATION", 422);
  }
  const name = request.name.trim();
  const dose = request.dose.trim();`,
`  if (request.confirmed !== true || (!isDevice && (!validName(request.name) || !validName(request.dose)))) {
    return fail("INVALID_DEMO_MEDICATION", 422);
  }
  // 기기 요청은 서버에 정의된 비의료용 테스트 약만 사용합니다.
  // 웹 관리자 시연은 기존과 같이 최종 확인된 약 이름/복용량을 사용합니다.
  const name = isDevice ? "학술제 시연약 A" : (request.name as string).trim();
  const dose = isDevice ? "1정" : (request.dose as string).trim();`,
  '장치용 시연 약');
const backup = `${target}.before-lcd-demo.bak`;
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
fs.writeFileSync(target, code, 'utf8');
console.log('성공:', target);
console.log('원본 백업:', backup);

#!/usr/bin/env node
// ESP32 800x480 LCD UI에 90초 시연 시작 버튼을 추가합니다.
// 기존 약속 로고, 한글 폰트, Wi-Fi, 시계, Telegram 완료 기능은 수정하지 않습니다.
// 실행: node apply-lcd-demo.mjs "C:\\Users\\1504\\Desktop\\SmartPillBox_API\\SmartPillBox_API.ino"
import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(target)) { console.error('사용법: node apply-lcd-demo.mjs "스케치_전체경로.ino"'); process.exit(1); }
let code = fs.readFileSync(target, 'utf8');
if (code.includes('YAKSOUK_LCD_DEMO_V2')) { console.log('이미 적용되어 있습니다.'); process.exit(0); }
const nl = code.includes('\r\n') ? '\r\n' : '\n';
code = code.replace(/\r\n/g, '\n');
function replaceOnce(oldText, newText, label) {
  const count = code.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: 검색 패턴 ${count}건. 최신 코드와 다른 부분이 있으니 수정하지 않았습니다.`);
  code = code.replace(oldText, newText);
}

replaceOnce(
  'static volatile bool completeRequested = false;',
  `static volatile bool completeRequested = false;

// YAKSOUK_LCD_DEMO_V2 — LCD 단독 90초 시연 버튼 상태
static volatile bool demoStartRequested = false;
static bool demoRegistrationPending = false;
static bool demoSeenOnServer = false;
static lv_obj_t *demo_button = NULL;
static lv_obj_t *demo_button_label = NULL;
static unsigned long lastDemoCountdownMs = 0;`,
  '시연 전역 상태');
replaceOnce(
  'static int selectFollowingSchedule(int currentIdx);',
  `static int selectFollowingSchedule(int currentIdx);
static void updateDemoButtonUi();`,
  '함수 전방 선언');
replaceOnce(
  'static const unsigned long POST_RETRY_INTERVAL_MS = 15000UL;',
  `static const char *DEMO_START_API_URL =
    "https://personal-project-yctb.vercel.app/api/demo/start";
static const unsigned long POST_RETRY_INTERVAL_MS = 15000UL;`,
  '시연 API 주소');

// 시연 중에는 빠르게 조회하도록 5초 주기로 고정합니다.
if (/static const unsigned long API_POLL_INTERVAL_MS = 60000UL;/.test(code)) {
  replaceOnce('static const unsigned long API_POLL_INTERVAL_MS = 60000UL;',
              'static const unsigned long API_POLL_INTERVAL_MS = 5000UL;', '서버 조회 간격');
} else if (!/static const unsigned long API_POLL_INTERVAL_MS = 5000UL;/.test(code)) {
  throw new Error('API_POLL_INTERVAL_MS 간격이 예상과 다릅니다. 임의 수정하지 않았습니다.');
}

replaceOnce('static void fetchMedicationSchedule()\n{',
`// 시연 요청은 LVGL 이벤트가 아니라 Arduino loop에서 실행합니다.
static void showDemoMessage(const char *message)
{
    if (!lvgl_port_lock(1000)) return;
    if (status_label != NULL) lv_label_set_text(status_label, message);
    lvgl_port_unlock();
}

static bool isActiveDemoInRam()
{
    const time_t now = time(nullptr);
    for (int i = 0; i < scheduleCount; i++) {
        const PillSchedule &s = schedules[i];
        if (s.occurrenceId.startsWith("demo-") && s.status == "pending" &&
            !isLocallyCompleted(s.occurrenceId) && s.validTime &&
            now - s.epochUtc <= ALARM_GRACE_SECONDS + 30) return true;
    }
    return false;
}

static void updateDemoButtonUi()
{
    const bool busy = demoStartRequested || demoRegistrationPending ||
                      pendingPostCount > 0 || alarm_active || isActiveDemoInRam();
    if (!lvgl_port_lock(1000)) return;
    if (demo_button != NULL) {
        if (busy) lv_obj_add_state(demo_button, LV_STATE_DISABLED);
        else lv_obj_clear_state(demo_button, LV_STATE_DISABLED);
    }
    if (demo_button_label != NULL) {
        lv_label_set_text(demo_button_label, busy ? "시연 진행 중" : "90초 시연 시작");
    }
    lvgl_port_unlock();
}

static void fetchMedicationSchedule()
{`, '시연 UI 상태 함수');

replaceOnce('    dequeueFirstCompletion();\n    refreshMedicationScreen();',
`    dequeueFirstCompletion();
    if (id.startsWith("demo-")) demoRegistrationPending = false;
    refreshMedicationScreen();
    updateDemoButtonUi();`, '복용 완료 시 버튼 복구');

replaceOnce('    refreshMedicationScreen();\n\n    Serial.println("[API] GET SUCCESS!");',
`    refreshMedicationScreen();
    const bool activeDemo = isActiveDemoInRam();
    if (activeDemo) {
        demoRegistrationPending = true;
        demoSeenOnServer = true;
    } else if (demoSeenOnServer) {
        demoRegistrationPending = false;
    }
    updateDemoButtonUi();

    Serial.println("[API] GET SUCCESS!");`, '서버 조회 시 시연 상태 반영');

const cbAnchor = '// ======================================\n// 스마트 약통 LVGL 화면';
replaceOnce(cbAnchor,
`// 시연 버튼: 이 콜백에서는 네트워크를 호출하지 않습니다.
static void demo_btn_event_cb(lv_event_t *e)
{
    if (lv_event_get_code(e) != LV_EVENT_CLICKED || demoStartRequested ||
        demoRegistrationPending || alarm_active || pendingPostCount > 0) return;
    demoStartRequested = true;
    if (demo_button != NULL) lv_obj_add_state(demo_button, LV_STATE_DISABLED);
    if (demo_button_label != NULL) lv_label_set_text(demo_button_label, "등록 중");
    if (status_label != NULL) lv_label_set_text(status_label, "90초 시연 예약 요청 중");
    Serial.println("[DEMO] LCD button pressed.");
}

${cbAnchor}`, '시연 버튼 이벤트');

const oldButton = `    complete_button = lv_btn_create(screen);
    lv_obj_set_pos(complete_button, 22, 393);
    lv_obj_set_size(complete_button, 755, 70);
    lv_obj_set_style_radius(complete_button, 17, 0);
    lv_obj_set_style_bg_color(complete_button, lv_color_hex(0x246CD5), 0);
    lv_obj_set_style_bg_color(complete_button, lv_color_hex(0x9EB6CE), LV_STATE_DISABLED);
    lv_obj_set_style_bg_color(complete_button, lv_color_hex(0x1555B4), LV_STATE_PRESSED);
    lv_obj_set_style_border_width(complete_button, 0, 0);
    lv_obj_set_style_shadow_width(complete_button, 0, 0);
    lv_obj_add_state(complete_button, LV_STATE_DISABLED);
    lv_obj_add_event_cb(complete_button, btn_event_cb, LV_EVENT_CLICKED, NULL);

    button_label = lv_label_create(complete_button);
    lv_obj_set_style_text_font(button_label, &lv_font_korean_28, 0);
    lv_obj_set_style_text_color(button_label, lv_color_white(), 0);
    lv_label_set_text(button_label, "복용 완료");
    lv_obj_center(button_label);`;
const newButton = `    // 90초 시연 시작 (왼쪽) / 복용 완료 (오른쪽)
    demo_button = lv_btn_create(screen);
    lv_obj_set_pos(demo_button, 22, 393);
    lv_obj_set_size(demo_button, 359, 70);
    lv_obj_set_style_radius(demo_button, 17, 0);
    lv_obj_set_style_bg_color(demo_button, lv_color_hex(0xE87626), 0);
    lv_obj_set_style_bg_color(demo_button, lv_color_hex(0xAEBBCA), LV_STATE_DISABLED);
    lv_obj_set_style_bg_color(demo_button, lv_color_hex(0xB95310), LV_STATE_PRESSED);
    lv_obj_set_style_border_width(demo_button, 0, 0);
    lv_obj_set_style_shadow_width(demo_button, 0, 0);
    lv_obj_add_event_cb(demo_button, demo_btn_event_cb, LV_EVENT_CLICKED, NULL);
    demo_button_label = lv_label_create(demo_button);
    lv_obj_set_style_text_font(demo_button_label, &lv_font_korean_28, 0);
    lv_obj_set_style_text_color(demo_button_label, lv_color_white(), 0);
    lv_label_set_text(demo_button_label, "90초 시연 시작");
    lv_obj_center(demo_button_label);

    complete_button = lv_btn_create(screen);
    lv_obj_set_pos(complete_button, 398, 393);
    lv_obj_set_size(complete_button, 379, 70);
    lv_obj_set_style_radius(complete_button, 17, 0);
    lv_obj_set_style_bg_color(complete_button, lv_color_hex(0x246CD5), 0);
    lv_obj_set_style_bg_color(complete_button, lv_color_hex(0x9EB6CE), LV_STATE_DISABLED);
    lv_obj_set_style_bg_color(complete_button, lv_color_hex(0x1555B4), LV_STATE_PRESSED);
    lv_obj_set_style_border_width(complete_button, 0, 0);
    lv_obj_set_style_shadow_width(complete_button, 0, 0);
    lv_obj_add_state(complete_button, LV_STATE_DISABLED);
    lv_obj_add_event_cb(complete_button, btn_event_cb, LV_EVENT_CLICKED, NULL);

    button_label = lv_label_create(complete_button);
    lv_obj_set_style_text_font(button_label, &lv_font_korean_28, 0);
    lv_obj_set_style_text_color(button_label, lv_color_white(), 0);
    lv_label_set_text(button_label, "복용 완료");
    lv_obj_center(button_label);`;
replaceOnce(oldButton, newButton, '하단 버튼 2분할');

replaceOnce('void loop()\n{',
`// LCD 버튼을 누른 뒤 서버에 시연 일정 1건과 Telegram 1회 알림을 예약합니다.
static void startDemoFromLcd()
{
    if (WiFi.status() != WL_CONNECTED || time(nullptr) < 1700000000) {
        showDemoMessage("Wi-Fi 또는 시간 동기화 확인");
        updateDemoButtonUi();
        return;
    }
    WiFiClientSecure secureClient;
    secureClient.setCACert(LETS_ENCRYPT_CA_CERTS);
    secureClient.setTimeout(12000);
    HTTPClient http;
    if (!http.begin(secureClient, DEMO_START_API_URL)) {
        Serial.println("[DEMO] HTTPS begin failed.");
        showDemoMessage("서버 연결 실패");
        updateDemoButtonUi();
        return;
    }
    http.setConnectTimeout(10000);
    http.setTimeout(12000);
    http.addHeader("Authorization", String("Bearer ") + DEVICE_API_TOKEN);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Accept", "application/json");
    // 장치 토큰 요청은 서버에서 '학술제 시연약 A / 1정'으로 강제합니다.
    const int code = http.POST("{\\"confirmed\\":true}");
    const String response = (code > 0) ? http.getString() : "";
    http.end();
    Serial.printf("[DEMO] HTTP status: %d\\n", code);
    if (code != HTTP_CODE_OK) {
        Serial.printf("[DEMO] Registration failed: %s\\n", response.c_str());
        showDemoMessage(code == 409 ? "기존 시연 확인 또는 일정 초과" : "90초 시연 등록 실패");
        updateDemoButtonUi();
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, response) || !(doc["success"] | false) ||
        !doc["occurrenceId"].is<const char *>()) {
        Serial.println("[DEMO] Invalid success JSON.");
        showDemoMessage("시연 응답 확인 실패");
        updateDemoButtonUi();
        return;
    }
    demoRegistrationPending = true;
    Serial.printf("[DEMO] STARTED: %s, at %s\\n",
                  doc["occurrenceId"].as<const char *>(),
                  doc["scheduledAt"] | "(unknown)");
    showDemoMessage("90초 뒤 시연 알람 예정");
    updateDemoButtonUi();
    // 새 일정을 즉시 화면에 반영합니다. 실패하면 다음 5초 GET에서 다시 시도합니다.
    fetchMedicationSchedule();
}

static void updateDemoCountdown()
{
    if (millis() - lastDemoCountdownMs < 1000UL) return;
    lastDemoCountdownMs = millis();
    if (alarm_active || !demoRegistrationPending || pendingPostCount > 0) return;
    const time_t now = time(nullptr);
    for (int i = 0; i < scheduleCount; i++) {
        const PillSchedule &s = schedules[i];
        if (!s.occurrenceId.startsWith("demo-") || s.status != "pending" ||
            !s.validTime || isLocallyCompleted(s.occurrenceId)) continue;
        const long remain = (long)(s.epochUtc - now);
        if (remain <= 0 || remain > 180) continue;
        char text[72];
        snprintf(text, sizeof(text), "시연 알람까지 %ld초", remain);
        showDemoMessage(text);
        break;
    }
}

void loop()
{`, '시연 HTTP 요청 함수 및 카운트다운');

replaceOnce('    handleLocalCompleteRequest();',
`    handleLocalCompleteRequest();

    // 터치 이벤트는 플래그만 세팅하고 네트워크는 메인 loop에서 실행합니다.
    if (demoStartRequested) {
        demoStartRequested = false;
        if (!alarm_active && !demoRegistrationPending && pendingPostCount == 0) {
            startDemoFromLcd();
        } else {
            showDemoMessage("기존 복약 처리 후 시연 가능");
            updateDemoButtonUi();
        }
    }`, '메인 루프 버튼 처리');
replaceOnce('    checkScheduledAlarm();\n    delay(200);',
`    checkScheduledAlarm();
    updateDemoCountdown();
    delay(200);`, '메인 루프 시연 카운트다운');

const backup = `${target}.before-lcd-one-touch.bak`;
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
fs.writeFileSync(target, code.replace(/\n/g, nl), 'utf8');
console.log('LCD 시연 버튼 패치 완료:', target);
console.log('백업:', backup);

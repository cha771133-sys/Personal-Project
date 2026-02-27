// chatId 없이 호출 → API 서버의 TELEGRAM_CHAT_ID(복약자 본인)로 전송
export async function notifyPatientCheck(
  drugName: string,
  alertTime: string,
  checked: boolean
): Promise<void> {
  try {
    const message = checked
      ? `✅ [복약 완료] ${drugName} ${alertTime} 복용을 완료했습니다.`
      : `⚠️ [복약 취소] ${drugName} ${alertTime} 복용이 취소되었습니다.`;

    fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch(() => {/* silent fail */});
  } catch {
    // never throw
  }
}

export async function notifyGuardianCheck(
  drugName: string,
  alertTime: string,
  checked: boolean
): Promise<void> {
  try {
    const guardianChatId = localStorage.getItem('guardian_chat_id');
    if (!guardianChatId) return;

    const message = checked
      ? `✅ [복약 완료] ${drugName} ${alertTime} 복용을 완료했습니다.`
      : `⚠️ [복약 취소] ${drugName} ${alertTime} 복용이 취소되었습니다.`;

    // fire and forget — do not await in caller
    fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: guardianChatId, message }),
    }).catch(() => {/* silent fail */});
  } catch {
    // never throw
  }
}

export function getTimeLabel(time: string): string {
  const hour = parseInt(time.split(':')[0], 10);
  if (hour >= 5  && hour < 11) return '아침';
  if (hour >= 11 && hour < 14) return '점심';
  if (hour >= 14 && hour < 19) return '저녁';
  return '취침 전';
}

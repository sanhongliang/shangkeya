// EXPORTS: WEEKDAY_LABELS, START_HOURS, START_MINUTES, DURATIONS, SCHEDULE_MODES, TIME_OPTIONS
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const START_HOURS = Array.from({ length: 24 }, (_, i) => i);
export const START_MINUTES = [0, 10, 20, 30, 40, 50];
export const DURATIONS = [30, 40, 60, 90, 120];
export const SCHEDULE_MODES = ['连续多周', '连续多天'] as const;
export const TIME_OPTIONS: string[] = [];
for (const h of START_HOURS) {
  for (const m of START_MINUTES) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

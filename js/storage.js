const STORAGE_KEY = "yt_alarm_alarms_v1";

export function loadAlarms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.alarms) ? parsed.alarms : [];
  } catch {
    return [];
  }
}

export function saveAlarms(alarms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ alarms }));
}

export function createAlarm(data) {
  return {
    id: crypto.randomUUID().slice(0, 8),
    hour: data.hour,
    minute: data.minute,
    second: data.second ?? 0,
    label: data.label || "Alarm",
    youtubeUrl: data.youtubeUrl,
    enabled: true,
    repeatDaily: data.repeatDaily ?? true,
    volumePercent: data.volumePercent ?? 20,
    lastTriggered: null,
    snoozeUntil: null,
    lastFiredKey: null,
  };
}

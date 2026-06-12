export function timeLabel(alarm) {
  return `${pad(alarm.hour)}:${pad(alarm.minute)}:${pad(alarm.second ?? 0)}`;
}

export function nextFire(alarm, now = new Date()) {
  if (alarm.snoozeUntil) {
    const snoozeAt = new Date(alarm.snoozeUntil);
    if (snoozeAt > now) return snoozeAt;
  }

  const candidate = new Date(now);
  candidate.setHours(alarm.hour, alarm.minute, alarm.second ?? 0, 0);
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

export function secondsUntil(alarm, now = new Date()) {
  const delta = nextFire(alarm, now) - now;
  return Math.max(0, Math.floor(delta / 1000));
}

export function shouldFire(alarm, now = new Date()) {
  if (!alarm.enabled) return false;

  if (alarm.snoozeUntil) {
    const target = new Date(alarm.snoozeUntil);
    if (now >= target) {
      const fireKey = `snooze:${alarm.snoozeUntil}`;
      return alarm.lastFiredKey !== fireKey;
    }
    return false;
  }

  if (
    now.getHours() !== alarm.hour ||
    now.getMinutes() !== alarm.minute ||
    now.getSeconds() !== (alarm.second ?? 0)
  ) {
    return false;
  }

  const stamp = now.toISOString().slice(0, 10);
  return alarm.lastTriggered !== stamp;
}

export function markTriggered(alarm, now = new Date()) {
  if (alarm.snoozeUntil) {
    alarm.lastFiredKey = `snooze:${alarm.snoozeUntil}`;
    alarm.snoozeUntil = null;
    return;
  }

  alarm.lastTriggered = now.toISOString().slice(0, 10);
  if (!alarm.repeatDaily) {
    alarm.enabled = false;
  }
}

export function snoozeAlarm(alarm, minutes = 10) {
  const fireAt = new Date(Date.now() + minutes * 60 * 1000);
  fireAt.setMilliseconds(0);
  alarm.snoozeUntil = fireAt.toISOString();
  alarm.enabled = true;
}

export function formatCountdown(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) return `Rings in ${hours}h ${minutes}m`;
  if (minutes) return `Rings in ${minutes}m ${secs}s`;
  return `Rings in ${secs}s`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

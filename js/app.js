import { createAlarm, loadAlarms, saveAlarms } from "./storage.js";
import {
  formatCountdown,
  markTriggered,
  nextFire,
  secondsUntil,
  shouldFire,
  snoozeAlarm,
  timeLabel,
} from "./alarms.js";
import { fetchAudioUrl, isYoutubeUrl } from "./youtube.js";

const SNOOZE_MINUTES = 10;
const VOLUME_RAMP_SECONDS = 10;
const audioCache = new Map();

let alarms = loadAlarms();
let ringingAlarm = null;
let audio = null;
let rampTimer = null;
let editingId = null;

const els = {
  clock: document.getElementById("clock"),
  date: document.getElementById("date"),
  hour: document.getElementById("hour"),
  minute: document.getElementById("minute"),
  second: document.getElementById("second"),
  label: document.getElementById("label"),
  youtubeUrl: document.getElementById("youtube-url"),
  volume: document.getElementById("volume"),
  repeatDaily: document.getElementById("repeat-daily"),
  status: document.getElementById("status"),
  alarmList: document.getElementById("alarm-list"),
  ringOverlay: document.getElementById("ring-overlay"),
  ringTitle: document.getElementById("ring-title"),
  ringTime: document.getElementById("ring-time"),
  ringUrl: document.getElementById("ring-url"),
  editModal: document.getElementById("edit-modal"),
  editHour: document.getElementById("edit-hour"),
  editMinute: document.getElementById("edit-minute"),
  editSecond: document.getElementById("edit-second"),
  editLabel: document.getElementById("edit-label"),
  editUrl: document.getElementById("edit-url"),
  editVolume: document.getElementById("edit-volume"),
  editRepeat: document.getElementById("edit-repeat"),
  installBanner: document.getElementById("install-banner"),
};

document.getElementById("preview-btn").addEventListener("click", previewSound);
document.getElementById("add-btn").addEventListener("click", addAlarm);
document.getElementById("snooze-btn").addEventListener("click", () => stopRinging(true));
document.getElementById("stop-btn").addEventListener("click", () => stopRinging(false));
document.getElementById("edit-cancel").addEventListener("click", closeEditModal);
document.getElementById("edit-save").addEventListener("click", saveEdit);
document.getElementById("edit-preview").addEventListener("click", previewEditSound);

init();

function init() {
  setDefaultTime();
  renderAlarms();
  updateClock();
  setInterval(tick, 1000);
  registerServiceWorker();
  setupInstallBanner();
  requestPermissions().then(syncNativeNotifications);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncNativeNotifications();
    }
  });
}

function setDefaultTime() {
  const now = new Date();
  els.hour.value = pad(now.getHours());
  els.minute.value = pad(now.getMinutes());
  els.second.value = pad(now.getSeconds());
}

function updateClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  els.date.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  renderCountdowns();
}

function tick() {
  updateClock();
  const now = new Date();
  for (const alarm of [...alarms]) {
    if (shouldFire(alarm, now)) {
      markTriggered(alarm, now);
      persist();
      startRinging(alarm);
      syncNativeNotifications();
      break;
    }
  }
}

function parseTime(hourEl, minuteEl, secondEl) {
  const hour = Number(hourEl.value);
  const minute = Number(minuteEl.value);
  const second = Number(secondEl.value);
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new Error("Time must be in 24-hour format (00:00:00 to 23:59:59).");
  }
  return { hour, minute, second };
}

function parseVolume(value) {
  const volume = Number(value);
  if (Number.isNaN(volume) || volume < 0 || volume > 100) {
    throw new Error("Volume must be between 0 and 100.");
  }
  return volume;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

async function getCachedAudio(url) {
  if (audioCache.has(url)) {
    return audioCache.get(url);
  }
  const audioUrl = await fetchAudioUrl(url);
  audioCache.set(url, audioUrl);
  return audioUrl;
}

async function previewSound() {
  try {
    const url = els.youtubeUrl.value.trim();
    if (!isYoutubeUrl(url)) throw new Error("Please enter a valid YouTube URL.");
    setStatus("Preparing preview...");
    const audioUrl = await getCachedAudio(url);
    await playAudio(audioUrl, Number(els.volume.value) || 20, false);
    setStatus("Playing preview.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function addAlarm() {
  try {
    const { hour, minute, second } = parseTime(els.hour, els.minute, els.second);
    const youtubeUrl = els.youtubeUrl.value.trim();
    if (!isYoutubeUrl(youtubeUrl)) throw new Error("Please enter a valid YouTube URL.");
    const volumePercent = parseVolume(els.volume.value);
    const label = els.label.value.trim() || "Alarm";
    setStatus("Downloading alarm sound...");
    await getCachedAudio(youtubeUrl);
    alarms.push(
      createAlarm({
        hour,
        minute,
        second,
        label,
        youtubeUrl,
        repeatDaily: els.repeatDaily.checked,
        volumePercent,
      })
    );
    persist();
    syncNativeNotifications();
    els.label.value = "";
    setStatus(`Alarm set for ${pad(hour)}:${pad(minute)}:${pad(second)} — ${label}`);
    renderAlarms();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderAlarms() {
  if (!alarms.length) {
    els.alarmList.innerHTML = '<p class="empty">No alarms yet. Add one above.</p>';
    return;
  }

  const sorted = [...alarms].sort((a, b) => {
    if (a.hour !== b.hour) return a.hour - b.hour;
    if (a.minute !== b.minute) return a.minute - b.minute;
    return (a.second ?? 0) - (b.second ?? 0);
  });

  els.alarmList.innerHTML = sorted
    .map((alarm) => {
      const meta = `${alarm.repeatDaily ? "Daily" : "One-time"} • ${alarm.enabled ? "Enabled" : "Disabled"} • ${alarm.volumePercent}%`;
      const snooze =
        alarm.snoozeUntil && new Date(alarm.snoozeUntil) > new Date()
          ? ` • Snooze ${new Date(alarm.snoozeUntil).toLocaleTimeString([], { hour12: false })}`
          : "";
      const countdown = alarm.enabled ? formatCountdown(secondsUntil(alarm)) : "Disabled";
      const url = alarm.youtubeUrl.length > 48 ? `${alarm.youtubeUrl.slice(0, 45)}...` : alarm.youtubeUrl;
      return `
        <article class="alarm-card" data-id="${alarm.id}">
          <h3>${timeLabel(alarm)} • ${escapeHtml(alarm.label)}</h3>
          <p class="alarm-meta">${meta}${snooze}</p>
          <p class="alarm-countdown">${countdown}</p>
          <p class="alarm-url">${escapeHtml(url)}</p>
          <div class="card-actions">
            <button data-action="toggle">${alarm.enabled ? "Disable" : "Enable"}</button>
            <button data-action="edit">Edit</button>
            <button class="danger" data-action="delete">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.alarmList.querySelectorAll(".alarm-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-action="toggle"]').addEventListener("click", () => toggleAlarm(id));
    card.querySelector('[data-action="edit"]').addEventListener("click", () => openEditModal(id));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAlarm(id));
  });
}

function renderCountdowns() {
  document.querySelectorAll(".alarm-card").forEach((card) => {
    const alarm = alarms.find((item) => item.id === card.dataset.id);
    const countdownEl = card.querySelector(".alarm-countdown");
    if (!alarm || !countdownEl) return;
    countdownEl.textContent = alarm.enabled ? formatCountdown(secondsUntil(alarm)) : "Disabled";
  });
}

function toggleAlarm(id) {
  const alarm = alarms.find((item) => item.id === id);
  if (!alarm) return;
  alarm.enabled = !alarm.enabled;
  persist();
  syncNativeNotifications();
  renderAlarms();
}

function deleteAlarm(id) {
  alarms = alarms.filter((item) => item.id !== id);
  persist();
  syncNativeNotifications();
  renderAlarms();
}

function openEditModal(id) {
  const alarm = alarms.find((item) => item.id === id);
  if (!alarm) return;
  editingId = id;
  els.editHour.value = pad(alarm.hour);
  els.editMinute.value = pad(alarm.minute);
  els.editSecond.value = pad(alarm.second ?? 0);
  els.editLabel.value = alarm.label;
  els.editUrl.value = alarm.youtubeUrl;
  els.editVolume.value = alarm.volumePercent;
  els.editRepeat.checked = alarm.repeatDaily;
  els.editModal.classList.add("show");
}

function closeEditModal() {
  editingId = null;
  els.editModal.classList.remove("show");
}

async function saveEdit() {
  const alarm = alarms.find((item) => item.id === editingId);
  if (!alarm) return;
  try {
    const { hour, minute, second } = parseTime(els.editHour, els.editMinute, els.editSecond);
    const youtubeUrl = els.editUrl.value.trim();
    if (!isYoutubeUrl(youtubeUrl)) throw new Error("Please enter a valid YouTube URL.");
    const volumePercent = parseVolume(els.editVolume.value);
    const label = els.editLabel.value.trim() || "Alarm";
    const timeChanged =
      alarm.hour !== hour || alarm.minute !== minute || (alarm.second ?? 0) !== second;
    if (youtubeUrl !== alarm.youtubeUrl) {
      setStatus("Downloading alarm sound...");
      await getCachedAudio(youtubeUrl);
    }
    alarm.hour = hour;
    alarm.minute = minute;
    alarm.second = second;
    alarm.label = label;
    alarm.youtubeUrl = youtubeUrl;
    alarm.volumePercent = volumePercent;
    alarm.repeatDaily = els.editRepeat.checked;
    if (timeChanged) {
      alarm.lastTriggered = null;
      alarm.snoozeUntil = null;
      alarm.lastFiredKey = null;
    }
    persist();
    syncNativeNotifications();
    renderAlarms();
    closeEditModal();
    setStatus(`Updated alarm: ${timeLabel(alarm)} — ${alarm.label}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function previewEditSound() {
  try {
    const url = els.editUrl.value.trim();
    if (!isYoutubeUrl(url)) throw new Error("Please enter a valid YouTube URL.");
    setStatus("Preparing preview...");
    const audioUrl = await getCachedAudio(url);
    await playAudio(audioUrl, Number(els.editVolume.value) || 20, false);
    setStatus("Playing preview.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function startRinging(alarm) {
  ringingAlarm = alarm;
  els.ringTitle.textContent = alarm.label;
  els.ringTime.textContent = timeLabel(alarm);
  els.ringUrl.textContent = alarm.youtubeUrl;
  els.ringOverlay.classList.add("show");
  setStatus(`Alarm ringing: ${alarm.label}`);

  try {
    const audioUrl = await getCachedAudio(alarm.youtubeUrl);
    await playAudio(audioUrl, alarm.volumePercent, true);
  } catch (error) {
    setStatus(`Alarm sound error: ${error.message}`, true);
  }
}

function stopRinging(snooze) {
  stopAudio();
  els.ringOverlay.classList.remove("show");
  if (snooze && ringingAlarm) {
    snoozeAlarm(ringingAlarm, SNOOZE_MINUTES);
    persist();
    syncNativeNotifications();
    renderAlarms();
    setStatus(`Snoozed for ${SNOOZE_MINUTES} minutes.`);
  }
  ringingAlarm = null;
}

async function playAudio(url, targetPercent, loop) {
  stopAudio();
  audio = new Audio(url);
  audio.loop = loop;
  const target = Math.max(0, Math.min(1, targetPercent / 100));
  audio.volume = 0;
  await audio.play();

  const steps = 100;
  const interval = (VOLUME_RAMP_SECONDS * 1000) / steps;
  let step = 0;
  rampTimer = setInterval(() => {
    step += 1;
    audio.volume = target * (step / steps);
    if (step >= steps) {
      clearInterval(rampTimer);
      rampTimer = null;
    }
  }, interval);
}

function stopAudio() {
  if (rampTimer) {
    clearInterval(rampTimer);
    rampTimer = null;
  }
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
}

function persist() {
  saveAlarms(alarms);
}

function notificationId(alarmId) {
  let hash = 0;
  for (const char of alarmId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }
  return hash + 1;
}

async function requestPermissions() {
  const plugin = getNotificationsPlugin();
  if (!plugin) return;
  try {
    await plugin.requestPermissions();
  } catch {
    // Web/PWA may not support native permissions.
  }
}

async function syncNativeNotifications() {
  const plugin = getNotificationsPlugin();
  if (!plugin) return;

  try {
    const pending = await plugin.getPending();
    const ids = (pending.notifications || []).map((item) => item.id);
    if (ids.length) {
      await plugin.cancel({ notifications: ids.map((id) => ({ id })) });
    }

    const notifications = alarms
      .filter((alarm) => alarm.enabled)
      .map((alarm) => {
        const at = nextFire(alarm);
        return {
          id: notificationId(alarm.id),
          title: "YouTube Alarm",
          body: `${timeLabel(alarm)} — ${alarm.label}`,
          schedule: {
            at,
            repeats: alarm.repeatDaily,
            every: alarm.repeatDaily ? "day" : undefined,
          },
          extra: { alarmId: alarm.id },
        };
      });

    if (notifications.length) {
      await plugin.schedule({ notifications });
    }
  } catch {
    // Notifications are optional when running as a plain web page.
  }
}

function getNotificationsPlugin() {
  return window.Capacitor?.Plugins?.LocalNotifications ?? null;
}

function setupInstallBanner() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isIOS && !isStandalone) {
    els.installBanner.hidden = false;
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Small UTC-shift helpers for presenting forecast timestamps in the forecast
// city's local time without depending on a larger timezone library.
function getShiftedDate(unixSeconds, timezoneSeconds = 0) {
  return new Date((unixSeconds + timezoneSeconds) * 1000);
}

function formatForecastLabel(unixSeconds, timezoneSeconds = 0) {
  return getShiftedDate(unixSeconds, timezoneSeconds).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatShiftedDayKey(unixSeconds, timezoneSeconds = 0) {
  const shifted = getShiftedDate(unixSeconds, timezoneSeconds);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShiftedDayLabel(unixSeconds, timezoneSeconds = 0) {
  return getShiftedDate(unixSeconds, timezoneSeconds).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function resolveScheduledUnix(dayKey, timeText, timezoneSeconds = 0) {
  const match = String(timeText).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;

  const [yearText, monthText, dayText] = String(dayKey).split("-");
  if (!yearText || !monthText || !dayText) return null;

  return Math.floor((Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText), hours, minutes) - timezoneSeconds * 1000) / 1000);
}

module.exports = {
  getShiftedDate,
  formatForecastLabel,
  formatShiftedDayKey,
  formatShiftedDayLabel,
  resolveScheduledUnix,
};

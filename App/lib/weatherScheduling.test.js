const test = require('node:test');
const assert = require('node:assert/strict');

// These tests pin down the local-day math used by weather scheduling so app
// reminders stay aligned with forecast labels across timezone offsets.

const {
  formatForecastLabel,
  formatShiftedDayKey,
  formatShiftedDayLabel,
  resolveScheduledUnix,
} = require('./weatherScheduling');

test('forecast label and day helpers stay aligned for shifted local dates', () => {
  const utcTime = Date.UTC(2026, 3, 3, 1, 0) / 1000;
  const timezoneSeconds = -4 * 3600;

  assert.equal(formatShiftedDayKey(utcTime, timezoneSeconds), '2026-04-02');
  assert.match(formatShiftedDayLabel(utcTime, timezoneSeconds), /Thu, Apr 2/);
  assert.match(formatForecastLabel(utcTime, timezoneSeconds), /^Thu/);
});

test('resolveScheduledUnix returns matching shifted forecast time', () => {
  const timezoneSeconds = -4 * 3600;
  const scheduledUnix = resolveScheduledUnix('2026-04-05', '06:30', timezoneSeconds);
  assert.equal(scheduledUnix, Date.UTC(2026, 3, 5, 10, 30) / 1000);
  assert.match(formatForecastLabel(scheduledUnix, timezoneSeconds), /^Sun,?\s6:30 AM$/);
});

test('resolveScheduledUnix rejects invalid time strings', () => {
  assert.equal(resolveScheduledUnix('2026-04-05', '25:00', 0), null);
  assert.equal(resolveScheduledUnix('2026-04-05', 'ab:cd', 0), null);
  assert.equal(resolveScheduledUnix('bad-key', '06:30', 0), null);
});

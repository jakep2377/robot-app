import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AppButton from "../components/common/AppButton";
import AppCard from "../components/common/AppCard";
import {
  formatForecastLabel,
  formatShiftedDayKey,
  formatShiftedDayLabel,
  resolveScheduledUnix,
} from "../lib/weatherScheduling";
import { buildWorkbookMix, frostRisk, type Mix } from "../lib/treatmentRules";

type WeatherPayload = {
  name: string;
  dt: number;
  timezone?: number;
  visibility?: number;
  weather: Array<{ main?: string; description?: string }>;
  main: { temp: number; feels_like: number; temp_min: number; temp_max: number; pressure: number; humidity: number };
  wind?: { speed?: number; deg?: number; gust?: number };
  clouds?: { all?: number };
  rain?: Record<string, number>;
  snow?: Record<string, number>;
  sys?: { sunrise?: number; sunset?: number };
};

type ForecastPayload = {
  list: Array<{
    dt: number;
    weather: Array<{ main?: string; description?: string }>;
    main: { temp: number; humidity: number };
    wind?: { speed?: number; gust?: number };
    rain?: Record<string, number>;
    snow?: Record<string, number>;
  }>;
  city?: { timezone?: number };
};

type Props = {
  saltPct: number;
  brinePct: number;
  setSaltPct: (value: number) => void;
  setBrinePct: (value: number) => void;
};

type LocationState = { latitude: number; longitude: number; label: string; source: "city" | "phone" };
type ScheduleTarget = { at: number; label: string; mix: Mix; condition: string } | null;
type LookAheadItem = { at: number; label: string; tempText: string; condition: string; mixText: string; mix: Mix };
type LookAheadDay = { key: string; label: string; items: LookAheadItem[] };

const API_KEY = "e324705094164f5dc98161647cccc83a";
const DEFAULT_LOCATION: LocationState = { latitude: 41.0814, longitude: -81.519, label: "Akron", source: "city" };
const USE_FAKE_DATA = false;
const clampPct = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const getPrecipInches = (value?: { rain?: Record<string, number>; snow?: Record<string, number> }) =>
  Math.max(value?.rain?.["1h"] ?? 0, value?.rain?.["3h"] ?? 0, value?.snow?.["1h"] ?? 0, value?.snow?.["3h"] ?? 0) / 25.4;

const formatLocalTime = (unixSeconds?: number, timezoneSeconds?: number) => {
  if (!unixSeconds) return "--";
  const date = new Date((unixSeconds + (timezoneSeconds ?? 0)) * 1000);
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
};

function getWeatherIconName(condition: string) {
  const text = condition.toLowerCase();
  if (/clear|sunny/.test(text)) return "weather-sunny";
  if (/cloud/.test(text)) return "weather-cloudy";
  if (/rain|drizzle|shower/.test(text)) return "weather-rainy";
  if (/thunder|storm/.test(text)) return "weather-lightning";
  if (/snow|sleet|ice|freezing/.test(text)) return "weather-snowy";
  if (/mist|fog/.test(text)) return "weather-fog";
  return "weather-partly-cloudy";
}

function scoreForecast(tempF: number, conditionText: string, humidity: number, precipInches: number, windSpeed: number, windGust: number, mix: Mix) {
  let score = 0;
  const frost = frostRisk(tempF, humidity);
  if (mix.saltPct > 0 || mix.brinePct > 0) score += 35;
  if (tempF <= 32) score += 24; else if (tempF <= 36) score += 14;
  if (/snow|sleet|freezing|ice/.test(conditionText)) score += 22;
  if (/rain|drizzle|shower|thunder/.test(conditionText)) score += 10;
  if (precipInches >= 0.05) score += 10;
  if (frost.level === "high") score += 16; else if (frost.level === "moderate") score += 8;
  if (windSpeed >= 18 || windGust >= 25) score -= 10;
  if (mix.saltPct === 0 && mix.brinePct === 0) score -= 20;
  return score;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message ?? "Request failed");
  return payload as T;
}

function getLocationModule() {
  try {
    return require("expo-location");
  } catch {
    return null;
  }
}

function getNotificationsModule() {
  try {
    return require("expo-notifications");
  } catch {
    return null;
  }
}

export default function WeatherScreen({ saltPct, brinePct, setSaltPct, setBrinePct }: Props) {
  const insets = useSafeAreaInsets();
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [activeLocation, setActiveLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [notificationState, setNotificationState] = useState("Alerts off");
  const [scheduledAlertText, setScheduledAlertText] = useState("No alert scheduled");
  const [manualSaltText, setManualSaltText] = useState(String(clampPct(saltPct)));
  const [manualBrineText, setManualBrineText] = useState(String(clampPct(brinePct)));
  const [selectedLookAheadDay, setSelectedLookAheadDay] = useState("");
  const [selectedLookAheadAt, setSelectedLookAheadAt] = useState<number | null>(null);
  const [customTimeText, setCustomTimeText] = useState("");
  const [manualScheduleTarget, setManualScheduleTarget] = useState<ScheduleTarget>(null);
  const [showLookAhead, setShowLookAhead] = useState(false);

  const loadWeather = async (location: LocationState) => {
    const TEST_CASE: "none" | "light" | "medium" | "heavy" | "severe" = "light";

    setLoading(true);
    
    try {
      if (USE_FAKE_DATA) {
        const now = Math.floor(Date.now() / 1000);

        const fakeCases: Record<
          "none" | "light" | "medium" | "heavy" | "severe",
          { current: WeatherPayload; future: ForecastPayload }
        > = {
          none: {
            current: {
              name: "Test Clear",
              dt: now,
              timezone: 0,
              visibility: 16093,
              weather: [{ main: "Clear", description: "clear sky" }],
              main: {
                temp: 45,
                feels_like: 43,
                temp_min: 42,
                temp_max: 47,
                pressure: 1018,
                humidity: 50,
              },
              wind: { speed: 5, deg: 270, gust: 7 },
              clouds: { all: 5 },
              sys: {
                sunrise: now - 3600,
                sunset: now + 3600,
              },
            },
            future: {
              city: { timezone: 0 },
              list: [
                {
                  dt: now + 3 * 3600,
                  weather: [{ main: "Clear", description: "clear sky" }],
                  main: { temp: 44, humidity: 52 },
                  wind: { speed: 4, gust: 6 },
                },
              ],
            },
          },

          light: {
            current: {
              name: "Test Light",
              dt: now,
              timezone: 0,
              visibility: 16093,
              weather: [{ main: "Clouds", description: "overcast clouds" }],
              main: {
                temp: 35,
                feels_like: 31,
                temp_min: 33,
                temp_max: 36,
                pressure: 1016,
                humidity: 80,
              },
              wind: { speed: 6, deg: 270, gust: 9 },
              clouds: { all: 95 },
              sys: {
                sunrise: now - 3600,
                sunset: now + 3600,
              },
            },
            future: {
              city: { timezone: 0 },
              list: [
                {
                  dt: now + 3 * 3600,
                  weather: [{ main: "Clouds", description: "broken clouds" }],
                  main: { temp: 34, humidity: 82 },
                  wind: { speed: 6, gust: 8 },
                },
              ],
            },
          },

          medium: {
            current: {
              name: "Test Medium",
              dt: now,
              timezone: 0,
              visibility: 12000,
              weather: [{ main: "Rain", description: "light rain" }],
              main: {
                temp: 31,
                feels_like: 27,
                temp_min: 30,
                temp_max: 32,
                pressure: 1014,
                humidity: 92,
              },
              wind: { speed: 8, deg: 270, gust: 12 },
              clouds: { all: 100 },
              rain: { "1h": 0.08 },
              sys: {
                sunrise: now - 3600,
                sunset: now + 3600,
              },
            },
            future: {
              city: { timezone: 0 },
              list: [
                {
                  dt: now + 3 * 3600,
                  weather: [{ main: "Rain", description: "light rain" }],
                  main: { temp: 30, humidity: 94 },
                  wind: { speed: 9, gust: 13 },
                  rain: { "3h": 0.2 },
                },
              ],
            },
          },

          heavy: {
            current: {
              name: "Test Heavy",
              dt: now,
              timezone: 0,
              visibility: 8000,
              weather: [{ main: "Snow", description: "moderate snow" }],
              main: {
                temp: 24,
                feels_like: 18,
                temp_min: 22,
                temp_max: 25,
                pressure: 1012,
                humidity: 90,
              },
              wind: { speed: 10, deg: 270, gust: 15 },
              clouds: { all: 100 },
              snow: { "1h": 1.5 },
              sys: {
                sunrise: now - 3600,
                sunset: now + 3600,
              },
            },
            future: {
              city: { timezone: 0 },
              list: [
                {
                  dt: now + 3 * 3600,
                  weather: [{ main: "Snow", description: "snow" }],
                  main: { temp: 23, humidity: 91 },
                  wind: { speed: 11, gust: 16 },
                  snow: { "3h": 2.5 },
                },
              ],
            },
          },

          severe: {
            current: {
              name: "Test Severe",
              dt: now,
              timezone: 0,
              visibility: 4000,
              weather: [{ main: "Snow", description: "heavy snow" }],
              main: {
                temp: 12,
                feels_like: 3,
                temp_min: 10,
                temp_max: 13,
                pressure: 1008,
                humidity: 95,
              },
              wind: { speed: 22, deg: 270, gust: 30 },
              clouds: { all: 100 },
              snow: { "1h": 3.0 },
              sys: {
                sunrise: now - 3600,
                sunset: now + 3600,
              },
            },
            future: {
              city: { timezone: 0 },
              list: [
                {
                  dt: now + 3 * 3600,
                  weather: [{ main: "Snow", description: "heavy snow" }],
                  main: { temp: 11, humidity: 96 },
                  wind: { speed: 24, gust: 32 },
                  snow: { "3h": 4.5 },
                },
              ],
            },
          },
        };

        const selected = fakeCases[TEST_CASE];

        setWeather(selected.current);
        setForecast(selected.future);
        setActiveLocation({ ...location, label: selected.current.name || location.label });
        setError(null);
        return;
      }

      const query = `lat=${location.latitude}&lon=${location.longitude}&units=imperial&appid=${API_KEY}`;
      const [current, future] = await Promise.all([
        fetchJson<WeatherPayload>(`https://api.openweathermap.org/data/2.5/weather?${query}`),
        fetchJson<ForecastPayload>(`https://api.openweathermap.org/data/2.5/forecast?${query}`),
      ]);
      setWeather(current);
      setForecast(future);
      setActiveLocation({ ...location, label: current.name || location.label });
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load weather");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWeather(DEFAULT_LOCATION); }, []);
  useEffect(() => { setManualSaltText(String(clampPct(saltPct))); }, [saltPct]);
  useEffect(() => { setManualBrineText(String(clampPct(brinePct))); }, [brinePct]);

  const currentMix = useMemo(() => {
    if (!weather) return null;
    return buildWorkbookMix(weather.main.temp, weather.main.humidity, `${weather.weather?.[0]?.main ?? ""} ${weather.weather?.[0]?.description ?? ""}`.toLowerCase(), getPrecipInches(weather), weather.wind?.speed ?? 0, weather.wind?.gust ?? 0);
  }, [weather]);

  const suggestion = useMemo<ScheduleTarget>(() => {
    if (!forecast?.list?.length) return null;
    const timezone = forecast.city?.timezone ?? weather?.timezone;
    const now = Math.floor(Date.now() / 1000);
    const best = forecast.list
      .filter((entry) => entry.dt >= now && entry.dt <= now + 36 * 3600)
      .map((entry) => {
        const condition = `${entry.weather?.[0]?.main ?? ""} ${entry.weather?.[0]?.description ?? ""}`.toLowerCase();
        const mix = buildWorkbookMix(entry.main.temp, entry.main.humidity, condition, getPrecipInches(entry), entry.wind?.speed ?? 0, entry.wind?.gust ?? 0);
        return { entry, mix, condition, score: scoreForecast(entry.main.temp, condition, entry.main.humidity, getPrecipInches(entry), entry.wind?.speed ?? 0, entry.wind?.gust ?? 0, mix) };
      })
      .sort((a, b) => b.score - a.score || a.entry.dt - b.entry.dt)[0];
    if (!best || best.score <= 0) return null;
    return {
      at: best.entry.dt,
      label: formatForecastLabel(best.entry.dt, timezone),
      mix: best.mix,
      condition: best.entry.weather?.[0]?.description ?? "forecast update",
    };
  }, [forecast, weather?.timezone]);

  const lookAheadDays = useMemo<LookAheadDay[]>(() => {
    if (!forecast?.list?.length) return [];
    const timezone = forecast.city?.timezone ?? weather?.timezone;
    const grouped = new Map<string, LookAheadDay>();

    forecast.list.forEach((entry) => {
      const condition = entry.weather?.[0]?.description ?? "Forecast update";
      const mix = buildWorkbookMix(
        entry.main.temp,
        entry.main.humidity,
        `${entry.weather?.[0]?.main ?? ""} ${entry.weather?.[0]?.description ?? ""}`.toLowerCase(),
        getPrecipInches(entry),
        entry.wind?.speed ?? 0,
        entry.wind?.gust ?? 0,
      );
      const dayKey = formatShiftedDayKey(entry.dt, timezone);
      const dayLabel = formatShiftedDayLabel(entry.dt, timezone);
      const nextItem: LookAheadItem = {
        at: entry.dt,
        label: formatForecastLabel(entry.dt, timezone),
        tempText: `${Math.round(entry.main.temp)}\u00B0F`,
        condition,
        mixText: `${mix.saltPct}% / ${mix.brinePct}%`,
        mix,
      };

      if (grouped.has(dayKey)) {
        grouped.get(dayKey)?.items.push(nextItem);
      } else {
        grouped.set(dayKey, { key: dayKey, label: dayLabel, items: [nextItem] });
      }
    });

    return Array.from(grouped.values()).slice(0, 5);
  }, [forecast, weather?.timezone]);

  useEffect(() => {
    if (!lookAheadDays.length) {
      setSelectedLookAheadDay("");
      return;
    }
    if (!lookAheadDays.some((day) => day.key === selectedLookAheadDay)) {
      setSelectedLookAheadDay(lookAheadDays[0].key);
    }
  }, [lookAheadDays, selectedLookAheadDay]);

  const usePhoneLocation = async () => {
    setLocating(true);
    try {
      const Location = getLocationModule();
      if (!Location) {
        Alert.alert("Rebuild Needed", "Location support was added recently. Rebuild the Android app to use phone-based scheduling.");
        return false;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Location Needed", "Allow location access to build scheduling from the phone's position.");
        return false;
      }
      const lastKnown = await Location.getLastKnownPositionAsync();
      const current = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await loadWeather({ latitude: current.coords.latitude, longitude: current.coords.longitude, label: "Phone location", source: "phone" });
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to read phone location");
      return false;
    } finally {
      setLocating(false);
    }
  };

  const enableAlerts = async () => {
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      setNotificationState("Alerts unavailable");
      Alert.alert("Rebuild Needed", "Notification support was added recently. Rebuild the Android app to enable scheduling alerts.");
      return false;
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    await Notifications.setNotificationChannelAsync("weather-scheduler", {
      name: "Weather Scheduler",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#1f5f9f",
    });

    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      setNotificationState("Alerts denied");
      Alert.alert("Notifications Disabled", "Allow notifications if you want scheduling alerts on this phone.");
      return false;
    }
    setNotificationState("Alerts ready");
    return true;
  };

  const applyCustomScheduleTime = () => {
    const match = customTimeText.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      Alert.alert("Enter Time", "Use HH:MM for the selected day.");
      return;
    }

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (hours > 23 || minutes > 59) {
      Alert.alert("Invalid Time", "Use a valid 24-hour time like 06:30 or 18:45.");
      return;
    }

    const dayKey = selectedLookAheadDay || lookAheadDays[0]?.key;
    if (!dayKey) {
      Alert.alert("No Forecast Day", "Load the forecast first, then choose a time.");
      return;
    }

    const timezone = forecast?.city?.timezone ?? weather?.timezone ?? 0;
    const scheduledAt = resolveScheduledUnix(dayKey, `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`, timezone);
    if (scheduledAt == null) {
      Alert.alert("Invalid Time", "Use a valid 24-hour time like 06:30 or 18:45.");
      return;
    }
    if (scheduledAt <= Math.floor(Date.now() / 1000)) {
      Alert.alert("Pick A Future Time", "Choose a time that has not already passed.");
      return;
    }

    const closestEntry = forecast?.list?.reduce((closest, entry) =>
      Math.abs(entry.dt - scheduledAt) < Math.abs(closest.dt - scheduledAt) ? entry : closest
    );
    if (!closestEntry) {
      Alert.alert("No Forecast Data", "There is no forecast data available for that time yet.");
      return;
    }

    const condition = closestEntry.weather?.[0]?.description ?? "forecast update";
    const mix = buildWorkbookMix(
      closestEntry.main.temp,
      closestEntry.main.humidity,
      `${closestEntry.weather?.[0]?.main ?? ""} ${closestEntry.weather?.[0]?.description ?? ""}`.toLowerCase(),
      getPrecipInches(closestEntry),
      closestEntry.wind?.speed ?? 0,
      closestEntry.wind?.gust ?? 0,
    );

    setSelectedLookAheadAt(null);
    setManualScheduleTarget({
      at: scheduledAt,
      label: formatForecastLabel(scheduledAt, timezone),
      mix,
      condition,
    });
  };

  const scheduleAlert = async () => {
    const target = selectedLookAheadTarget ?? manualScheduleTarget ?? suggestion;
    if (!target) {
      Alert.alert("No Service Time", "Choose a forecast time or set a manual time first.");
      return;
    }
    if (activeLocation.source !== "phone") {
      const locationReady = await usePhoneLocation();
      if (!locationReady) {
        return;
      }
    }
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      setNotificationState("Alerts unavailable");
      Alert.alert("Rebuild Needed", "Notification support was added recently. Rebuild the Android app to enable scheduling alerts.");
      return;
    }
    const ok = await enableAlerts();
    if (!ok) return;
    const notifyAt = new Date(Math.max(Date.now() + 60_000, target.at * 1000 - 30 * 60 * 1000));
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Weather operating window",
        body: `${target.label}: Salt ${target.mix.saltPct}% | Brine ${target.mix.brinePct}%`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notifyAt, channelId: "weather-scheduler" },
    });
    setScheduledAlertText(`Alert set for ${notifyAt.toLocaleString()}`);
  };

  if (loading) return <View style={[styles.centerState, { paddingTop: insets.top }]}><ActivityIndicator size="large" /><Text style={styles.metaText}>Loading weather...</Text></View>;
  if (error || !weather || !currentMix) return <View style={[styles.centerState, { paddingTop: insets.top }]}><Text style={styles.error}>Error: {error ?? "Weather unavailable"}</Text><AppButton label="Retry" onPress={() => loadWeather(activeLocation)} variant="secondary" /></View>;

  const frost = frostRisk(weather.main.temp, weather.main.humidity);
  const currentApplied = clampPct(saltPct) === currentMix.saltPct && clampPct(brinePct) === currentMix.brinePct;
  const manualSaltValue = clampPct(Number.parseInt(manualSaltText || "0", 10) || 0);
  const manualBrineValue = clampPct(Number.parseInt(manualBrineText || "0", 10) || 0);
  const weatherIcon = getWeatherIconName(weather.weather?.[0]?.description ?? "");
  const badgeStyle = frost.level === "high" ? styles.badgeHigh : frost.level === "moderate" ? styles.badgeModerate : styles.badgeLow;
  const activeLookAheadDay = lookAheadDays.find((day) => day.key === selectedLookAheadDay) ?? lookAheadDays[0] ?? null;
  const selectedLookAheadTarget = lookAheadDays.flatMap((day) => day.items).find((item) => item.at === selectedLookAheadAt) ?? null;
  const scheduleTarget = selectedLookAheadTarget ?? manualScheduleTarget ?? suggestion;

  return (
    <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 8 }]}>
      <AppCard style={styles.card}>
        <Text style={styles.eyebrow}>Weather</Text>
        <Text style={styles.title}>{activeLocation.label}</Text>
        <View style={styles.heroRow}>
          <MaterialCommunityIcons name={weatherIcon} size={54} color="#d6e1ec" />
          <View style={styles.heroText}>
            <Text style={styles.temp}>{Math.round(weather.main.temp)}{"\u00B0F"}</Text>
            <Text style={styles.subtitle}>{weather.weather?.[0]?.description ?? "Unknown"}</Text>
          </View>
        </View>
        <View style={[styles.callout, badgeStyle]}><Text style={styles.calloutText}>{frost.text}</Text></View>
        <View style={styles.headerMetaRow}>
          <Text style={styles.metaText}>Updated {formatLocalTime(weather.dt, weather.timezone)}</Text>
          <AppButton label="Refresh" onPress={() => loadWeather(activeLocation)} variant="secondary" />
        </View>
      </AppCard>

      <AppCard title="Recommended Mix" style={styles.card}>
        <View style={styles.row}>
          <ValuePill label="Salt" value={`${currentMix.saltPct}%`} />
          <ValuePill label="Brine" value={`${currentMix.brinePct}%`} />
        </View>
        {currentMix.saltPct === 0 && currentMix.brinePct === 0 ? <Text style={[styles.callout, styles.badgeLow, styles.calloutText]}>Conditions look clear enough to skip treatment.</Text> : null}
        <Text style={styles.currentText}>Current: Salt {clampPct(saltPct)}% | Brine {clampPct(brinePct)}%</Text>
        <Text style={styles.manualLabel}>Manual Entry</Text>
        <View style={styles.manualRow}>
          <View style={styles.manualField}><Text style={styles.manualFieldLabel}>Salt</Text><TextInput style={styles.manualInput} value={manualSaltText} onChangeText={(text) => setManualSaltText(text.replace(/[^0-9]/g, "").slice(0, 3))} keyboardType="number-pad" maxLength={3} /></View>
          <View style={styles.manualField}><Text style={styles.manualFieldLabel}>Brine</Text><TextInput style={styles.manualInput} value={manualBrineText} onChangeText={(text) => setManualBrineText(text.replace(/[^0-9]/g, "").slice(0, 3))} keyboardType="number-pad" maxLength={3} /></View>
          <AppButton label="Set" onPress={() => { setSaltPct(manualSaltValue); setBrinePct(manualBrineValue); }} style={styles.manualButton} />
        </View>
        <Text style={[styles.callout, styles.badgeBlue, styles.calloutText]}>{currentMix.reason}</Text>
        <AppButton
          label={currentApplied ? "Applied" : "Apply Recommendation"}
          onPress={() => { setSaltPct(currentMix.saltPct); setBrinePct(currentMix.brinePct); }}
          variant={currentApplied ? "primary" : "success"}
          style={[styles.applyButton, currentApplied ? styles.applyButtonDone : null]}
        />
      </AppCard>

      <AppCard title="Scheduling Mode" style={styles.card}>
        <Text style={styles.metaText}>Source: {activeLocation.source === "phone" ? "Phone location" : "City fallback"}</Text>
        <Text style={styles.schedulePrimary}>{scheduleTarget ? `Service time: ${scheduleTarget.label}` : "No potential event in the next 36 hours."}</Text>
        <Text style={styles.scheduleMeta}>{scheduleTarget ? `Mix ${scheduleTarget.mix.saltPct}% salt | ${scheduleTarget.mix.brinePct}% brine | ${scheduleTarget.condition}` : "The forecast is mild enough that no operation is suggested right now."}</Text>
        <Text style={styles.scheduleMeta}>{notificationState}</Text>
        <Text style={styles.scheduleMeta}>{scheduledAlertText}</Text>
        <View style={styles.lookAheadHeader}>
          <Text style={styles.lookAheadTitle}>Look Ahead</Text>
          <AppButton label={showLookAhead ? "Hide" : "Show"} onPress={() => setShowLookAhead((value) => !value)} variant="outline" compact style={styles.lookAheadToggle} />
        </View>
        {showLookAhead ? (
          <>
            <View style={styles.lookAheadMenu}>
              {lookAheadDays.map((day) => (
                <AppButton
                  key={day.key}
                  label={day.label}
                  onPress={() => setSelectedLookAheadDay(day.key)}
                  variant={day.key === activeLookAheadDay?.key ? "primary" : "outline"}
                  compact
                  style={[styles.lookAheadMenuButton, day.key === activeLookAheadDay?.key ? styles.lookAheadMenuButtonActive : null]}
                  textStyle={[styles.lookAheadMenuText, day.key === activeLookAheadDay?.key ? styles.lookAheadMenuTextActive : null]}
                />
              ))}
            </View>
            <View style={styles.lookAheadList}>
              {activeLookAheadDay?.items.map((item) => (
                <AppButton
                  key={`${activeLookAheadDay.key}-${item.label}`}
                  label=""
                  style={[styles.lookAheadCard, item.at === selectedLookAheadAt ? styles.lookAheadCardActive : null]}
                  onPress={() => {
                    setSelectedLookAheadAt(item.at);
                    setManualScheduleTarget(null);
                  }}
                >
                  <View>
                    <Text style={styles.lookAheadLabel}>{item.label}</Text>
                    <Text style={styles.lookAheadTemp}>{item.tempText}</Text>
                    <Text style={styles.lookAheadCondition}>{item.condition}</Text>
                    <Text style={styles.lookAheadMix}>{item.mixText}</Text>
                  </View>
                </AppButton>
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.scheduleMeta}>Tap a forecast time or enter a manual run time for the selected day.</Text>
        <View style={styles.manualScheduleRow}>
          <TextInput
            style={styles.manualScheduleInput}
            value={customTimeText}
            onChangeText={(text) => setCustomTimeText(text.replace(/[^0-9:]/g, "").slice(0, 5))}
            placeholder="HH:MM"
            placeholderTextColor="#8aa0b6"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
          <AppButton label="Use Time" onPress={applyCustomScheduleTime} variant="secondary" style={styles.manualScheduleButton} />
        </View>
        <AppButton label={locating ? "Locating..." : "Refresh From Phone Location"} onPress={usePhoneLocation} variant="outline" style={styles.secondaryButton} />
        <AppButton label="Schedule Service" onPress={scheduleAlert} disabled={!scheduleTarget} style={[styles.primaryScheduleButton, !scheduleTarget ? styles.primaryScheduleButtonDisabled : null]} />
      </AppCard>

      <View style={styles.row}><InfoCard label="Feels Like" value={`${Math.round(weather.main.feels_like)}\u00B0F`} /><InfoCard label="Humidity" value={`${weather.main.humidity}%`} /></View>
      <View style={styles.row}><InfoCard label="High / Low" value={`${Math.round(weather.main.temp_max)}\u00B0 / ${Math.round(weather.main.temp_min)}\u00B0`} /><InfoCard label="Pressure" value={`${weather.main.pressure} hPa`} /></View>
      <View style={styles.row}><InfoCard label="Wind" value={`${(weather.wind?.speed ?? 0).toFixed(1)} mph`} detail={`Dir ${(weather.wind?.deg ?? 0).toFixed(0)}\u00B0 | Gust ${(weather.wind?.gust ?? 0).toFixed(1)} mph`} /><InfoCard label="Precip" value={`${getPrecipInches(weather).toFixed(2)} in`} /></View>
      <View style={styles.row}><InfoCard label="Cloud Cover" value={`${weather.clouds?.all ?? 0}%`} /><InfoCard label="Visibility" value={`${((weather.visibility ?? 0) / 1609.34).toFixed(1)} mi`} /></View>
      <View style={styles.row}><InfoCard label="Sunrise" value={formatLocalTime(weather.sys?.sunrise, weather.timezone)} /><InfoCard label="Sunset" value={formatLocalTime(weather.sys?.sunset, weather.timezone)} /></View>
    </ScrollView>
  );
}

function ValuePill({ label, value }: { label: string; value: string }) {
  return <View style={styles.pill}><Text style={styles.pillLabel}>{label}</Text><Text style={styles.pillValue}>{value}</Text></View>;
}

function InfoCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <View style={styles.infoCard}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text>{detail ? <Text style={styles.infoDetail}>{detail}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  centerState: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, gap: 12, backgroundColor: "#f3f5f8" },
  scrollContent: { padding: 16, gap: 12, backgroundColor: "#f3f5f8" },
  card: {},
  eyebrow: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", color: "#63788e" },
  title: { fontSize: 24, fontWeight: "700", color: "#16324f" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroText: { flex: 1 },
  temp: { fontSize: 40, fontWeight: "700", color: "#2c6fb7" },
  subtitle: { fontSize: 14, textTransform: "capitalize", color: "#1f3550" },
  headerMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  metaText: { fontSize: 12, color: "#63788e" },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#1f3550" },
  row: { flexDirection: "row", gap: 10 },
  pill: { flex: 1, borderRadius: 10, backgroundColor: "#eef4fb", paddingVertical: 8, paddingHorizontal: 10 },
  pillLabel: { color: "#4f6478", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  pillValue: { color: "#16324f", fontWeight: "700", fontSize: 22, marginTop: 2 },
  callout: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderLeftWidth: 3 },
  calloutText: { color: "#1f3550", fontSize: 12, fontWeight: "700" },
  badgeLow: { backgroundColor: "#e8f5e9", borderLeftColor: "#2e7d32" },
  badgeModerate: { backgroundColor: "#fff3e0", borderLeftColor: "#f57c00" },
  badgeHigh: { backgroundColor: "#ffebee", borderLeftColor: "#c62828" },
  badgeBlue: { backgroundColor: "#eef4fb", borderLeftColor: "#2c6fb7" },
  currentText: { color: "#36506a", fontSize: 14, fontWeight: "700" },
  manualLabel: { color: "#36506a", fontSize: 14, fontWeight: "700" },
  manualRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  manualField: { flex: 1, gap: 4 },
  manualFieldLabel: { color: "#63788e", fontSize: 14, fontWeight: "700", textTransform: "uppercase" },
  manualInput: { minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: "#cfd9e4", backgroundColor: "#fbfcfe", paddingHorizontal: 12, color: "#16324f", fontSize: 22, fontWeight: "700" },
  manualButton: { minWidth: 68, minHeight: 50 },
  applyButton: { minHeight: 40 },
  applyButtonDone: { backgroundColor: "#2c6fb7" },
  schedulePrimary: { color: "#16324f", fontSize: 16, fontWeight: "700" },
  scheduleMeta: { color: "#4f6478", fontSize: 12, lineHeight: 17 },
  lookAheadHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  lookAheadTitle: { color: "#36506a", fontSize: 14, fontWeight: "700" },
  lookAheadToggle: { minHeight: 32, paddingHorizontal: 12 },
  lookAheadMenu: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  lookAheadMenuButton: { minHeight: 34, paddingHorizontal: 12 },
  lookAheadMenuButtonActive: { backgroundColor: "#2c6fb7", borderColor: "#2c6fb7" },
  lookAheadMenuText: { color: "#36506a", fontSize: 12, fontWeight: "700" },
  lookAheadMenuTextActive: { color: "#ffffff" },
  lookAheadList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  lookAheadCard: { width: "48%", minHeight: 96, alignItems: "flex-start", justifyContent: "flex-start", paddingHorizontal: 10, paddingVertical: 10 },
  lookAheadCardActive: { borderColor: "#2c6fb7", backgroundColor: "#eef4fb" },
  lookAheadLabel: { color: "#63788e", fontSize: 11, fontWeight: "700" },
  lookAheadTemp: { color: "#1f3550", fontSize: 18, fontWeight: "700" },
  lookAheadCondition: { color: "#4f6478", fontSize: 12, textTransform: "capitalize" },
  lookAheadMix: { color: "#2c6fb7", fontSize: 12, fontWeight: "700" },
  manualScheduleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  manualScheduleInput: { flex: 1, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: "#cfd9e4", backgroundColor: "#fbfcfe", paddingHorizontal: 12, color: "#16324f", fontSize: 16, fontWeight: "700" },
  manualScheduleButton: { minWidth: 96, minHeight: 42 },
  secondaryButton: { minHeight: 42 },
  primaryScheduleButton: { minHeight: 42 },
  primaryScheduleButtonDisabled: { backgroundColor: "#9eabb8" },
  infoCard: { flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: "#dce5ef", borderRadius: 14, padding: 14, gap: 4 },
  infoLabel: { fontSize: 12, color: "#63788e", textTransform: "uppercase", fontWeight: "700" },
  infoValue: { fontSize: 20, color: "#1f3550", fontWeight: "700" },
  infoDetail: { color: "#4e647a", fontSize: 12 },
  error: { color: "#b63d3d", fontSize: 16, textAlign: "center" },
});

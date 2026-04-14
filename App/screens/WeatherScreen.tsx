import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AppButton from "../components/common/AppButton";
import AppCard from "../components/common/AppCard";
import AppNoticeModal from "../components/common/AppNoticeModal";
import { getJsonAllowError, postJson } from "../lib/serverApi";
import {
  formatForecastLabel,
  formatShiftedDayKey,
  formatShiftedDayLabel,
  resolveScheduledUnix,
} from "../lib/weatherScheduling";
import { frostRisk, type Mix } from "../lib/treatmentRules";

type WeatherPayload = {
  name: string;
  dt: number;
  timezone?: number;
  visibility?: number;
  weather: Array<{ id?: number; main?: string; description?: string }>;
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
    weather: Array<{ id?: number; main?: string; description?: string }>;
    main: { temp: number; humidity: number };
    wind?: { speed?: number; gust?: number };
    rain?: Record<string, number>;
    snow?: Record<string, number>;
  }>;
  city?: { timezone?: number };
};

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  setSaltPct: (value: number) => void;
  setBrinePct: (value: number) => void;
};

type LocationState = { latitude: number; longitude: number; label: string; source: "city" | "phone" };
type ScheduleTarget = { at: number; label: string; mix: Mix; condition: string } | null;
type LookAheadItem = { at: number; label: string; tempText: string; condition: string; mixText: string; mix: Mix };
type LookAheadDay = { key: string; label: string; items: LookAheadItem[] };
type AutomationStatus = {
  enabled?: boolean;
  scheduledRunAt?: number | null;
  label?: string | null;
  lastResult?: string | null;
  lastError?: string | null;
};

type NoticeAction = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "outline" | "danger" | "success";
};

type NoticeState = {
  visible: boolean;
  title: string;
  message: string;
  tone: "info" | "success" | "warning" | "danger";
  primaryAction?: NoticeAction | null;
  secondaryAction?: NoticeAction | null;
};

const API_KEY = "e324705094164f5dc98161647cccc83a";
const DEFAULT_LOCATION: LocationState = { latitude: 41.0814, longitude: -81.519, label: "Akron", source: "city" };
const USE_FAKE_DATA = false;
// Change this while USE_FAKE_DATA is true to force a specific OpenWeather-representable test case.
const TEST_CONDITION:
  | "none"
  | "frostBlackIce"
  | "lightSnow"
  | "moderateHeavySnow"
  | "freezingRain"
  | "sleet" = "moderateHeavySnow";
// Leave as null to use the default temperature hardcoded in the selected fake case.
const TEST_TEMP_OVERRIDE_F: number | null = 14;
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

type TableEvent = "none" | "lightSnow" | "moderateHeavySnow" | "frostBlackIce" | "freezingRain" | "sleet";

type TableBand = {
  minTempF: number;
  maxTempF: number;
  saltPctFull: number;
  brinePctFull: number;
  saltGpm: number;
  brineLpm: number;
};

const TABLE_RULES: Record<Exclude<TableEvent, "none">, { label: string; bands: TableBand[] }> = {
  lightSnow: {
    label: "Light Snow Storm",
    bands: [
      { minTempF: 20, maxTempF: 32, saltPctFull: 63.79, brinePctFull: 59.70, saltGpm: 229.6, brineLpm: 0.836 },
      { minTempF: 15, maxTempF: 20, saltPctFull: 125.30, brinePctFull: 0.00, saltGpm: 451.1, brineLpm: 0.000 },
    ],
  },
  moderateHeavySnow: {
    label: "Moderate or Heavy Snow Storm",
    bands: [
      { minTempF: 30, maxTempF: 32, saltPctFull: 63.79, brinePctFull: 59.70, saltGpm: 229.6, brineLpm: 0.836 },
      { minTempF: 25, maxTempF: 30, saltPctFull: 110.49, brinePctFull: 117.28, saltGpm: 397.8, brineLpm: 1.642 },
      { minTempF: 15, maxTempF: 25, saltPctFull: 125.30, brinePctFull: 0.00, saltGpm: 451.1, brineLpm: 0.000 },
    ],
  },
  frostBlackIce: {
    label: "Frost or Black Ice",
    bands: [
      { minTempF: 28, maxTempF: 35, saltPctFull: 28.48, brinePctFull: 0.00, saltGpm: 102.5, brineLpm: 0.000 },
      { minTempF: 20, maxTempF: 28, saltPctFull: 72.90, brinePctFull: 68.23, saltGpm: 262.4, brineLpm: 0.955 },
      { minTempF: 15, maxTempF: 20, saltPctFull: 92.26, brinePctFull: 0.00, saltGpm: 332.1, brineLpm: 0.000 },
    ],
  },
  freezingRain: {
    label: "Freezing Rain Storm",
    bands: [
      { minTempF: 32, maxTempF: 200, saltPctFull: 55.81, brinePctFull: 0.00, saltGpm: 200.9, brineLpm: 0.000 },
      { minTempF: 20, maxTempF: 32, saltPctFull: 103.65, brinePctFull: 0.00, saltGpm: 373.2, brineLpm: 0.000 },
      { minTempF: 15, maxTempF: 20, saltPctFull: 205.03, brinePctFull: 0.00, saltGpm: 738.1, brineLpm: 0.000 },
    ],
  },
  sleet: {
    label: "Sleet Storm",
    bands: [
      { minTempF: 32, maxTempF: 200, saltPctFull: 79.73, brinePctFull: 0.00, saltGpm: 287.0, brineLpm: 0.000 },
      { minTempF: 28, maxTempF: 32, saltPctFull: 142.38, brinePctFull: 0.00, saltGpm: 512.6, brineLpm: 0.000 },
      { minTempF: 15, maxTempF: 28, saltPctFull: 205.03, brinePctFull: 0.00, saltGpm: 738.1, brineLpm: 0.000 },
    ],
  },
};

function normalizeWeatherText(conditionText: string) {
  return conditionText.toLowerCase().replace(/\s+/g, " ").trim();
}

function inferOpenWeatherEvent(
  tempF: number,
  humidity: number,
  conditionText: string,
  precipInches: number,
  primaryWeatherId?: number
): TableEvent {
  const text = normalizeWeatherText(conditionText);

  if (primaryWeatherId === 511 || /freezing rain/.test(text)) return "freezingRain";

  if (
    primaryWeatherId === 611 ||
    primaryWeatherId === 612 ||
    primaryWeatherId === 613 ||
    primaryWeatherId === 615 ||
    primaryWeatherId === 616 ||
    /sleet|rain and snow/.test(text)
  ) {
    return "sleet";
  }

  if (
    (primaryWeatherId != null && ((primaryWeatherId >= 600 && primaryWeatherId <= 602) || (primaryWeatherId >= 620 && primaryWeatherId <= 622))) ||
    /snow/.test(text)
  ) {
    if (
      primaryWeatherId === 602 ||
      primaryWeatherId === 621 ||
      primaryWeatherId === 622 ||
      /heavy|moderate/.test(text) ||
      precipInches >= 0.08
    ) {
      return "moderateHeavySnow";
    }
    return "lightSnow";
  }

  if (tempF <= 35 && precipInches < 0.01) {
    const frost = frostRisk(tempF, humidity);
    if (frost.level === "high" || frost.level === "moderate") return "frostBlackIce";
  }

  return "none";
}

function selectTableBand(event: Exclude<TableEvent, "none">, tempF: number) {
  const bands = TABLE_RULES[event].bands;
  return bands.find((band) => tempF >= band.minTempF && tempF <= band.maxTempF) ?? null;
}

function buildOpenWeatherTableMix(
  tempF: number,
  humidity: number,
  conditionText: string,
  precipInches: number,
  _windSpeed: number,
  _windGust: number,
  primaryWeatherId?: number
): Mix {
  const event = inferOpenWeatherEvent(tempF, humidity, conditionText, precipInches, primaryWeatherId);

  if (event === "none") {
    const frost = frostRisk(tempF, humidity);
    if (tempF <= 35 && precipInches < 0.01 && frost.level !== "low") {
      return {
        saltPct: 0,
        brinePct: 0,
        reason: `OpenWeather does not report a direct snow, sleet, or freezing-rain event right now. Frost/ice risk is ${frost.level}, but the workbook does not call for treatment outside the table bands.`,
      };
    }
    return {
      saltPct: 0,
      brinePct: 0,
      reason: "No workbook treatment is recommended for the current OpenWeather condition.",
    };
  }

  const band = selectTableBand(event, tempF);
  const conditionLabel = TABLE_RULES[event].label;

  if (!band) {
    return {
      saltPct: 0,
      brinePct: 0,
      reason: `${conditionLabel} was detected, but ${Math.round(tempF)}°F is outside the workbook temperature bands for this event, so the recommendation is 0% salt and 0% brine.`,
    };
  }

  const rawSaltPct = band.saltPctFull;
  const rawBrinePct = band.brinePctFull;
  const saltPct = clampPct(rawSaltPct);
  const brinePct = clampPct(rawBrinePct);
  const capped = rawSaltPct > 100 || rawBrinePct > 100;

  const details = [
    `${conditionLabel}`,
    `${band.minTempF}–${band.maxTempF}°F band`,
    `salt ${band.saltGpm.toFixed(1)} g/min`,
    `brine ${band.brineLpm.toFixed(3)} L/min`,
  ];

  return {
    saltPct,
    brinePct,
    reason: capped
      ? `${details.join(" • ")}. Workbook full-output values exceed the controller range, so the app caps them at 100%.`
      : `${details.join(" • ")}.`,
  };
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

function describeAutomationStatus(automation: AutomationStatus | null | undefined) {
  const scheduledRunAt = Number(automation?.scheduledRunAt ?? 0) || 0;
  if (automation?.enabled && scheduledRunAt > 0) {
    const prepSuffix = typeof automation?.lastResult === "string" && automation.lastResult.toLowerCase().includes("waypoint")
      ? ` ${automation.lastResult}.`
      : "";
    return {
      armed: true,
      text: `Auto run armed for ${new Date(scheduledRunAt).toLocaleString()}. The server will launch autonomy when the service window opens if the route is ready.${prepSuffix}`,
    };
  }
  if (automation?.lastError) {
    return {
      armed: false,
      text: `Auto run status: ${automation.lastError}`,
    };
  }
  if (automation?.lastResult) {
    return {
      armed: false,
      text: `Auto run status: ${automation.lastResult}.`,
    };
  }
  return {
    armed: false,
    text: "Automatic autonomy is not armed.",
  };
}

export default function WeatherScreen({ serverUrl, saltPct, brinePct, setSaltPct, setBrinePct }: Props) {
  const insets = useSafeAreaInsets();
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [activeLocation, setActiveLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [notificationState, setNotificationState] = useState("Notifications are off");
  const [scheduledAlertText, setScheduledAlertText] = useState("No service alert is scheduled.");
  const [automationStatusText, setAutomationStatusText] = useState("Automatic autonomy is not armed.");
  const [automationArmed, setAutomationArmed] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [manualSaltText, setManualSaltText] = useState(String(clampPct(saltPct)));
  const [manualBrineText, setManualBrineText] = useState(String(clampPct(brinePct)));
  const [selectedLookAheadDay, setSelectedLookAheadDay] = useState("");
  const [selectedLookAheadAt, setSelectedLookAheadAt] = useState<number | null>(null);
  const [customTimeText, setCustomTimeText] = useState("");
  const [manualScheduleTarget, setManualScheduleTarget] = useState<ScheduleTarget>(null);
  const [showLookAhead, setShowLookAhead] = useState(false);
  const locationPromptedRef = useRef(false);
  const [notice, setNotice] = useState<NoticeState>({
    visible: false,
    title: "",
    message: "",
    tone: "info",
    primaryAction: null,
    secondaryAction: null,
  });

  const closeNotice = () => {
    setNotice((current) => ({ ...current, visible: false }));
  };

  const showNotice = ({
    title,
    message,
    tone = "info",
    primaryAction = null,
    secondaryAction = null,
  }: Omit<NoticeState, "visible">) => {
    setNotice({ visible: true, title, message, tone, primaryAction, secondaryAction });
  };

  const loadWeather = async (location: LocationState) => {
    setLoading(true);
    
    try {
      if (USE_FAKE_DATA) {
        const now = Math.floor(Date.now() / 1000);

        const fakeCases: Record<
          "none" | "frostBlackIce" | "lightSnow" | "moderateHeavySnow" | "freezingRain" | "sleet",
          { current: WeatherPayload; future: ForecastPayload }
        > = {
          none: {
            current: {
              name: "Test Clear",
              dt: now,
              timezone: 0,
              visibility: 16093,
              weather: [{ id: 800, main: "Clear", description: "clear sky" }],
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
                  weather: [{ id: 800, main: "Clear", description: "clear sky" }],
                  main: { temp: 44, humidity: 52 },
                  wind: { speed: 4, gust: 6 },
                },
              ],
            },
          },

          frostBlackIce: {
            current: {
              name: "Test Frost",
              dt: now,
              timezone: 0,
              visibility: 16093,
              weather: [{ id: 804, main: "Clouds", description: "overcast clouds" }],
              main: {
                temp: 30,
                feels_like: 26,
                temp_min: 29,
                temp_max: 31,
                pressure: 1018,
                humidity: 88,
              },
              wind: { speed: 4, deg: 270, gust: 6 },
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
                  weather: [{ id: 804, main: "Clouds", description: "overcast clouds" }],
                  main: { temp: 29, humidity: 90 },
                  wind: { speed: 3, gust: 5 },
                },
              ],
            },
          },

          lightSnow: {
            current: {
              name: "Test Light Snow",
              dt: now,
              timezone: 0,
              visibility: 12000,
              weather: [{ id: 600, main: "Snow", description: "light snow" }],
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
              snow: { "1h": 0.5 },
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
                  weather: [{ id: 600, main: "Snow", description: "light snow" }],
                  main: { temp: 30, humidity: 94 },
                  wind: { speed: 9, gust: 13 },
                  snow: { "3h": 0.9 },
                },
              ],
            },
          },

          moderateHeavySnow: {
            current: {
              name: "Test Heavy Snow",
              dt: now,
              timezone: 0,
              visibility: 8000,
              weather: [{ id: 602, main: "Snow", description: "heavy snow" }],
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
                  weather: [{ id: 602, main: "Snow", description: "heavy snow" }],
                  main: { temp: 23, humidity: 91 },
                  wind: { speed: 11, gust: 16 },
                  snow: { "3h": 2.5 },
                },
              ],
            },
          },

          freezingRain: {
            current: {
              name: "Test Freezing Rain",
              dt: now,
              timezone: 0,
              visibility: 7000,
              weather: [{ id: 511, main: "Rain", description: "freezing rain" }],
              main: {
                temp: 30,
                feels_like: 26,
                temp_min: 29,
                temp_max: 31,
                pressure: 1009,
                humidity: 95,
              },
              wind: { speed: 9, deg: 270, gust: 14 },
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
                  weather: [{ id: 511, main: "Rain", description: "freezing rain" }],
                  main: { temp: 29, humidity: 96 },
                  wind: { speed: 10, gust: 15 },
                  rain: { "3h": 0.18 },
                },
              ],
            },
          },

          sleet: {
            current: {
              name: "Test Sleet",
              dt: now,
              timezone: 0,
              visibility: 7500,
              weather: [{ id: 611, main: "Snow", description: "sleet" }],
              main: {
                temp: 31,
                feels_like: 27,
                temp_min: 30,
                temp_max: 32,
                pressure: 1010,
                humidity: 94,
              },
              wind: { speed: 8, deg: 270, gust: 12 },
              clouds: { all: 100 },
              snow: { "1h": 0.06 },
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
                  weather: [{ id: 611, main: "Snow", description: "sleet" }],
                  main: { temp: 30, humidity: 95 },
                  wind: { speed: 9, gust: 13 },
                  snow: { "3h": 0.12 },
                },
              ],
            },
          },
        };

        const selected = fakeCases[TEST_CONDITION];

        if (TEST_TEMP_OVERRIDE_F != null) {
          selected.current.main.temp = TEST_TEMP_OVERRIDE_F;
          selected.current.main.temp_min = TEST_TEMP_OVERRIDE_F - 1;
          selected.current.main.temp_max = TEST_TEMP_OVERRIDE_F + 1;
          selected.current.main.feels_like = TEST_TEMP_OVERRIDE_F - 3;

          if (selected.future.list[0]) {
            selected.future.list[0].main.temp = TEST_TEMP_OVERRIDE_F;
          }
        }

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
    return buildOpenWeatherTableMix(weather.main.temp, weather.main.humidity, `${weather.weather?.[0]?.main ?? ""} ${weather.weather?.[0]?.description ?? ""}`.toLowerCase(), getPrecipInches(weather), weather.wind?.speed ?? 0, weather.wind?.gust ?? 0, weather.weather?.[0]?.id);
  }, [weather]);

  const suggestion = useMemo<ScheduleTarget>(() => {
    if (!forecast?.list?.length) return null;
    const timezone = forecast.city?.timezone ?? weather?.timezone;
    const now = Math.floor(Date.now() / 1000);
    const best = forecast.list
      .filter((entry) => entry.dt >= now && entry.dt <= now + 36 * 3600)
      .map((entry) => {
        const condition = `${entry.weather?.[0]?.main ?? ""} ${entry.weather?.[0]?.description ?? ""}`.toLowerCase();
        const mix = buildOpenWeatherTableMix(entry.main.temp, entry.main.humidity, condition, getPrecipInches(entry), entry.wind?.speed ?? 0, entry.wind?.gust ?? 0, entry.weather?.[0]?.id);
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
      const mix = buildOpenWeatherTableMix(
        entry.main.temp,
        entry.main.humidity,
        `${entry.weather?.[0]?.main ?? ""} ${entry.weather?.[0]?.description ?? ""}`.toLowerCase(),
        getPrecipInches(entry),
        entry.wind?.speed ?? 0,
        entry.wind?.gust ?? 0,
        entry.weather?.[0]?.id,
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
        showNotice({
          title: "Rebuild needed",
          message: "Location support was added recently. Rebuild the Android app to use phone-based scheduling.",
          tone: "warning",
        });
        return false;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        showNotice({
          title: "Location needed",
          message: "Allow location access so the app can choose the right service window from your current position.",
          tone: "warning",
        });
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

  useEffect(() => {
    if (loading || locationPromptedRef.current) return;
    locationPromptedRef.current = true;
    showNotice({
      title: "Use current location?",
      message: "Allow it once to align the forecast and scheduling window with your phone's current position.",
      tone: "info",
      primaryAction: { label: "Use Current Location", onPress: () => { void usePhoneLocation(); } },
      secondaryAction: { label: "Use Saved City", variant: "outline" },
    });
  }, [loading]);

  const enableAlerts = async () => {
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      setNotificationState("Notifications are unavailable");
      showNotice({
        title: "Rebuild needed",
        message: "Notification support was added recently. Rebuild the Android app to enable scheduling alerts.",
        tone: "warning",
      });
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
      setNotificationState("Notifications are disabled");
      showNotice({
        title: "Notifications disabled",
        message: "Allow notifications if you want scheduling reminders to pop up on this phone.",
        tone: "warning",
      });
      return false;
    }
    setNotificationState("Notifications are enabled");
    return true;
  };

  const applyAutomationStatus = (automation: AutomationStatus | null | undefined) => {
    const status = describeAutomationStatus(automation);
    setAutomationArmed(status.armed);
    setAutomationStatusText(status.text);
  };

  const refreshAutomationStatus = async () => {
    const result = await getJsonAllowError<{ ok?: boolean; automation?: AutomationStatus }>(serverUrl, "/api/mission/schedule");
    if (result.ok && result.data?.ok) {
      applyAutomationStatus(result.data.automation ?? null);
    }
  };

  useEffect(() => {
    void refreshAutomationStatus();
  }, [serverUrl]);

  const applyCustomScheduleTime = () => {
    const match = customTimeText.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
    if (!match) {
      showNotice({ title: "Enter time", message: "Use HH:MM or HH:MM AM/PM for the selected day.", tone: "warning" });
      return;
    }

    let hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const meridiem = match[3]?.toUpperCase() ?? null;

    if (meridiem) {
      if (hours < 1 || hours > 12 || minutes > 59) {
        showNotice({ title: "Invalid time", message: "Use a valid time like 6:30 AM or 6:45 PM.", tone: "warning" });
        return;
      }
      if (meridiem === "AM") {
        hours = hours === 12 ? 0 : hours;
      } else {
        hours = hours === 12 ? 12 : hours + 12;
      }
    } else if (hours > 23 || minutes > 59) {
      showNotice({ title: "Invalid time", message: "Use a valid 24-hour time like 06:30 or 18:45, or add AM/PM.", tone: "warning" });
      return;
    }

    const dayKey = selectedLookAheadDay || lookAheadDays[0]?.key;
    if (!dayKey) {
      showNotice({ title: "No forecast day", message: "Load the forecast first, then choose a time.", tone: "warning" });
      return;
    }

    const timezone = forecast?.city?.timezone ?? weather?.timezone ?? 0;
    const scheduledAt = resolveScheduledUnix(dayKey, `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`, timezone);
    if (scheduledAt == null) {
      showNotice({ title: "Invalid time", message: "Use a valid time like 06:30, 6:30 AM, or 6:45 PM.", tone: "warning" });
      return;
    }
    if (scheduledAt <= Math.floor(Date.now() / 1000)) {
      showNotice({ title: "Pick a future time", message: "Choose a time that has not already passed.", tone: "warning" });
      return;
    }

    const closestEntry = forecast?.list?.reduce((closest, entry) =>
      Math.abs(entry.dt - scheduledAt) < Math.abs(closest.dt - scheduledAt) ? entry : closest
    );
    if (!closestEntry) {
      showNotice({ title: "No forecast data", message: "There is no forecast data available for that time yet.", tone: "warning" });
      return;
    }

    const condition = closestEntry.weather?.[0]?.description ?? "forecast update";
    const mix = buildOpenWeatherTableMix(
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
      showNotice({ title: "No service time", message: "Choose a forecast time or set a manual time first.", tone: "warning" });
      return;
    }
    const Notifications = getNotificationsModule();
    if (!Notifications) {
      setNotificationState("Alerts unavailable");
      showNotice({
        title: "Rebuild needed",
        message: "Notification support was added recently. Rebuild the Android app to enable scheduling alerts.",
        tone: "warning",
      });
      return;
    }
    const ok = await enableAlerts();
    if (!ok) return;

    const notifyAt = new Date(Math.max(Date.now() + 60_000, target.at * 1000 - 30 * 60 * 1000));
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Navigator service window",
        subtitle: "Auto run reminder",
        body: `${target.label} • Salt ${target.mix.saltPct}% • Brine ${target.mix.brinePct}%`,
        sound: false,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notifyAt, channelId: "weather-scheduler" },
    });

    setAutomationBusy(true);
    try {
      const automationResponse = await postJson<{ ok: boolean; automation?: AutomationStatus }>(serverUrl, "/api/mission/schedule", {
        at: target.at,
        label: `${target.label} • Salt ${target.mix.saltPct}% • Brine ${target.mix.brinePct}%`,
        notify: true,
      });
      applyAutomationStatus(automationResponse.automation ?? null);
      setScheduledAlertText(`Reminder set for ${notifyAt.toLocaleString()} and auto run armed for ${target.label}.`);
    } catch (requestError) {
      setScheduledAlertText(`Service alert scheduled for ${notifyAt.toLocaleString()}.`);
      applyAutomationStatus({ lastError: requestError instanceof Error ? requestError.message : "Automatic run could not be armed." });
      showNotice({
        title: "Reminder set, auto run not armed",
        message: requestError instanceof Error
          ? `The phone reminder is ready, but the server could not arm the automatic run: ${requestError.message}`
          : "The phone reminder is ready, but the server could not arm the automatic run.",
        tone: "warning",
      });
    } finally {
      setAutomationBusy(false);
    }
  };

  const cancelAutoRun = async () => {
    setAutomationBusy(true);
    try {
      const response = await postJson<{ ok: boolean; automation?: AutomationStatus }>(serverUrl, "/api/mission/schedule/cancel", {});
      applyAutomationStatus(response.automation ?? null);
      setScheduledAlertText("Automatic run cleared. The phone reminder will stay until you replace it.");
    } catch (requestError) {
      showNotice({
        title: "Cancel failed",
        message: requestError instanceof Error ? requestError.message : "Could not cancel the automatic run.",
        tone: "danger",
      });
    } finally {
      setAutomationBusy(false);
    }
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
    <>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 8 }]}>
      <AppCard style={[styles.card, styles.weatherHeroCard]} contentStyle={styles.weatherHeroContent}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.eyebrowLight}>Navigator Forecast</Text>
            <Text style={styles.titleHero}>{activeLocation.label}</Text>
            <Text style={styles.subtitleHero}>
              {activeLocation.source === "phone" ? "Forecast source: current location" : "Forecast source: saved city"}
            </Text>
          </View>
          <View style={styles.heroIconChip}>
            <MaterialCommunityIcons name={weatherIcon} size={42} color="#f8fbff" />
          </View>
        </View>

        <View style={styles.heroStatsRow}>
          <View style={styles.heroText}>
            <Text style={styles.tempHero}>{Math.round(weather.main.temp)}{"\u00B0F"}</Text>
            <Text style={styles.subtitleHero}>{weather.weather?.[0]?.description ?? "Unknown"}</Text>
          </View>
          <View style={styles.heroMetaStack}>
            <Text style={styles.heroMetaLabel}>Updated {formatLocalTime(weather.dt, weather.timezone)}</Text>
            <Text style={styles.heroMetaLabel}>Wind {(weather.wind?.speed ?? 0).toFixed(1)} mph</Text>
          </View>
        </View>

        <View style={[styles.callout, badgeStyle, styles.heroCallout]}><Text style={styles.calloutText}>{frost.text}</Text></View>

        <View style={styles.heroActionsRow}>
          <AppButton
            label={locating ? "Updating Location..." : activeLocation.source === "phone" ? "Refresh Location" : "Use Current Location"}
            onPress={usePhoneLocation}
            disabled={locating || loading}
            variant="outline"
            style={[styles.heroActionButton, locating || loading ? styles.heroActionButtonDisabled : null]}
          />
          <AppButton
            label="Refresh Forecast"
            onPress={() => loadWeather(activeLocation)}
            disabled={loading || locating}
            variant="primary"
            style={[styles.heroActionButton, styles.refreshForecastButton, loading || locating ? styles.heroActionButtonDisabled : null]}
          />
        </View>
      </AppCard>

      <AppCard title="Treatment Recommendation" style={styles.card}>
        <View style={styles.row}>
          <ValuePill label="Salt" value={`${currentMix.saltPct}%`} />
          <ValuePill label="Brine" value={`${currentMix.brinePct}%`} />
        </View>
        {currentMix.saltPct === 0 && currentMix.brinePct === 0 ? <Text style={[styles.callout, styles.badgeLow, styles.calloutText]}>No treatment is recommended right now.</Text> : null}
        <Text style={styles.currentText}>Controller mix: Salt {clampPct(saltPct)}% | Brine {clampPct(brinePct)}%</Text>
        <Text style={styles.supportingText}>Apply the suggested values directly or override them manually for the current job.</Text>
        <Text style={styles.manualLabel}>Manual override</Text>
        <View style={styles.manualRow}>
          <View style={styles.manualField}><Text style={styles.manualFieldLabel}>Salt</Text><TextInput style={styles.manualInput} value={manualSaltText} onChangeText={(text) => setManualSaltText(text.replace(/[^0-9]/g, "").slice(0, 3))} keyboardType="number-pad" maxLength={3} /></View>
          <View style={styles.manualField}><Text style={styles.manualFieldLabel}>Brine</Text><TextInput style={styles.manualInput} value={manualBrineText} onChangeText={(text) => setManualBrineText(text.replace(/[^0-9]/g, "").slice(0, 3))} keyboardType="number-pad" maxLength={3} /></View>
          <AppButton label="Use Values" onPress={() => { setSaltPct(manualSaltValue); setBrinePct(manualBrineValue); }} style={styles.manualButton} />
        </View>
        <Text style={[styles.callout, styles.badgeBlue, styles.calloutText]}>{currentMix.reason}</Text>
        <AppButton
          label={currentApplied ? "Applied" : "Apply to Controller"}
          onPress={() => { setSaltPct(currentMix.saltPct); setBrinePct(currentMix.brinePct); }}
          variant={currentApplied ? "primary" : "success"}
          style={[styles.applyButton, currentApplied ? styles.applyButtonDone : null]}
        />
      </AppCard>

      <AppCard title="Service Planner" style={styles.card}>
        <View style={styles.plannerSection}>
          <View style={styles.plannerHeaderRow}>
            <View style={styles.plannerHeaderText}>
              <Text style={styles.plannerSectionLabel}>Forecast window</Text>
              <Text style={styles.scheduleMeta}>Source: {activeLocation.source === "phone" ? "Current location" : "Saved city"}</Text>
            </View>
            <AppButton
              label={showLookAhead ? "Hide Forecast" : "Show Forecast"}
              onPress={() => setShowLookAhead((value) => !value)}
              variant="outline"
              compact
              style={styles.lookAheadToggle}
            />
          </View>

          <Text style={styles.schedulePrimary}>
            {scheduleTarget ? `Recommended window: ${scheduleTarget.label}` : "No recommended service window in the next 36 hours."}
          </Text>
          <Text style={styles.scheduleMeta}>
            {scheduleTarget
              ? `Suggested mix: ${scheduleTarget.mix.saltPct}% salt • ${scheduleTarget.mix.brinePct}% brine • ${scheduleTarget.condition}`
              : "Review the forecast or set a manual time for the next service run."}
          </Text>

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
                      <Text style={[styles.lookAheadLabel, item.at === selectedLookAheadAt ? styles.lookAheadLabelActive : null]}>{item.label}</Text>
                      <Text style={[styles.lookAheadTemp, item.at === selectedLookAheadAt ? styles.lookAheadTempActive : null]}>{item.tempText}</Text>
                      <Text style={[styles.lookAheadCondition, item.at === selectedLookAheadAt ? styles.lookAheadConditionActive : null]}>{item.condition}</Text>
                      <Text style={[styles.lookAheadMix, item.at === selectedLookAheadAt ? styles.lookAheadMixActive : null]}>{item.mixText}</Text>
                    </View>
                  </AppButton>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.scheduleMeta}>Choose a forecast slot or enter a manual time.</Text>
          <View style={styles.manualScheduleRow}>
            <TextInput
              style={styles.manualScheduleInput}
              value={customTimeText}
              onChangeText={(text) => setCustomTimeText(text.replace(/[^0-9: apmAPM]/g, "").slice(0, 8))}
              placeholder="HH:MM AM"
              placeholderTextColor="#8aa0b6"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="characters"
              maxLength={8}
            />
            <AppButton label="Use Time" onPress={applyCustomScheduleTime} variant="secondary" style={styles.manualScheduleButton} />
          </View>
        </View>

        <View style={styles.plannerDivider} />

        <View style={styles.plannerSection}>
          <Text style={styles.plannerSectionLabel}>Automation</Text>
          <Text style={styles.scheduleMeta}>{notificationState}</Text>
          <Text style={styles.scheduleMeta}>{scheduledAlertText}</Text>
          <Text style={styles.scheduleMeta}>{automationStatusText}</Text>
          <View style={styles.plannerActionRow}>
            <AppButton
              label={automationBusy ? "Arming Auto Run..." : "Arm Auto Run + Reminder"}
              onPress={scheduleAlert}
              disabled={!scheduleTarget || automationBusy}
              style={[styles.primaryScheduleButton, !scheduleTarget || automationBusy ? styles.primaryScheduleButtonDisabled : null]}
            />
            {automationArmed ? (
              <AppButton
                label={automationBusy ? "Working..." : "Cancel Auto Run"}
                onPress={cancelAutoRun}
                disabled={automationBusy}
                variant="outline"
                style={styles.secondaryButton}
              />
            ) : null}
          </View>
        </View>
      </AppCard>

      <AppCard title="Current Conditions" style={styles.card} contentStyle={styles.conditionsCardContent}>
        <Text style={styles.conditionsHint}>Live weather details for the active forecast location.</Text>
        <View style={styles.conditionsGrid}>
          <InfoCard label="Feels Like" value={`${Math.round(weather.main.feels_like)}\u00B0F`} />
          <InfoCard label="Humidity" value={`${weather.main.humidity}%`} />
          <InfoCard label="High / Low" value={`${Math.round(weather.main.temp_max)}\u00B0 / ${Math.round(weather.main.temp_min)}\u00B0`} />
          <InfoCard label="Pressure" value={`${weather.main.pressure} hPa`} />
          <InfoCard label="Wind" value={`${(weather.wind?.speed ?? 0).toFixed(1)} mph`} detail={`Dir ${(weather.wind?.deg ?? 0).toFixed(0)}\u00B0 | Gust ${(weather.wind?.gust ?? 0).toFixed(1)} mph`} />
          <InfoCard label="Precip" value={`${getPrecipInches(weather).toFixed(2)} in`} />
          <InfoCard label="Cloud Cover" value={`${weather.clouds?.all ?? 0}%`} />
          <InfoCard label="Visibility" value={`${((weather.visibility ?? 0) / 1609.34).toFixed(1)} mi`} />
          <InfoCard label="Sunrise" value={formatLocalTime(weather.sys?.sunrise, weather.timezone)} />
          <InfoCard label="Sunset" value={formatLocalTime(weather.sys?.sunset, weather.timezone)} />
        </View>
      </AppCard>
      </ScrollView>
      <AppNoticeModal
        visible={notice.visible}
        title={notice.title}
        message={notice.message}
        tone={notice.tone}
        primaryAction={notice.primaryAction ?? undefined}
        secondaryAction={notice.secondaryAction ?? undefined}
        onClose={closeNotice}
      />
    </>
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
  eyebrowLight: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", color: "#c8dcf2" },
  title: { fontSize: 24, fontWeight: "700", color: "#16324f" },
  titleHero: { fontSize: 30, fontWeight: "800", color: "#f8fbff" },
  supportingText: { fontSize: 13, lineHeight: 19, color: "#4f6478" },
  weatherHeroCard: { backgroundColor: "#16324f", borderColor: "#214b74" },
  weatherHeroContent: { gap: 14 },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  heroTitleBlock: { flex: 1, gap: 4 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroText: { flex: 1 },
  heroStatsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  heroIconChip: { width: 64, height: 64, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  temp: { fontSize: 40, fontWeight: "700", color: "#2c6fb7" },
  tempHero: { fontSize: 48, fontWeight: "800", color: "#ffffff" },
  subtitle: { fontSize: 14, textTransform: "capitalize", color: "#1f3550" },
  subtitleHero: { fontSize: 14, textTransform: "capitalize", color: "#d8e6f5" },
  heroMetaStack: { alignItems: "flex-end", gap: 6 },
  heroMetaLabel: { fontSize: 12, color: "#c8dcf2", fontWeight: "700" },
  heroCallout: { marginTop: 2 },
  heroActionsRow: { flexDirection: "row", gap: 10 },
  heroActionButton: { flex: 1 },
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
  manualRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  manualField: { flex: 1, gap: 4, alignItems: "stretch" },
  manualFieldLabel: { color: "#63788e", fontSize: 13, fontWeight: "700", textTransform: "uppercase", textAlign: "center" },
  manualInput: { minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: "#cfd9e4", backgroundColor: "#fbfcfe", paddingHorizontal: 12, color: "#16324f", fontSize: 20, fontWeight: "700", textAlign: "center" },
  manualButton: { minWidth: 84, minHeight: 44, alignSelf: "flex-end" },
  applyButton: { minHeight: 40 },
  applyButtonDone: { backgroundColor: "#2c6fb7" },
  schedulePrimary: { color: "#16324f", fontSize: 16, fontWeight: "700" },
  scheduleMeta: { color: "#4f6478", fontSize: 12, lineHeight: 18 },
  plannerSection: { gap: 8 },
  plannerHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  plannerHeaderText: { flex: 1, gap: 2 },
  plannerSectionLabel: { color: "#1f3550", fontSize: 13, fontWeight: "800", textTransform: "uppercase" },
  plannerDivider: { height: 1, backgroundColor: "#e3ebf4", marginVertical: 2 },
  plannerActionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  lookAheadHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  lookAheadTitle: { color: "#36506a", fontSize: 14, fontWeight: "700" },
  lookAheadToggle: { minHeight: 32, paddingHorizontal: 12 },
  lookAheadMenu: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  lookAheadMenuButton: { minHeight: 34, paddingHorizontal: 12 },
  lookAheadMenuButtonActive: { backgroundColor: "#eaf2fb", borderColor: "#2c6fb7" },
  lookAheadMenuText: { color: "#36506a", fontSize: 12, fontWeight: "700" },
  lookAheadMenuTextActive: { color: "#2c6fb7" },
  lookAheadList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  lookAheadCard: { width: "48%", minHeight: 96, alignItems: "flex-start", justifyContent: "flex-start", paddingHorizontal: 10, paddingVertical: 10, backgroundColor: "#f8fbff", borderWidth: 1, borderColor: "#cfd9e4", borderRadius: 10},
  lookAheadCardActive: { borderColor: "#2c6fb7", backgroundColor: "#eef4fb" },
  lookAheadLabel: { color: "#63788e", fontSize: 11, fontWeight: "700" },
  lookAheadLabelActive: { color: "#2c6fb7" },
  lookAheadTemp: { color: "#1f3550", fontSize: 18, fontWeight: "700" },
  lookAheadTempActive: { color: "#16324f" },
  lookAheadCondition: { color: "#4f6478", fontSize: 12, textTransform: "capitalize" },
  lookAheadConditionActive: { color: "#35506a" },
  lookAheadMix: { color: "#2c6fb7", fontSize: 12, fontWeight: "700" },
  lookAheadMixActive: { color: "#2c6fb7" },
  manualScheduleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  manualScheduleInput: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: "#cfd9e4", backgroundColor: "#fbfcfe", paddingHorizontal: 12, color: "#16324f", fontSize: 16, fontWeight: "700", textAlign: "center" },
  manualScheduleButton: { minWidth: 118, minHeight: 46 },
  secondaryButton: { minHeight: 42 },
  primaryScheduleButton: { minHeight: 42, backgroundColor: "#2d8a65" },
  primaryScheduleButtonDisabled: { backgroundColor: "#9eabb8" },
  refreshForecastButton: { backgroundColor: "#2a74d7", borderColor: "#1f5f9f" },
  heroActionButtonDisabled: { opacity: 0.7 },
  conditionsCardContent: { gap: 12 },
  conditionsHint: { color: "#5b7288", fontSize: 13, lineHeight: 18 },
  conditionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  infoCard: { width: "48%", backgroundColor: "#f8fbff", borderWidth: 1, borderColor: "#dce5ef", borderRadius: 16, padding: 14, gap: 4, shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  infoLabel: { fontSize: 12, color: "#63788e", textTransform: "uppercase", fontWeight: "700" },
  infoValue: { fontSize: 20, color: "#1f3550", fontWeight: "700" },
  infoDetail: { color: "#4e647a", fontSize: 12 },
  error: { color: "#b63d3d", fontSize: 16, textAlign: "center" },
});

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type WeatherMain = {
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  pressure: number;
  humidity: number;
};

type WeatherWind = {
  speed?: number;
  deg?: number;
  gust?: number;
};

type WeatherClouds = {
  all?: number;
};

type WeatherSys = {
  sunrise?: number;
  sunset?: number;
};

type WeatherCondition = {
  main?: string;
  description?: string;
  icon?: string;
};

type WeatherPayload = {
  name: string;
  dt: number;
  timezone?: number;
  visibility?: number;
  weather: WeatherCondition[];
  main: WeatherMain;
  wind?: WeatherWind;
  clouds?: WeatherClouds;
  rain?: Record<string, number>;
  snow?: Record<string, number>;
  sys?: WeatherSys;
};

type Props = {
  saltPct: number;
  brinePct: number;
  setSaltPct: (value: number) => void;
  setBrinePct: (value: number) => void;
};

type DispersionRecommendation = {
  saltPct: number;
  brinePct: number;
  reason: string;
};

const clampPct = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function getWeatherIcon(condition: string): string {
  if (!condition) return "?";
  const text = condition.toLowerCase();
  if (/clear|sunny/.test(text)) return "☀";
  if (/cloud/.test(text)) return "☁";
  if (/rain|drizzle|shower/.test(text)) return "☂";
  if (/thunder|storm/.test(text)) return "⚡";
  if (/snow|sleet|ice|freezing/.test(text)) return "❄";
  if (/mist|fog/.test(text)) return "≋";
  if (/wind/.test(text)) return "↝";
  return "○";
}

function calculateDewPoint(tempF: number, humidity: number): number {
  const tempC = (tempF - 32) * (5 / 9);
  const a = 17.27;
  const b = 237.7;
  const alphaTn = (a * tempC) / (b + tempC) + Math.log(humidity / 100);
  const dewPointC = (b * alphaTn) / (a - alphaTn);
  return (dewPointC * 9) / 5 + 32;
}

function calculateFrostRisk(tempF: number, humidity: number): { riskLevel: "high" | "moderate" | "low"; description: string } {
  const dewPoint = calculateDewPoint(tempF, humidity);
  const spreadF = tempF - dewPoint;

  if (tempF <= 32 && dewPoint <= 32) {
    return { riskLevel: "high", description: "Frost likely" };
  }
  if (tempF <= 35 && spreadF < 3) {
    return { riskLevel: "moderate", description: "Frost risk rising" };
  }
  if (tempF > 45 || spreadF > 8) {
    return { riskLevel: "low", description: "Low frost risk" };
  }
  return { riskLevel: "moderate", description: "Monitor conditions" };
}

function formatLocalTime(unixSeconds: number | undefined, timezoneSeconds: number | undefined) {
  if (!unixSeconds) return "--";
  const date = new Date((unixSeconds + (timezoneSeconds ?? 0)) * 1000);
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
}

export default function WeatherScreen({ saltPct, brinePct, setSaltPct, setBrinePct }: Props) {
  const insets = useSafeAreaInsets();
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const theme = {
    pageBg: "#f3f5f8",
    cardBg: "#ffffff",
    cardBorder: "#dce5ef",
    title: "#16324f",
    text: "#304863",
    muted: "#63788e",
  };

  const API_KEY = "e324705094164f5dc98161647cccc83a";
  const CITY = "Akron,US";

  const loadWeather = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&units=imperial&appid=${API_KEY}`
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? "Unable to load weather");
      }
      setWeather(payload as WeatherPayload);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load weather");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeather();
  }, []);

  const weatherMeta = useMemo(() => {
    if (!weather) {
      return null;
    }

    return {
      updatedAt: formatLocalTime(weather.dt, weather.timezone),
      sunrise: formatLocalTime(weather.sys?.sunrise, weather.timezone),
      sunset: formatLocalTime(weather.sys?.sunset, weather.timezone),
      precipitationInches: Math.max(
        weather.rain?.["1h"] ?? 0,
        weather.rain?.["3h"] ?? 0,
        weather.snow?.["1h"] ?? 0,
        weather.snow?.["3h"] ?? 0
      ) / 25.4,
    };
  }, [weather]);

  const recommendation = useMemo<DispersionRecommendation | null>(() => {
    if (!weather || !weatherMeta) {
      return null;
    }

    const conditionText = `${weather.weather?.[0]?.main ?? ""} ${weather.weather?.[0]?.description ?? ""}`.toLowerCase();
    const isSnowOrIce = /snow|sleet|freezing|ice/.test(conditionText);
    const isRain = /rain|drizzle|shower|thunder/.test(conditionText);
    const tempF = weather.main.temp;
    const windSpeed = weather.wind?.speed ?? 0;
    const windGust = weather.wind?.gust ?? 0;
    const humidity = weather.main.humidity;
    const frostRisk = calculateFrostRisk(tempF, humidity);

    let suggestedSalt = 70;
    let suggestedBrine = 80;

    if (tempF <= 15) {
      suggestedSalt = 100;
      suggestedBrine = 35;
    } else if (tempF <= 25) {
      suggestedSalt = 90;
      suggestedBrine = 55;
    } else if (tempF <= 32) {
      suggestedSalt = 75;
      suggestedBrine = 80;
    } else {
      suggestedSalt = 45;
      suggestedBrine = 100;
    }

    const reasons: string[] = [`Base from ${Math.round(tempF)} F`];

    if (
      frostRisk.riskLevel === "low" &&
      !isSnowOrIce &&
      !isRain &&
      tempF >= 38 &&
      humidity < 85 &&
      weatherMeta.precipitationInches < 0.02
    ) {
      return {
        saltPct: 0,
        brinePct: 0,
        reason: "No dispersion recommended",
      };
    }

    if (isSnowOrIce) {
      suggestedSalt = Math.max(suggestedSalt, 95);
      suggestedBrine = Math.min(suggestedBrine, 60);
      reasons.push("snow or ice");
    } else if (isRain) {
      suggestedBrine = Math.max(suggestedBrine, 90);
      suggestedSalt = Math.min(suggestedSalt, 70);
      reasons.push("rain");
    }

    if (weatherMeta.precipitationInches >= 0.08 && tempF <= 32) {
      suggestedSalt = Math.min(100, suggestedSalt + 8);
      reasons.push("higher precip");
    }

    if (windSpeed >= 20 || windGust >= 28) {
      suggestedSalt = Math.min(100, suggestedSalt + 5);
      reasons.push("strong wind");
    }

    return {
      saltPct: clampPct(suggestedSalt),
      brinePct: clampPct(suggestedBrine),
      reason: reasons.join(" · "),
    };
  }, [weather, weatherMeta]);

  if (loading) {
    return (
      <View style={[styles.centerState, { backgroundColor: theme.pageBg, paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
        <Text style={[styles.metaText, { color: theme.muted }]}>Loading weather...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centerState, { backgroundColor: theme.pageBg, paddingTop: insets.top }]}>
        <Text style={styles.error}>Error: {error}</Text>
        <Pressable style={styles.refreshButton} onPress={loadWeather}>
          <Text style={styles.refreshButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!weather || !weatherMeta) {
    return (
      <View style={[styles.centerState, { backgroundColor: theme.pageBg, paddingTop: insets.top }]}>
        <Text style={styles.error}>Weather data is unavailable.</Text>
      </View>
    );
  }

  const condition = weather.weather?.[0]?.description ?? "unknown";
  const weatherIcon = getWeatherIcon(condition);
  const windSpeed = weather.wind?.speed ?? 0;
  const windGust = weather.wind?.gust ?? 0;
  const windDirection = weather.wind?.deg ?? 0;
  const visibilityMiles = weather.visibility ? weather.visibility / 1609.34 : 0;
  const dewPointF = calculateDewPoint(weather.main.temp, weather.main.humidity);
  const frostRisk = calculateFrostRisk(weather.main.temp, weather.main.humidity);
  const suggestionApplied = recommendation
    ? clampPct(saltPct) === recommendation.saltPct && clampPct(brinePct) === recommendation.brinePct
    : false;

  const frostRiskStyle = frostRisk.riskLevel === "high"
    ? styles.frostRiskHigh
    : frostRisk.riskLevel === "moderate"
      ? styles.frostRiskModerate
      : styles.frostRiskLow;

  return (
    <ScrollView contentContainerStyle={[styles.scrollContent, { backgroundColor: theme.pageBg, paddingTop: insets.top + 8 }]}>
      <View style={[styles.headerCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
        <Text style={[styles.eyebrow, { color: theme.muted }]}>Weather</Text>
        <Text style={[styles.title, { color: theme.title }]}>{weather.name}</Text>
        <View style={styles.heroRow}>
          <Text style={styles.weatherIcon}>{weatherIcon}</Text>
          <View style={styles.heroText}>
            <Text style={styles.temp}>{Math.round(weather.main.temp)}°F</Text>
            <Text style={[styles.subtitle, { color: theme.text }]}>{condition}</Text>
          </View>
        </View>
        <View style={[styles.frostRiskBadge, frostRiskStyle]}>
          <Text style={styles.frostRiskText}>{frostRisk.description}</Text>
        </View>
        <View style={styles.headerMetaRow}>
          <Text style={[styles.metaText, { color: theme.muted }]}>Updated {weatherMeta.updatedAt}</Text>
          <Pressable style={styles.refreshButton} onPress={loadWeather}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      {recommendation ? (
        <View style={[styles.recommendationCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
          <Text style={styles.sectionTitle}>Recommended Mix</Text>
          <View style={styles.recommendationRow}>
            <ValuePill label="Salt" value={`${recommendation.saltPct}%`} />
            <ValuePill label="Brine" value={`${recommendation.brinePct}%`} />
          </View>
          {recommendation.saltPct === 0 && recommendation.brinePct === 0 ? (
            <Text style={styles.recommendationZero}>Conditions look clear enough to skip treatment.</Text>
          ) : null}
          <Text style={styles.recommendationCurrent}>Current: Salt {clampPct(saltPct)}% · Brine {clampPct(brinePct)}%</Text>
          <Text style={styles.recommendationReason}>{recommendation.reason}</Text>
          <Pressable
            style={[styles.applyButton, suggestionApplied ? styles.applyButtonDone : null]}
            onPress={() => {
              setSaltPct(recommendation.saltPct);
              setBrinePct(recommendation.brinePct);
            }}
          >
            <Text style={styles.applyButtonText}>{suggestionApplied ? "Applied" : "Apply Recommendation"}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.gridRow}>
        <InfoCard label="Feels Like" value={`${Math.round(weather.main.feels_like)}°F`} />
        <InfoCard label="Humidity" value={`${weather.main.humidity}%`} />
      </View>

      <View style={styles.gridRow}>
        <InfoCard label="Dew Point" value={`${Math.round(dewPointF)}°F`} />
        <InfoCard label="Spread" value={`${(weather.main.temp - dewPointF).toFixed(1)}°F`} detail="Temp vs dew point" />
      </View>

      <View style={styles.gridRow}>
        <InfoCard label="High / Low" value={`${Math.round(weather.main.temp_max)}° / ${Math.round(weather.main.temp_min)}°`} />
        <InfoCard label="Pressure" value={`${weather.main.pressure} hPa`} />
      </View>

      <View style={styles.gridRow}>
        <InfoCard label="Wind" value={`${windSpeed.toFixed(1)} mph`} detail={`Dir ${windDirection.toFixed(0)}° · Gust ${windGust.toFixed(1)} mph`} />
        <InfoCard label="Visibility" value={`${visibilityMiles.toFixed(1)} mi`} />
      </View>

      <View style={styles.gridRow}>
        <InfoCard label="Cloud Cover" value={`${weather.clouds?.all ?? 0}%`} />
        <InfoCard label="Precip" value={`${weatherMeta.precipitationInches.toFixed(2)} in`} />
      </View>

      <View style={styles.gridRow}>
        <InfoCard label="Sunrise" value={weatherMeta.sunrise} />
        <InfoCard label="Sunset" value={weatherMeta.sunset} />
      </View>
    </ScrollView>
  );
}

function ValuePill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.recommendationPill}>
      <Text style={styles.recommendationPillLabel}>{label}</Text>
      <Text style={styles.recommendationPillValue}>{value}</Text>
    </View>
  );
}

function InfoCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
      {detail ? <Text style={styles.infoDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centerState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 12,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  headerCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: 10,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroText: {
    flex: 1,
  },
  weatherIcon: {
    fontSize: 44,
    width: 52,
    textAlign: "center",
  },
  temp: {
    fontSize: 40,
    fontWeight: "700",
    color: "#2c6fb7",
  },
  subtitle: {
    fontSize: 16,
    textTransform: "capitalize",
  },
  headerMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  frostRiskBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  frostRiskHigh: {
    backgroundColor: "#ffebee",
    borderLeftWidth: 3,
    borderLeftColor: "#c62828",
  },
  frostRiskModerate: {
    backgroundColor: "#fff3e0",
    borderLeftWidth: 3,
    borderLeftColor: "#f57c00",
  },
  frostRiskLow: {
    backgroundColor: "#e8f5e9",
    borderLeftWidth: 3,
    borderLeftColor: "#2e7d32",
  },
  frostRiskText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1f3550",
  },
  metaText: {
    fontSize: 12,
  },
  refreshButton: {
    backgroundColor: "#16324f",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  refreshButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  recommendationCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dce5ef",
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1f3550",
  },
  recommendationRow: {
    flexDirection: "row",
    gap: 10,
  },
  recommendationPill: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#eef4fb",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  recommendationPillLabel: {
    color: "#4f6478",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  recommendationPillValue: {
    color: "#16324f",
    fontWeight: "700",
    fontSize: 22,
    marginTop: 2,
  },
  recommendationCurrent: {
    color: "#36506a",
    fontSize: 12,
    fontWeight: "600",
  },
  recommendationZero: {
    color: "#1e6d4f",
    fontSize: 12,
    fontWeight: "700",
  },
  recommendationReason: {
    color: "#4f6478",
    fontSize: 12,
    lineHeight: 16,
    backgroundColor: "#f5f7fa",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#2c6fb7",
  },
  applyButton: {
    borderRadius: 10,
    backgroundColor: "#1e6d4f",
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  applyButtonDone: {
    backgroundColor: "#2c6fb7",
  },
  applyButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  gridRow: {
    flexDirection: "row",
    gap: 12,
  },
  infoCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dce5ef",
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  infoLabel: {
    fontSize: 12,
    color: "#63788e",
    textTransform: "uppercase",
    fontWeight: "700",
  },
  infoValue: {
    fontSize: 20,
    color: "#1f3550",
    fontWeight: "700",
  },
  infoDetail: {
    color: "#4e647a",
    fontSize: 12,
  },
  error: {
    color: "#b63d3d",
    fontSize: 16,
    textAlign: "center",
  },
});

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, GestureResponderEvent } from "react-native";
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
  darkMode: boolean;
};

type DispersionRecommendation = {
  saltPct: number;
  brinePct: number;
  reason: string;
};

const clampPct = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function getWeatherIcon(condition: string): string {
  if (!condition) return "❓";
  const c = condition.toLowerCase();
  if (/clear|sunny/.test(c)) return "☀️";
  if (/cloud/.test(c)) {
    if (/few|scattered/.test(c)) return "⛅";
    return "☁️";
  }
  if (/rain|drizzle|shower/.test(c)) return "🌧️";
  if (/thunder|storm/.test(c)) return "⛈️";
  if (/snow|sleet/.test(c)) return "❄️";
  if (/mist|fog/.test(c)) return "🌫️";
  if (/wind/.test(c)) return "💨";
  return "🌤️";
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
    return { riskLevel: "high", description: "Frost likely - apply treatment" };
  }
  if (tempF <= 35 && spreadF < 3) {
    return { riskLevel: "moderate", description: "Frost risk developing" };
  }
  if (tempF > 45 || spreadF > 8) {
    return { riskLevel: "low", description: "Minimal frost risk" };
  }
  return { riskLevel: "moderate", description: "Monitor conditions" };
}

export default function WeatherScreen({ saltPct, brinePct, setSaltPct, setBrinePct, darkMode }: Props) {
  const insets = useSafeAreaInsets();
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const theme = darkMode
    ? {
        pageBg: '#0f1722',
        cardBg: '#182433',
        cardBorder: '#2a3c53',
        title: '#d7e7fa',
        text: '#c3d4e7',
        muted: '#90a6bd',
      }
    : {
        pageBg: '#f3f5f8',
        cardBg: '#ffffff',
        cardBorder: '#dce5ef',
        title: '#16324f',
        text: '#304863',
        muted: '#63788e',
      };

  // City and API key
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

    const localTimestamp = new Date((weather.dt + (weather.timezone ?? 0)) * 1000);
    const sunrise = weather.sys?.sunrise
      ? new Date((weather.sys.sunrise + (weather.timezone ?? 0)) * 1000)
      : null;
    const sunset = weather.sys?.sunset
      ? new Date((weather.sys.sunset + (weather.timezone ?? 0)) * 1000)
      : null;

    return {
      updatedAt: `${localTimestamp.getUTCHours().toString().padStart(2, "0")}:${localTimestamp.getUTCMinutes().toString().padStart(2, "0")}`,
      sunrise: sunrise
        ? `${sunrise.getUTCHours().toString().padStart(2, "0")}:${sunrise.getUTCMinutes().toString().padStart(2, "0")}`
        : "--",
      sunset: sunset
        ? `${sunset.getUTCHours().toString().padStart(2, "0")}:${sunset.getUTCMinutes().toString().padStart(2, "0")}`
        : "--",
      precipitationInches: Math.max(
        weather.rain?.["1h"] ?? 0,
        weather.rain?.["3h"] ?? 0,
        weather.snow?.["1h"] ?? 0,
        weather.snow?.["3h"] ?? 0,
      ) / 25.4,
    };
  }, [weather]);

  const recommendation = useMemo<DispersionRecommendation | null>(() => {
    if (!weather || !weatherMeta) {
      return null;
    }

    const conditionText = `${weather.weather?.[0]?.main ?? ''} ${weather.weather?.[0]?.description ?? ''}`.toLowerCase();
    const isSnowOrIce = /snow|sleet|freezing|ice/.test(conditionText);
    const isRain = /rain|drizzle|shower|thunder/.test(conditionText);
    const tempF = weather.main.temp;
    const windSpeed = weather.wind?.speed ?? 0;
    const windGust = weather.wind?.gust ?? 0;

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

    const reasons: string[] = [`Temp ${Math.round(tempF)}°F baseline applied`];

    if (isSnowOrIce) {
      suggestedSalt = Math.max(suggestedSalt, 95);
      suggestedBrine = Math.min(suggestedBrine, 60);
      reasons.push('Snow/ice risk detected, favoring more salt');
    } else if (isRain) {
      suggestedBrine = Math.max(suggestedBrine, 90);
      suggestedSalt = Math.min(suggestedSalt, 70);
      reasons.push('Rain event detected, favoring more brine');
    }

    if (weatherMeta.precipitationInches >= 0.08 && tempF <= 32) {
      suggestedSalt = Math.min(100, suggestedSalt + 8);
      reasons.push('Higher precip with freezing conditions, boosting salt rate');
    }

    if (windSpeed >= 20 || windGust >= 28) {
      suggestedSalt = Math.min(100, suggestedSalt + 5);
      reasons.push('Strong wind detected, adding buffer to salt coverage');
    }

    return {
      saltPct: clampPct(suggestedSalt),
      brinePct: clampPct(suggestedBrine),
      reason: reasons.join(' • '),
    };
  }, [weather, weatherMeta]);

  if (loading)
    return (
      <ZoomableWeather>
        <View style={[styles.container, { backgroundColor: theme.pageBg, paddingTop: insets.top }]}>
          <ActivityIndicator size="large" />
          <Text style={[styles.metaText, { color: theme.muted }]}>Loading weather...</Text>
        </View>
      </ZoomableWeather>
    );

  if (error)
    return (
      <ZoomableWeather>
        <View style={[styles.container, { backgroundColor: theme.pageBg, paddingTop: insets.top }]}>
          <Text style={styles.error}>Error: {error}</Text>
          <Pressable style={styles.refreshButton} onPress={loadWeather}>
            <Text style={styles.refreshButtonText}>Retry</Text>
          </Pressable>
        </View>
      </ZoomableWeather>
    );

  if (!weather || !weatherMeta) {
    return (
      <ZoomableWeather>
        <View style={[styles.container, { backgroundColor: theme.pageBg, paddingTop: insets.top }]}>
          <Text style={styles.error}>Weather data is unavailable.</Text>
        </View>
      </ZoomableWeather>
    );
  }

  const condition = weather.weather?.[0]?.description ?? "unknown";
  const windSpeed = weather.wind?.speed ?? 0;
  const windGust = weather.wind?.gust ?? 0;
  const windDirection = weather.wind?.deg ?? 0;
  const visibilityMiles = weather.visibility ? weather.visibility / 1609.34 : 0;
  const suggestionApplied = recommendation
    ? clampPct(saltPct) === recommendation.saltPct && clampPct(brinePct) === recommendation.brinePct
    : false;

  const weatherIcon = getWeatherIcon(condition);
  const dewPointF = calculateDewPoint(weather.main.temp, weather.main.humidity);
  const frostRisk = calculateFrostRisk(weather.main.temp, weather.main.humidity);
  const frostRiskStyle = frostRisk.riskLevel === "high"
    ? styles.frostRisk_high
    : frostRisk.riskLevel === "moderate"
      ? styles.frostRisk_moderate
      : styles.frostRisk_low;
  return (
    <ZoomableWeather>
      <ScrollView contentContainerStyle={[styles.scrollContent, { backgroundColor: theme.pageBg, paddingTop: insets.top + 8 }]}>
        <View style={[styles.headerCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
          <Text style={[styles.title, { color: theme.title, textAlign: 'center' }]}>📍 {weather.name}</Text>
          <View style={styles.tempWithIcon}>
            <Text style={styles.weatherIcon}>{weatherIcon}</Text>
            <Text style={styles.temp}>{Math.round(weather.main.temp)}°F</Text>
          </View>
          <Text style={[styles.subtitle, { color: theme.text, textAlign: 'center' }]}>{condition}</Text>
          <View style={[styles.frostRiskBadge, frostRiskStyle]}>
            <Text style={styles.frostRiskText}>
              {frostRisk.riskLevel === 'high' ? '⚠️' : frostRisk.riskLevel === 'moderate' ? '⚡' : '✓'} {frostRisk.description}
            </Text>
          </View>
          <Text style={[styles.metaText, { color: theme.muted, textAlign: 'center' }]}>Updated {weatherMeta.updatedAt} local</Text>
          <Pressable style={styles.refreshButton} onPress={loadWeather}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
        </View>

        {recommendation ? (
          <View style={[styles.recommendationCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
            <Text style={styles.recommendationTitle}>Recommended Dispersion</Text>
            <View style={styles.recommendationRow}>
              <View style={styles.recommendationPill}>
                <Text style={styles.recommendationPillLabel}>Salt</Text>
                <Text style={styles.recommendationPillValue}>{recommendation.saltPct}%</Text>
              </View>
              <View style={styles.recommendationPill}>
                <Text style={styles.recommendationPillLabel}>Brine</Text>
                <Text style={styles.recommendationPillValue}>{recommendation.brinePct}%</Text>
              </View>
            </View>
            <Text style={styles.recommendationCurrent}>Current: Salt {clampPct(saltPct)}% • Brine {clampPct(brinePct)}%</Text>
            <Text style={styles.recommendationReason}>{recommendation.reason}</Text>
            <Pressable
              style={[styles.applyButton, suggestionApplied ? styles.applyButtonDone : null]}
              onPress={() => {
                setSaltPct(recommendation.saltPct);
                setBrinePct(recommendation.brinePct);
              }}
            >
              <Text style={styles.applyButtonText}>{suggestionApplied ? 'Recommendation Applied' : 'Apply Recommendation'}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.gridRow}>
          <InfoCard label="Feels Like" value={`${Math.round(weather.main.feels_like)}°F`} />
          <InfoCard label="Humidity" value={`${weather.main.humidity}%`} />
        </View>

        <View style={styles.gridRow}>
          <InfoCard label="Dew Point" value={`${Math.round(dewPointF)}°F`} icon="💧" />
          <InfoCard label="Spread" value={`${(weather.main.temp - dewPointF).toFixed(1)}°F`} icon="📏" detail="Temp vs Dew Point" />
        </View>

        <View style={styles.gridRow}>
          <InfoCard label="High / Low" value={`${Math.round(weather.main.temp_max)}° / ${Math.round(weather.main.temp_min)}°`} />
          <InfoCard label="Pressure" value={`${weather.main.pressure} hPa`} />
        </View>


        <View style={styles.gridRow}>
          <View style={[styles.infoCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
            <Text style={styles.infoLabel}>🌬️ Wind</Text>
            <Text style={styles.infoValue}>{windSpeed.toFixed(1)} mph</Text>
            <Text style={styles.infoDetail}>Dir {windDirection.toFixed(0)}° • Gust {windGust.toFixed(1)} mph</Text>
          </View>
          <InfoCard label="👁️ Visibility" value={`${visibilityMiles.toFixed(1)} mi`} />
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
    </ZoomableWeather>
  );
}

function ZoomableWeather({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  const isPinchingRef = React.useRef(false);
  const pinchStartDistanceRef = React.useRef(0);
  const pinchStartScaleRef = React.useRef(1);

  const distanceBetweenTouches = (event: GestureResponderEvent) => {
    const touches = event.nativeEvent.touches;
    if (touches.length < 2) return 0;
    const first = touches[0];
    const second = touches[1];
    const deltaX = second.pageX - first.pageX;
    const deltaY = second.pageY - first.pageY;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  };

  const beginPinch = (event: GestureResponderEvent) => {
    const startDistance = distanceBetweenTouches(event);
    if (startDistance <= 0) return;
    isPinchingRef.current = true;
    pinchStartDistanceRef.current = startDistance;
    pinchStartScaleRef.current = scale;
  };

  const updatePinch = (event: GestureResponderEvent) => {
    if (event.nativeEvent.touches.length < 2) {
      isPinchingRef.current = false;
      return;
    }
    if (!isPinchingRef.current) {
      beginPinch(event);
      return;
    }

    const currentDistance = distanceBetweenTouches(event);
    const startDistance = pinchStartDistanceRef.current;
    if (startDistance <= 0 || currentDistance <= 0) return;

    const rawScale = pinchStartScaleRef.current * (currentDistance / startDistance);
    const clampedScale = Math.max(1, Math.min(2.5, rawScale));
    setScale(clampedScale);
  };

  const endPinch = () => {
    isPinchingRef.current = false;
  };

  return (
    <View
      style={styles.zoomContainer}
      onStartShouldSetResponder={(event) => event.nativeEvent.touches.length >= 2}
      onMoveShouldSetResponder={(event) => event.nativeEvent.touches.length >= 2}
      onResponderGrant={beginPinch}
      onResponderMove={updatePinch}
      onResponderRelease={endPinch}
      onResponderTerminate={endPinch}
    >
      <View style={{ flex: 1, transform: [{ scale }] }}>{children}</View>
    </View>
  );
}

function InfoCard({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{icon ? `${icon} ${label}` : label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
      {detail ? <Text style={styles.infoDetail}>{detail}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f3f5f8",
    padding: 20,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
    backgroundColor: "#f3f5f8",
  },
  zoomContainer: {
    flex: 1,
  },
  headerCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: '#dce5ef',
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#16324f",
  },
  temp: {
    marginTop: 6,
    fontSize: 42,
    fontWeight: "700",
    color: "#2c6fb7",
  },
  tempWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
  },
  weatherIcon: {
    fontSize: 48,
  },
  frostRiskBadge: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  frostRisk_high: {
    backgroundColor: "#ffebee",
    borderLeftWidth: 3,
    borderLeftColor: "#c62828",
  },
  frostRisk_moderate: {
    backgroundColor: "#fff3e0",
    borderLeftWidth: 3,
    borderLeftColor: "#f57c00",
  },
  frostRisk_low: {
    backgroundColor: "#e8f5e9",
    borderLeftWidth: 3,
    borderLeftColor: "#2e7d32",
  },
  frostRiskText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1f3550",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 16,
    color: "#304863",
    textTransform: "capitalize",
  },
  metaText: {
    marginTop: 4,
    color: "#63788e",
    fontSize: 12,
  },
  refreshButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: "#16324f",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  refreshButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  gridRow: {
    flexDirection: "row",
    gap: 12,
  },
  recommendationCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: '#dce5ef',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  recommendationTitle: {
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
    marginTop: 4,
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
  infoCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: '#dce5ef',
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

import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

export default function WeatherScreen() {
  const [weather, setWeather] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // City and API key
  const API_KEY = "e324705094164f5dc98161647cccc83a";
  const CITY = "Akron,US";

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&units=imperial&appid=${API_KEY}`
        );
        const d = await r.json();
        if (r.ok) setWeather(d);
        else setError(d.message);
      } catch (e: any) {
        setError(e.message);
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading)
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text>Loading weather...</Text>
      </View>
    );

  if (error)
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Error: {error}</Text>
      </View>
    );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weather in {weather.name}</Text>
      <Text style={styles.temp}>{Math.round(weather.main.temp)}°F</Text>
      <Text>{weather.weather[0].description}</Text>
      <Text>Humidity: {weather.main.humidity}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, marginBottom: 10 },
  temp: { fontSize: 40, marginBottom: 10 },
  error: { color: "red", fontSize: 16 },
});

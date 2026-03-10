import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

const BASE_IP = "192.168.4.1"; // AP mode default
const BASE_URL = `http://${BASE_IP}`;

function tryParseJson(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch {
    return { ok: false as const, value: null };
  }
}

export default function ControllerScreen() {
  const [lastCommand, setLastCommand] = useState("None");
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Prevent overlapping requests (helps with "slow" behavior)
  const statusInFlight = useRef(false);

  // GET /status
  // Make sure only one request is in-flight at a time
  const fetchStatus = async () => {
  if (statusInFlight.current) return;
  statusInFlight.current = true;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    let res: Response;
    try {
      // Send GET request with a timeout
      res = await fetch(`${BASE_URL}/status`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    const text = (await res.text()).trim();

    if (!res.ok) {
      // Real HTTP error - show it
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`);
    }

    if (!text) {
      // Empty body - ignore
      return;
    }

    const parsed = tryParseJson(text);
    if (!parsed.ok) {
      // Transient partial response / disconnect - ignore silently
      return;
    }

    setStatus(parsed.value);
    setError(null);
  } catch (e: any) {
    // AbortError / transient network errors: don't spam the UI
    const msg = String(e?.message || e);
    if (msg.includes("aborted") || msg.includes("Network request failed")) {
      return;
    }
    setError(msg);
  } finally {
    statusInFlight.current = false;
  }
};

  // POST /command
  const sendCommand = async (cmd: string) => {
    setLastCommand(cmd);

    try {
      // Send command as JSON
      const res = await fetch(`${BASE_URL}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd }),
      });

      // /command returns plain text like "OK"
      const text = await res.text();

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      setError(null);

      // Refresh status after sending a command
      fetchStatus();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Poll status periodically
  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 2000); // slower + less overlap
    return () => clearInterval(t);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Robot Controller</Text>

      {/* D-Pad */}
      <View style={styles.dpad}>
        <TouchableOpacity style={styles.button} onPress={() => sendCommand("forward")}>
          <Text style={styles.btnText}>↑</Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <TouchableOpacity style={styles.button} onPress={() => sendCommand("left")}>
            <Text style={styles.btnText}>←</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.stopButton]}
            onPress={() => sendCommand("stop")}
          >
            <Text style={styles.btnText}>■</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={() => sendCommand("right")}>
            <Text style={styles.btnText}>→</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.button} onPress={() => sendCommand("backward")}>
          <Text style={styles.btnText}>↓</Text>
        </TouchableOpacity>
      </View>

      {/* Status */}
      <Text style={styles.status}>
        Last Command: <Text style={styles.cmd}>{lastCommand}</Text>
      </Text>

      {/* Base station status (from /status) */}
      <Text style={styles.small}>Base: {BASE_IP}</Text>

      {error ? <Text style={styles.error}>Error: {error}</Text> : null}

      <Text style={styles.small}>
        Robot Status: {status ? JSON.stringify(status) : "Loading..."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  title: { fontSize: 26, fontWeight: "bold", marginBottom: 20 },
  dpad: { alignItems: "center", marginBottom: 30 },
  row: { flexDirection: "row" },
  button: {
    width: 70,
    height: 70,
    backgroundColor: "#1976D2",
    borderRadius: 35,
    justifyContent: "center",
    alignItems: "center",
    margin: 10,
  },
  stopButton: { backgroundColor: "#D32F2F" },
  btnText: { fontSize: 32, color: "white", fontWeight: "bold" },
  status: { marginTop: 20, fontSize: 18 },
  cmd: { fontWeight: "bold" },
  small: { marginTop: 10, fontSize: 12, textAlign: "center" },
  error: { marginTop: 8, color: "red", fontSize: 13, textAlign: "center" },
});

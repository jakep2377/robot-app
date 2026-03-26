import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getJson, getJsonAllowError, postJson, postText, toWebSocketUrl } from "../lib/serverApi";
import PercentSlider from "../components/common/PercentSlider";

type AllowedAction = {
  id: string;
  enabled: boolean;
  reason: string | null;
};

type OperatorNote = {
  id: string;
  text: string;
  at: number;
};

type Alert = {
  level: string;
  code: string;
  message: string;
  at?: number;
};

type SupervisionSummary = {
  mission: {
    id: number;
    state: string;
    coveragePct: number;
    faultCount: number;
    cmdCount: number;
  } | null;
  lora: {
    wpPushState?: string;
    lastCmd?: string | null;
    degraded?: boolean;
    consecutiveFailures?: number;
  } | null;
  safety?: {
    telemetryFailsafeEnabled?: boolean;
    telemetryFailsafeAction?: string;
    telemetryFailsafeAt?: number | null;
    telemetryFailsafeReason?: string | null;
    geofenceFailsafeEnabled?: boolean;
    geofenceFailsafeAction?: string;
    geofenceFailsafeAt?: number | null;
    geofenceFailsafeReason?: string | null;
  } | null;
  robot: {
    state?: string;
    ageMs?: number | null;
    stale?: boolean;
  } | null;
  coverage: {
    coveredPct?: number;
    coveragePercent?: number;
  } | null;
  alerts: Alert[];
  allowedActions: AllowedAction[];
  notes: OperatorNote[];
};

type StatusPayload = {
  battery?: number;
  state?: string;
  mode?: string;
  last_cmd?: string | null;
  last_fault?: unknown;
  queue_depth?: number;
};

type HealthPayload = {
  ok?: boolean;
  ready?: boolean;
  checks?: {
    db?: boolean;
    bridge?: boolean;
    telemetry?: boolean;
  };
  telemetryStale?: boolean;
};

type SummaryResponse = {
  ok: boolean;
  summary: SupervisionSummary;
};

type StatusResponse = StatusPayload;

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  setSaltPct: (value: number) => void;
  setBrinePct: (value: number) => void;
};

const MISSION_ENDPOINTS: Record<string, string> = {
  "mission-start": "/api/mission/start",
  "mission-pause": "/api/mission/pause",
  "mission-resume": "/api/mission/resume",
  "mission-abort": "/api/mission/abort",
  "mission-complete": "/api/mission/complete",
  "push-waypoints": "/api/lora/push-waypoints",
};

export default function ControllerScreen({
  serverUrl,
  saltPct,
  brinePct,
  setSaltPct,
  setBrinePct,
}: Props) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [summary, setSummary] = useState<SupervisionSummary | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [socketState, setSocketState] = useState("polling");
  const refreshInFlight = useRef(false);

  const refresh = async () => {
    if (refreshInFlight.current) {
      return;
    }
    refreshInFlight.current = true;

    try {
      const [statusData, summaryData, healthResult] = await Promise.all([
        getJson<StatusResponse>(serverUrl, "/status"),
        getJson<SummaryResponse>(serverUrl, "/api/supervision/summary"),
        getJsonAllowError<HealthPayload>(serverUrl, "/api/health"),
      ]);

      setStatus(statusData);
      setSummary(summaryData.summary);
      setHealth(healthResult.data);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to refresh server state");
    } finally {
      refreshInFlight.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [serverUrl]);

  useEffect(() => {
    const socket = new WebSocket(toWebSocketUrl(serverUrl));

    socket.onopen = () => setSocketState("live");
    socket.onerror = () => setSocketState("polling");
    socket.onclose = () => setSocketState("polling");
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as {
          event?: string;
          payload?: unknown;
        };

        if (message.event === "supervision.updated" && message.payload) {
          setSummary(message.payload as SupervisionSummary);
          return;
        }

        if (message.event === "state.snapshot" || message.event === "mission.updated" || message.event === "telemetry.updated" || message.event === "fault.received") {
          refresh();
        }
      } catch {
        setSocketState("polling");
      }
    };

    return () => {
      socket.close();
    };
  }, [serverUrl]);

  const performCommand = async (command: string) => {
    setPendingAction(command);
    try {
      await postText(serverUrl, "/command", command.toUpperCase());
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Command failed: ${command}`);
    } finally {
      setPendingAction(null);
    }
  };

  const performAction = async (actionId: string) => {
    const endpoint = MISSION_ENDPOINTS[actionId];
    if (!endpoint) {
      if (actionId === "command-reset") {
        await performCommand("RESET");
      }
      return;
    }

    setPendingAction(actionId);
    try {
      await postJson(serverUrl, endpoint, {});
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Action failed: ${actionId}`);
    } finally {
      setPendingAction(null);
    }
  };

  const submitNote = async () => {
    if (!noteText.trim()) {
      return;
    }

    setPendingAction("note");
    try {
      await postJson(serverUrl, "/api/operator/notes", {
        text: noteText.trim(),
        category: "field",
        actor: "field-op",
      });
      setNoteText("");
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Note submission failed");
    } finally {
      setPendingAction(null);
    }
  };

  const allowedAction = (actionId: string) => summary?.allowedActions.find((action) => action.id === actionId);
  const missionState = summary?.mission?.state ?? status?.state ?? "UNKNOWN";
  const coveragePct = summary?.coverage?.coveredPct ?? summary?.coverage?.coveragePercent ?? summary?.mission?.coveragePct ?? 0;
  const hasCriticalAlert = (summary?.alerts ?? []).some((alert) => alert.level === "critical");
  const latestAlert = summary?.alerts?.[summary.alerts.length - 1] ?? null;
  const recentNotes = (summary?.notes ?? []).slice(-2).reverse();
  const theme = {
    pageBg: '#f3f5f8',
    cardBg: '#ffffff',
    cardBorder: '#dde5ef',
    title: '#13233a',
    sectionTitle: '#16324f',
    text: '#304863',
    muted: '#63788e',
    inputBg: '#fbfcfe',
    inputBorder: '#c8d0da',
    inputText: '#13233a',
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.pageBg, paddingTop: insets.top + 8 }]}> 
      <Text style={[styles.title, { color: theme.title }]}>Robot Controller</Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusPill, socketState === 'live' ? styles.statusPillLive : styles.statusPillPoll]}>
          <Text style={styles.statusPillText}>{socketState === 'live' ? '● Live' : '◌ Polling'}</Text>
        </View>
        <View style={[styles.statusPill, styles.statusPillMission]}>
          <Text style={styles.statusPillText}>{missionState}</Text>
        </View>
        <View style={[styles.statusPill, hasCriticalAlert ? styles.statusPillCritical : styles.statusPillOk]}>
          <Text style={styles.statusPillText}>{hasCriticalAlert ? "Critical Alert" : "No Critical Alerts"}</Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Quick Status</Text>
        <View style={styles.quickGrid}>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Mission</Text><Text style={[styles.quickValue, { color: theme.text }]}>{missionState}</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Coverage</Text><Text style={[styles.quickValue, { color: theme.text }]}>{coveragePct.toFixed(1)}%</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Robot</Text><Text style={[styles.quickValue, { color: theme.text }]}>{summary?.robot?.state ?? status?.state ?? "UNKNOWN"}</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Server</Text><Text style={[styles.quickValue, { color: theme.text }]}>{health?.ready ? "Ready" : "Not Ready"}</Text></View>
        </View>
        <Text style={[styles.metaText, { color: theme.muted }]}>Telemetry {health?.checks?.telemetry ? "OK" : "Stale"} · Bridge {health?.checks?.bridge ? "OK" : "Issue"} · Queue {status?.queue_depth ?? 0}</Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Mission Controls</Text>
        <View style={styles.actionGrid}>
          <ActionButton label="Push WP" onPress={() => performAction("push-waypoints")} disabled={!allowedAction("push-waypoints")?.enabled} busy={pendingAction === "push-waypoints"} />
          <ActionButton label="Start" onPress={() => performAction("mission-start")} disabled={!allowedAction("mission-start")?.enabled} busy={pendingAction === "mission-start"} />
          <ActionButton label="Pause" onPress={() => performAction("mission-pause")} disabled={!allowedAction("mission-pause")?.enabled} busy={pendingAction === "mission-pause"} />
          <ActionButton label="Resume" onPress={() => performAction("mission-resume")} disabled={!allowedAction("mission-resume")?.enabled} busy={pendingAction === "mission-resume"} />
          <ActionButton label="Complete" onPress={() => performAction("mission-complete")} disabled={!allowedAction("mission-complete")?.enabled} busy={pendingAction === "mission-complete"} />
          <ActionButton label="Abort" onPress={() => performAction("mission-abort")} disabled={!allowedAction("mission-abort")?.enabled} busy={pendingAction === "mission-abort"} danger />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.sectionTitle, marginTop: 8 }]}>Emergency</Text>
        <View style={styles.actionGrid}>
          <ActionButton label="E-Stop" onPress={() => performCommand("ESTOP")} danger busy={pendingAction === "ESTOP"} />
          <ActionButton label="Reset" onPress={() => performAction("command-reset")} disabled={!allowedAction("command-reset")?.enabled} busy={pendingAction === "command-reset"} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Dispersion</Text>
        <PercentSlider
          label="Salt"
          value={saltPct}
          onChange={setSaltPct}
          accentColor="#2d8a65"
        />

        <PercentSlider
          label="Brine"
          value={brinePct}
          onChange={setBrinePct}
          accentColor="#2c6fb7"
        />
        <Text style={[styles.metaText, { color: theme.muted }]}>Used when planning path waypoints from the map.</Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Alerts</Text>
        {latestAlert ? (
          <View style={[styles.alertRow, latestAlert.level === "critical" ? styles.alertCritical : styles.alertWarning]}>
            <Text style={styles.alertCode}>{latestAlert.code}</Text>
            <Text style={styles.alertMessage}>{latestAlert.message}</Text>
          </View>
        ) : (
          <Text style={[styles.metaText, { color: theme.muted }]}>No active alerts.</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Field Notes</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Keep short notes for handoff, recovery, or anything the next operator should know.</Text>
        <TextInput
          style={[styles.input, styles.noteInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Add a short field note"
          placeholderTextColor={theme.muted}
          multiline
        />
        <Pressable style={styles.secondaryButton} onPress={submitNote} disabled={pendingAction === "note"}>
          <Text style={styles.secondaryButtonText}>{pendingAction === "note" ? "Saving..." : "Save Note"}</Text>
        </Pressable>
        {recentNotes.length ? (
          recentNotes.map((note) => (
            <View key={note.id} style={styles.noteRow}>
              <Text style={[styles.noteMeta, { color: theme.muted }]}>{new Date(note.at).toLocaleString()}</Text>
              <Text style={[styles.noteText, { color: theme.text }]}>{note.text}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.metaText, { color: theme.muted }]}>No notes yet.</Text>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  busy,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.actionButton,
        danger ? styles.actionDanger : null,
        disabled || busy ? styles.actionDisabled : null,
      ]}
    >
      <Text style={styles.actionText}>{busy ? `${label}...` : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    backgroundColor: "#f3f5f8",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#13233a",
    textAlign: "center",
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 2,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  statusPillLive: {
    backgroundColor: '#1a9a5b',
  },
  statusPillPoll: {
    backgroundColor: '#b06414',
  },
  statusPillMission: {
    backgroundColor: '#2c6fb7',
  },
  statusPillRobot: {
    backgroundColor: '#5a3a8a',
  },
  statusPillMaterial: {
    backgroundColor: '#4a5a6a',
  },
  statusPillOk: {
    backgroundColor: '#1a9a5b',
  },
  statusPillCritical: {
    backgroundColor: '#b63d3d',
  },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: '#dde5ef',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#16324f",
  },
  input: {
    borderWidth: 1,
    borderColor: "#c8d0da",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fbfcfe",
  },
  noteInput: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  secondaryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#16324f",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  metric: {
    fontSize: 15,
    color: "#304863",
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickItem: {
    width: "47%",
    borderWidth: 1,
    borderColor: "#e3eaf2",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fbfcfe",
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  quickValue: {
    fontSize: 15,
    fontWeight: "700",
  },
  metaText: {
    fontSize: 12,
    color: "#63788e",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionButton: {
    minWidth: 96,
    backgroundColor: "#2d8a65",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  actionDanger: {
    backgroundColor: "#b63d3d",
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  alertRow: {
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  alertWarning: {
    backgroundColor: "#fff3dd",
  },
  alertCritical: {
    backgroundColor: "#ffe1e1",
  },
  alertCode: {
    fontWeight: "700",
    color: "#16324f",
  },
  alertMessage: {
    color: "#304863",
  },
  noteRow: {
    borderTopWidth: 1,
    borderTopColor: "#e1e6ec",
    paddingTop: 10,
    gap: 4,
  },
  noteMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#63788e",
  },
  noteText: {
    color: "#22374d",
  },
  error: {
    color: "#b63d3d",
    paddingBottom: 24,
  },
});

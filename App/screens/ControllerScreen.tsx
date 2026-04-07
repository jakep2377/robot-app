import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
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
import AppButton from "../components/common/AppButton";
import AppCard from "../components/common/AppCard";

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

type TestMenuInputSpec = {
  field: string;
  label: string;
  placeholder?: string;
};

type TestMenuAction = {
  id: string;
  title: string;
  description?: string;
  group?: string;
  caution?: string;
  shortcut?: string;
  kind?: string;
  needsInput?: TestMenuInputSpec | null;
};

type CommandTransport = {
  stage?: string | null;
  baseStationCommandStatus?: string | null;
  ackCategory?: string | null;
  ackSource?: string | null;
  robotAckState?: string | null;
  waypointIndex?: number | null;
  waypointCount?: number | null;
};

type CommandHistoryEntry = {
  commandId: string;
  cmd?: string | null;
  status?: string | null;
  source?: string | null;
  error?: string | null;
  updatedAt?: number;
  at?: number;
  transport?: CommandTransport | null;
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
  connectivity?: {
    overall?: {
      state?: string;
      ready?: boolean;
      reason?: string | null;
      missionState?: string;
    } | null;
    backend?: {
      state?: string;
      dbOk?: boolean;
    } | null;
    baseStation?: {
      state?: string;
      reachable?: boolean;
      queueDepth?: number | null;
      lastCmdStatus?: string | null;
    } | null;
    robot?: {
      state?: string;
      reachable?: boolean;
      telemetryStale?: boolean;
      gpsReady?: boolean;
      robotState?: string | null;
    } | null;
    commandPath?: {
      state?: string;
      ready?: boolean;
      lastCommandId?: string | null;
      lastCommandStatus?: string | null;
    } | null;
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
  last_cmd_id?: string | null;
  last_cmd_status?: string | null;
  last_fault?: unknown;
  queue_depth?: number;
  connectivity?: {
    state?: string;
    ready?: boolean;
    reason?: string | null;
  } | null;
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

type TestMenuRunResponse = {
  ok: boolean;
  actionId?: string;
  result?: Record<string, unknown>;
};

type TestMenuResponse = {
  ok: boolean;
  tests: TestMenuAction[];
  commandHistory?: CommandHistoryEntry[];
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
  const [testMenu, setTestMenu] = useState<TestMenuAction[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [socketState, setSocketState] = useState("polling");
  const [manualControlVisible, setManualControlVisible] = useState(false);
  const refreshInFlight = useRef(false);

  const refresh = async () => {
    if (refreshInFlight.current) {
      return;
    }
    refreshInFlight.current = true;

    try {
      const [statusData, summaryData, healthResult, testMenuResult] = await Promise.all([
        getJson<StatusResponse>(serverUrl, "/status"),
        getJson<SummaryResponse>(serverUrl, "/api/supervision/summary"),
        getJsonAllowError<HealthPayload>(serverUrl, "/api/health"),
        getJsonAllowError<TestMenuResponse>(serverUrl, "/api/test-menu"),
      ]);

      setStatus(statusData);
      setSummary(summaryData.summary);
      setHealth(healthResult.data);
      if (testMenuResult.ok && testMenuResult.data?.ok) {
        setTestMenu(Array.isArray(testMenuResult.data.tests) ? testMenuResult.data.tests : []);
        setCommandHistory(Array.isArray(testMenuResult.data.commandHistory) ? testMenuResult.data.commandHistory : []);
      }
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

        if (
          message.event === "state.snapshot" ||
          message.event === "mission.updated" ||
          message.event === "telemetry.updated" ||
          message.event === "fault.received" ||
          message.event === "command.received" ||
          message.event === "path.updated" ||
          message.event === "area.updated" ||
          message.event === "operator.updated"
        ) {
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

  const setTestInputValue = (field: string, value: string) => {
    setTestInputs((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const runServerTest = async (action: TestMenuAction) => {
    const field = action.needsInput?.field;
    const rawValue = field ? (testInputs[field] ?? "").trim() : "";

    if (field && !rawValue) {
      setError(`${action.needsInput?.label ?? action.title} is required.`);
      return;
    }

    setPendingAction(action.id);
    try {
      const payload: Record<string, unknown> = { actionId: action.id };
      if (field) {
        payload[field] = rawValue;
      }
      const response = await postJson<TestMenuRunResponse>(serverUrl, "/api/test-menu/run", payload);
      const resultSummary = response?.result ? JSON.stringify(response.result) : "Completed";
      setTestResult(`${action.title}: ${resultSummary}`);
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `${action.title} failed`);
    } finally {
      setPendingAction(null);
    }
  };

  const groupedTestMenu = useMemo(() => {
    const groups = new Map<string, TestMenuAction[]>();
    for (const action of testMenu) {
      const groupName = action.group ?? "Operations";
      const existing = groups.get(groupName) ?? [];
      existing.push(action);
      groups.set(groupName, existing);
    }
    return Array.from(groups.entries());
  }, [testMenu]);

  const allowedAction = (actionId: string) => summary?.allowedActions.find((action) => action.id === actionId);
  const missionState = summary?.mission?.state ?? status?.state ?? "UNKNOWN";
  const coveragePct = summary?.coverage?.coveredPct ?? summary?.coverage?.coveragePercent ?? summary?.mission?.coveragePct ?? 0;
  const hasCriticalAlert = (summary?.alerts ?? []).some((alert) => alert.level === "critical");
  const latestAlert = summary?.alerts?.[summary.alerts.length - 1] ?? null;
  const recentNotes = (summary?.notes ?? []).slice(-2).reverse();
  const recentCommands = commandHistory.slice(0, 6);
  const latestCommand = recentCommands[0] ?? null;
  const connection = summary?.connectivity ?? null;
  const overallConnectionState = connection?.overall?.state ?? status?.connectivity?.state ?? (health?.ready ? "online" : "degraded");
  const backendState = connection?.backend?.state ?? (health?.checks?.db ? "online" : "degraded");
  const baseStationState = connection?.baseStation?.state ?? (health?.checks?.bridge ? "online" : "degraded");
  const robotLinkState = connection?.robot?.state ?? (health?.checks?.telemetry ? "online" : "stale");
  const commandPathState = connection?.commandPath?.state ?? "unknown";
  const connectionReason = connection?.overall?.reason ?? status?.connectivity?.reason ?? null;
  const connectionPillStyle = overallConnectionState === "online"
    ? styles.statusPillLive
    : overallConnectionState === "ready"
      ? styles.statusPillOk
      : overallConnectionState === "degraded" || overallConnectionState === "stale"
        ? styles.statusPillPoll
        : styles.statusPillCritical;
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
          <Text style={styles.statusPillText}>{socketState === 'live' ? 'Live' : 'Polling'}</Text>
        </View>
        <View style={[styles.statusPill, styles.statusPillMission]}>
          <Text style={styles.statusPillText}>{missionState}</Text>
        </View>
        <View style={[styles.statusPill, connectionPillStyle]}>
          <Text style={styles.statusPillText}>{overallConnectionState.toUpperCase()}</Text>
        </View>
        <View style={[styles.statusPill, hasCriticalAlert ? styles.statusPillCritical : styles.statusPillOk]}>
          <Text style={styles.statusPillText}>{hasCriticalAlert ? "Critical Alert" : "No Critical Alerts"}</Text>
        </View>
      </View>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Quick Status</Text>
        <View style={styles.quickGrid}>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Mission</Text><Text style={[styles.quickValue, { color: theme.text }]}>{missionState}</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Coverage</Text><Text style={[styles.quickValue, { color: theme.text }]}>{coveragePct.toFixed(1)}%</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Backend</Text><Text style={[styles.quickValue, { color: theme.text }]}>{backendState.toUpperCase()}</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Base Station</Text><Text style={[styles.quickValue, { color: theme.text }]}>{baseStationState.toUpperCase()}</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Robot Link</Text><Text style={[styles.quickValue, { color: theme.text }]}>{robotLinkState.toUpperCase()}</Text></View>
          <View style={styles.quickItem}><Text style={[styles.quickLabel, { color: theme.muted }]}>Command Path</Text><Text style={[styles.quickValue, { color: theme.text }]}>{commandPathState.toUpperCase()}</Text></View>
        </View>
        <Text style={[styles.metaText, { color: theme.muted }]}>
          Cmd {status?.last_cmd ?? summary?.lora?.lastCmd ?? "--"} | Status {status?.last_cmd_status ?? connection?.commandPath?.lastCommandStatus ?? "unknown"} | Queue {connection?.baseStation?.queueDepth ?? status?.queue_depth ?? 0}
        </Text>
        {connectionReason ? <Text style={[styles.metaText, { color: theme.muted }]}>{connectionReason}</Text> : null}
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Mission Controls</Text>
        <View style={styles.missionActionGrid}>
          <ActionButton label="Commit" onPress={() => performAction("push-waypoints")} disabled={!allowedAction("push-waypoints")?.enabled} busy={pendingAction === "push-waypoints"} compact />
          <ActionButton label="Start" onPress={() => performAction("mission-start")} disabled={!allowedAction("mission-start")?.enabled} busy={pendingAction === "mission-start"} compact />
          <ActionButton label="Pause" onPress={() => performAction("mission-pause")} disabled={!allowedAction("mission-pause")?.enabled} busy={pendingAction === "mission-pause"} compact />
          <ActionButton label="Resume" onPress={() => performAction("mission-resume")} disabled={!allowedAction("mission-resume")?.enabled} busy={pendingAction === "mission-resume"} compact />
          <ActionButton label="Finish" onPress={() => performAction("mission-complete")} disabled={!allowedAction("mission-complete")?.enabled} busy={pendingAction === "mission-complete"} compact />
          <ActionButton label="Abort" onPress={() => performAction("mission-abort")} disabled={!allowedAction("mission-abort")?.enabled} busy={pendingAction === "mission-abort"} danger compact />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.sectionTitle, marginTop: 8 }]}>Emergency</Text>
        <View style={styles.actionGrid}>
          <ActionButton label="E-Stop" onPress={() => performCommand("ESTOP")} danger busy={pendingAction === "ESTOP"} />
          <ActionButton label="Reset" onPress={() => performAction("command-reset")} disabled={!allowedAction("command-reset")?.enabled} busy={pendingAction === "command-reset"} />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.sectionTitle, marginTop: 8 }]}>Manual Override</Text>
        <AppButton label="Open Manual Control" onPress={() => setManualControlVisible(true)} style={styles.manualLauncher} />
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
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
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Alerts</Text>
        {latestAlert ? (
          <View style={[styles.alertRow, latestAlert.level === "critical" ? styles.alertCritical : styles.alertWarning]}>
            <Text style={styles.alertCode}>{latestAlert.code}</Text>
            <Text style={styles.alertMessage}>{latestAlert.message}</Text>
          </View>
        ) : (
          <Text style={[styles.metaText, { color: theme.muted }]}>No alerts.</Text>
        )}
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Operations</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Server-backed checks and individual system actions.</Text>
        {groupedTestMenu.length ? groupedTestMenu.map(([groupName, actions]) => (
          <View key={groupName} style={styles.opsGroup}>
            <Text style={[styles.opsGroupTitle, { color: theme.sectionTitle }]}>{groupName}</Text>
            {actions.map((action) => {
              const field = action.needsInput?.field;
              const inputValue = field ? (testInputs[field] ?? "") : "";
              const variant = action.caution === "danger"
                ? "danger"
                : action.caution === "safe"
                  ? "secondary"
                  : "primary";

              return (
                <View key={action.id} style={styles.opsActionRow}>
                  <View style={styles.opsActionTextBlock}>
                    <Text style={[styles.opsActionTitle, { color: theme.text }]}>
                      {action.title}{action.shortcut ? ` (${action.shortcut})` : ""}
                    </Text>
                    {action.description ? <Text style={[styles.metaText, { color: theme.muted }]}>{action.description}</Text> : null}
                  </View>
                  {field ? (
                    <View style={styles.opsInputRow}>
                      <TextInput
                        style={[styles.input, styles.opsInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                        value={inputValue}
                        onChangeText={(value) => setTestInputValue(field, value)}
                        placeholder={action.needsInput?.placeholder ?? action.needsInput?.label ?? action.title}
                        placeholderTextColor={theme.muted}
                        autoCapitalize="none"
                      />
                      <AppButton
                        label={pendingAction === action.id ? "Running..." : "Run"}
                        onPress={() => runServerTest(action)}
                        disabled={pendingAction === action.id}
                        compact
                        variant={variant as "primary" | "secondary" | "success" | "danger"}
                        style={styles.opsButton}
                      />
                    </View>
                  ) : (
                    <AppButton
                      label={pendingAction === action.id ? "Running..." : "Run"}
                      onPress={() => runServerTest(action)}
                      disabled={pendingAction === action.id}
                      compact
                      variant={variant as "primary" | "secondary" | "success" | "danger"}
                      style={styles.opsButton}
                    />
                  )}
                </View>
              );
            })}
          </View>
        )) : (
          <Text style={[styles.metaText, { color: theme.muted }]}>No server operations available.</Text>
        )}
        {testResult ? <Text style={[styles.metaText, { color: theme.muted }]}>{testResult}</Text> : null}
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Recent Commands</Text>
        {recentCommands.length ? recentCommands.map((entry) => (
          <View key={entry.commandId} style={styles.commandHistoryRow}>
            <View style={styles.commandHistoryTextBlock}>
              <Text style={[styles.commandHistoryTitle, { color: theme.text }]}>{entry.cmd ?? entry.commandId}</Text>
              <Text style={[styles.metaText, { color: theme.muted }]}>
                {entry.commandId} | {entry.transport?.stage ?? entry.status ?? "unknown"}
                {entry.transport?.ackCategory ? ` | ${entry.transport.ackCategory}` : ""}
              </Text>
              {entry.error ? <Text style={styles.error}>{entry.error}</Text> : null}
            </View>
            <Text style={[styles.noteMeta, { color: theme.muted }]}>{new Date(entry.updatedAt ?? entry.at ?? Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
          </View>
        )) : (
          <Text style={[styles.metaText, { color: theme.muted }]}>No command activity yet.</Text>
        )}
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Field Notes</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Short notes for handoff.</Text>
        <TextInput
          style={[styles.input, styles.noteInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Add a note"
          placeholderTextColor={theme.muted}
          multiline
        />
        <AppButton
          label={pendingAction === "note" ? "Saving..." : "Save Note"}
          onPress={submitNote}
          disabled={pendingAction === "note"}
          variant="secondary"
          style={styles.secondaryButton}
        />
        {recentNotes.length ? (
          recentNotes.map((note) => (
            <View key={note.id} style={styles.noteRow}>
              <Text style={[styles.noteMeta, { color: theme.muted }]}>{new Date(note.at).toLocaleString()}</Text>
              <Text style={[styles.noteText, { color: theme.text }]}>{note.text}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.metaText, { color: theme.muted }]}>No notes.</Text>
        )}
      </AppCard>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal
        visible={manualControlVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setManualControlVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Manual Control</Text>
                <Text style={styles.modalSubtitle}>Direct drive controls.</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={() => setManualControlVisible(false)}>
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.modalStatusText}>Mission {missionState} | Robot {summary?.robot?.state ?? status?.state ?? "UNKNOWN"} | Cmd {status?.last_cmd ?? summary?.lora?.lastCmd ?? "--"}</Text>

            <View style={styles.dpad}>
              <Pressable style={styles.commandButton} onPress={() => performCommand("FORWARD")}>
                <Text style={styles.commandText}>{pendingAction === "FORWARD" ? "FWD..." : "FWD"}</Text>
              </Pressable>
              <View style={styles.row}>
                <Pressable style={styles.commandButton} onPress={() => performCommand("LEFT")}>
                  <Text style={styles.commandText}>{pendingAction === "LEFT" ? "LEFT..." : "LEFT"}</Text>
                </Pressable>
                <Pressable style={[styles.commandButton, styles.stopButton]} onPress={() => performCommand("STOP")}>
                  <Text style={styles.commandText}>{pendingAction === "STOP" ? "STOP..." : "STOP"}</Text>
                </Pressable>
                <Pressable style={styles.commandButton} onPress={() => performCommand("RIGHT")}>
                  <Text style={styles.commandText}>{pendingAction === "RIGHT" ? "RIGHT..." : "RIGHT"}</Text>
                </Pressable>
              </View>
              <Pressable style={styles.commandButton} onPress={() => performCommand("BACKWARD")}>
                <Text style={styles.commandText}>{pendingAction === "BACKWARD" ? "BACK..." : "BACK"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  busy,
  danger,
  compact,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  compact?: boolean;
}) {
  return (
    <AppButton
      label={busy ? `${label}...` : label}
      onPress={onPress}
      disabled={disabled || busy}
      variant={danger ? "danger" : "success"}
      compact={compact}
      style={[
        styles.actionButton,
        compact ? styles.missionActionGridButton : null,
      ]}
      textStyle={styles.actionText}
    />
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
    minHeight: 30,
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: "center",
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
  card: {},
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
    minWidth: 112,
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
  dpad: {
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  commandButton: {
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2c6fb7",
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  stopButton: {
    backgroundColor: "#b63d3d",
  },
  commandText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  missionActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  actionButton: {
    width: "48%",
  },
  missionActionGridButton: {
    width: "31.5%",
  },
  actionText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  manualLauncher: {
    alignSelf: "flex-start",
    minWidth: 168,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(19, 35, 58, 0.62)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 18,
    gap: 14,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  modalHeaderText: {
    flex: 1,
    gap: 4,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#13233a",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#63788e",
  },
  modalCloseButton: {
    backgroundColor: "#e8eef5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalCloseButtonText: {
    color: "#16324f",
    fontWeight: "700",
  },
  modalStatusText: {
    fontSize: 12,
    color: "#63788e",
    flexWrap: "wrap",
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
  opsGroup: {
    marginTop: 10,
    gap: 8,
  },
  opsGroupTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#16324f",
  },
  opsActionRow: {
    gap: 8,
    borderWidth: 1,
    borderColor: "#e3eaf2",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#fbfcfe",
  },
  opsActionTextBlock: {
    gap: 2,
  },
  opsActionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#22374d",
  },
  opsInputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  opsInput: {
    flex: 1,
    minHeight: 42,
  },
  opsButton: {
    minWidth: 92,
  },
  commandHistoryRow: {
    borderTopWidth: 1,
    borderTopColor: "#e1e6ec",
    paddingTop: 10,
    gap: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  commandHistoryTextBlock: {
    flex: 1,
    gap: 2,
    paddingRight: 8,
  },
  commandHistoryTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#22374d",
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











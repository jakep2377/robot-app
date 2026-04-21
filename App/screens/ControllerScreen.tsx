import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { getGatewayJsonAllowError, getJsonAllowError, postGatewayText, postJson, postText, toWebSocketUrl } from "../lib/serverApi";
import PercentSlider from "../components/common/PercentSlider";
import AppButton from "../components/common/AppButton";
import AppCard from "../components/common/AppCard";
import { JoystickControl, JoystickState } from "../components/common/Joystick";

// ControllerScreen is the operator cockpit for direct control, supervision,
// and demo-mode workflows. It pulls together manual commands, readiness state,
// transport history, and bench-test actions in one intentionally dense screen.

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

type DemoSpot = {
  at?: number;
  markedAt?: number;
  source?: string | null;
  note?: string | null;
  robot?: {
    state?: string | null;
    gpsFix?: boolean | null;
    lat?: number | null;
    lon?: number | null;
  } | null;
};

type DemoSpotStatus = {
  ready?: boolean;
  reason?: string | null;
};

type DemoConfig = {
  laneWidthM?: number;
  cellSizeM?: number;
  coverageWidthM?: number;
  allowWeakGps?: boolean;
  geofenceToleranceM?: number;
  minSpotDistanceM?: number;
  passes?: number;
  obstaclePolicyEnabled?: boolean;
  obstacleStopCm?: number;
  obstacleSidestepCm?: number;
  obstacleCooldownMs?: number;
  obstacleSidestepMs?: number;
};

type DemoReadiness = {
  missionState?: string;
  hasStart?: boolean;
  hasEnd?: boolean;
  hasPath?: boolean;
  wpPushState?: string;
  gpsReady?: boolean;
  gpsReason?: string | null;
  readyToPlan?: boolean;
  readyToRun?: boolean;
  blockers?: string[];
};

type DemoPathPoint = {
  lat: number;
  lon: number;
  salt?: number;
  brine?: number;
};

type DemoPathBuildResponse = {
  warnings?: string[];
  waypointPush?: {
    ok?: boolean;
    error?: string | null;
    sent?: number;
    queuedRemote?: boolean;
    truncated?: boolean;
    totalPoints?: number;
  } | null;
  path?: {
    mode?: string;
    pointCount?: number;
    points?: DemoPathPoint[];
  } | null;
};

type DemoObstacleState = {
  active?: boolean;
  mode?: string | null;
  side?: string | null;
  nearestCm?: number | null;
  at?: number | null;
  cooldownUntil?: number | null;
  note?: string | null;
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
    heading?: number | null;
    ageMs?: number | null;
    stale?: boolean;
    motor?: {
      m1?: number;
      m2?: number;
    } | null;
    prox?: {
      left?: number | null;
      right?: number | null;
    } | null;
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
      connectionPath?: string | null;
      connectionPathLabel?: string | null;
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
      connectionPath?: string | null;
      connectionPathLabel?: string | null;
      stationState?: string | null;
      mode?: string | null;
      wifiLinkState?: string | null;
      loraLinkState?: string | null;
    } | null;
    gateway?: {
      state?: string;
      reachable?: boolean;
      working?: boolean;
      reason?: string | null;
      linkState?: string | null;
      evidence?: string | null;
      lastAck?: string | null;
      lastLoRa?: string | null;
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
  demo?: {
    enabled?: boolean;
    updatedAt?: number | null;
    source?: string | null;
    spots?: {
      start?: DemoSpot | null;
      end?: DemoSpot | null;
    } | null;
    spotGpsStatus?: {
      start?: DemoSpotStatus | null;
      end?: DemoSpotStatus | null;
    } | null;
    config?: DemoConfig | null;
    obstacle?: DemoObstacleState | null;
    readiness?: DemoReadiness | null;
    diagnostics?: {
      missionState?: string | null;
      wpPushState?: string | null;
      loraDegraded?: boolean;
      loraLastError?: string | null;
      commandPathState?: string | null;
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
  manual_command_url?: string | null;
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
    gateway?: boolean;
    telemetry?: boolean;
  };
  telemetryStale?: boolean;
  persistence?: {
    restoredAt?: number | null;
    lastSavedAt?: number | null;
    lastSaveReason?: string | null;
    lastSaveError?: string | null;
    exists?: boolean;
  } | null;
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

// The large group of response/type definitions above mirrors backend payloads
// closely so UI code can stay defensive around partially-populated status data.

type TestMenuResponse = {
  ok: boolean;
  tests: TestMenuAction[];
  commandHistory?: CommandHistoryEntry[];
};

type StatusResponse = StatusPayload;



type Props = {
  serverUrl: string;
  manualServerUrl?: string;
  saltPct: number;
  brinePct: number;
  setSaltPct: (value: number) => void;
  setBrinePct: (value: number) => void;
  connectionLabel: string;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'fallback' | 'error';
  connectionDetail: string;
  connectionMode: 'discovering' | 'local' | 'cloud' | 'manual';
  connectionBusy: boolean;
  onOpenConnection: () => void;
  onDemoPathPreviewChange?: (points: DemoPathPoint[]) => void;
};

const MISSION_ENDPOINTS: Record<string, string> = {
  "mission-start": "/api/mission/start",
  "mission-pause": "/api/mission/pause",
  "mission-resume": "/api/mission/resume",
  "mission-abort": "/api/mission/abort",
  "mission-complete": "/api/mission/complete",
  "push-waypoints": "/api/lora/push-waypoints",
};

const FALLBACK_TEST_MENU: TestMenuAction[] = [
  { id: "mode-manual", title: "Mode Manual", description: "Put the robot into MANUAL.", caution: "safe", group: "Modes" },
  { id: "mode-auto", title: "Mode Auto", description: "Send AUTO to the robot.", caution: "caution", group: "Modes" },
  { id: "ack-pause", title: "Pause ACK", description: "Send PAUSE and verify response.", caution: "safe", group: "Modes" },
  { id: "ack-reset", title: "Reset ACK", description: "Send RESET and verify recovery.", caution: "caution", group: "Modes" },
  { id: "drive-forward", title: "Drive Forward", description: "Send a single forward drive command.", caution: "danger", group: "Drive" },
  { id: "drive-left", title: "Drive Left", description: "Send a single left steer command.", caution: "danger", group: "Drive" },
  { id: "drive-stop", title: "Drive Stop", description: "Send STOP to halt motion.", caution: "safe", group: "Drive" },
  { id: "drive-right", title: "Drive Right", description: "Send a single right steer command.", caution: "danger", group: "Drive" },
  { id: "drive-backward", title: "Drive Back", description: "Send a single reverse drive command.", caution: "danger", group: "Drive" },
  { id: "salt-50", title: "Salt 50%", description: "Bench-test salt output.", caution: "caution", group: "Dispersion" },
  { id: "brine-50", title: "Brine 50%", description: "Bench-test brine output.", caution: "caution", group: "Dispersion" },
  { id: "agitator-on", title: "Agitator ON", description: "Toggle the agitator for testing.", caution: "caution", group: "Dispersion" },
  { id: "thrower-on", title: "Thrower ON", description: "Toggle the thrower for testing.", caution: "caution", group: "Dispersion" },
  { id: "relay-on", title: "Relay ON", description: "Toggle the relay for testing.", caution: "caution", group: "Dispersion" },
  { id: "vibration-on", title: "Vibration ON", description: "Toggle the vibration motor for testing.", caution: "caution", group: "Dispersion" },
  { id: "safe-off", title: "Safe Outputs Off", description: "Stop all outputs safely.", caution: "safe", group: "Dispersion" },
  { id: "raw-command", title: "Raw Command", description: "Send a custom plain-text command.", caution: "danger", group: "Advanced", needsInput: { field: "cmdText", label: "Command", placeholder: "CMD:AUTO,SALT:25,BRINE:75" } },
];

function formatReadableValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return formatReadableValue(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(formatReadableValue).filter((item): item is string => Boolean(item));
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => {
        const formatted = formatReadableValue(inner);
        return formatted ? `${key}: ${formatted}` : null;
      })
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(" | ") : null;
  }
  return null;
}

function summarizeCommandResult(title: string, response: TestMenuRunResponse): string {
  if (!response || typeof response !== "object") {
    return `${title}: Completed`;
  }

  const result = response.result;
  if (!result || typeof result !== "object") {
    return `${title}: ${response.ok ? "Completed" : "Failed"}`;
  }

  const error = typeof result.error === "string" ? result.error : null;
  if (error) {
    return `${title}: ${error}`;
  }

  const typedResult = result as Record<string, unknown>;
  const steps = Array.isArray(typedResult.steps) ? typedResult.steps : null;
  if (steps) {
    const failed = steps.find((step) => step && typeof step === "object" && (step as Record<string, unknown>).ok === false) as Record<string, unknown> | undefined;
    if (failed) {
      const failedCommand = typeof failed.command === "string" ? failed.command : "A step";
      const failedError = typeof failed.error === "string" ? failed.error : null;
      return `${title}: ${failedCommand} failed${failedError ? ` (${failedError})` : ""}`;
    }
    return `${title}: ${steps.length} step${steps.length === 1 ? "" : "s"} completed`;
  }

  if (typeof typedResult.sent === "number") {
    return `${title}: ${typedResult.sent} waypoint${typedResult.sent === 1 ? "" : "s"} committed`;
  }

  const mission = typedResult.mission;
  if (mission && typeof mission === "object" && typeof (mission as { state?: unknown }).state === "string") {
    return `${title}: Mission ${String((mission as { state?: unknown }).state).toLowerCase()}`;
  }

  if (typeof typedResult.command === "string") {
    const body = formatReadableValue(typedResult.body);
    return `${title}: ${typedResult.command}${body ? ` | ${body}` : ""}`;
  }

  const formatted = formatReadableValue(result);
  return `${title}: ${formatted || (response.ok ? "Completed" : "Failed")}`;
}

function toFriendlyErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  const normalized = raw.toLowerCase();

  if (!raw) return fallback;
  if (normalized.includes("waypoint")) return "The route is still syncing to the robot. Please wait a moment and try again.";
  if (normalized.includes("gps")) return "The robot is still acquiring its position. Please wait a moment and try again.";
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("socket")) return "The request took too long to finish. Keep the robot link active and try again.";
  if (normalized.includes("telemetry") || normalized.includes("robot link")) return "The robot connection is delayed. Check the link and try again.";
  if (normalized.includes("base station") || normalized.includes("gateway") || normalized.includes("command transport") || normalized.includes("remote fallback")) {
    return "The control link is not ready. Check the base station and gateway, then try again.";
  }
  if (normalized.includes("demo mode")) return "Demo mode is active. Use the Demo Setup controls to build and run the route.";
  return raw || fallback;
}

export default function ControllerScreen({
  serverUrl,
  manualServerUrl,
  saltPct,
  brinePct,
  setSaltPct,
  setBrinePct,
  connectionLabel,
  connectionStatus,
  connectionDetail,
  connectionMode,
  connectionBusy,
  onOpenConnection,
  onDemoPathPreviewChange,
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
  const [manualGatewayConnected, setManualGatewayConnected] = useState(false);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [serviceToolsVisible, setServiceToolsVisible] = useState(true);
  const [preflightVisible, setPreflightVisible] = useState(false);
  const [demoLaneWidthInput, setDemoLaneWidthInput] = useState("3.0");
  const [demoGeofenceToleranceInput, setDemoGeofenceToleranceInput] = useState("6.0");
  const [demoMinSpotDistanceInput, setDemoMinSpotDistanceInput] = useState("0.20");
  const [demoPassesInput, setDemoPassesInput] = useState("1");
  const [demoObstacleEnabled, setDemoObstacleEnabled] = useState(true);
  const [demoObstacleStopInput, setDemoObstacleStopInput] = useState("70");
  const [demoObstacleSidestepInput, setDemoObstacleSidestepInput] = useState("120");
  const emptyJoystickState: JoystickState = { x: 0, y: 0, drive: 0, turn: 0, active: false };
  const [joystickState, setJoystickState] = useState<JoystickState>(emptyJoystickState);
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const isMounted = useRef(true);
  const demoConfigHydratedRef = useRef(false);
  const [demoPathPoints, setDemoPathPoints] = useState<DemoPathPoint[]>([]);

  const resolvedManualServerUrl = ((status?.manual_command_url && status.manual_command_url.trim()) || (manualServerUrl && manualServerUrl.trim()) || "");
  const serverReachable = connectionStatus === "connected" || connectionStatus === "fallback";
  const directGatewayPreferred = Boolean(resolvedManualServerUrl) && summary?.demo?.enabled === true && manualGatewayConnected === true;

  const delayMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const formatWaypointCoord = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    const text = value.toFixed(5).replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
    return text === "-0" ? "0" : text;
  };

  const buildGatewayWaypointCommands = (points: DemoPathPoint[]) => {
    const commands = ["PAUSE", "WPCLEAR"];

    points.forEach((point, index) => {
      const salt = Math.max(0, Math.min(100, Math.round(Number(point?.salt ?? saltPct))));
      const brine = Math.max(0, Math.min(100, Math.round(Number(point?.brine ?? brinePct))));
      const entry = `${formatWaypointCoord(Number(point.lat))},${formatWaypointCoord(Number(point.lon))},${salt},${brine}`;
      commands.push(`WP:${index}:${entry}`);
    });

    commands.push(`WPLOAD:${points.length}`);
    return commands;
  };

  const verifyManualGateway = async () => {
    if (!resolvedManualServerUrl) return false;
    const result = await getGatewayJsonAllowError<{ ok?: boolean; manualReady?: boolean; wifiConnected?: boolean }>(resolvedManualServerUrl, "/status", 1500);
    return Boolean(result.ok && result.data && (result.data.ok !== false));
  };

  const relayWaypointsToGateway = async (points: DemoPathPoint[]) => {
    if (!resolvedManualServerUrl) {
      throw new Error("Gateway URL is not set on this device.");
    }

    const gatewayOk = await verifyManualGateway();
    if (!gatewayOk) {
      throw new Error("The phone cannot reach the gateway over Wi-Fi.");
    }

    const sanitized = points.filter((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon)));
    if (sanitized.length < 2) {
      throw new Error("Build the demo path first so the phone has waypoints to send.");
    }

    const commands = buildGatewayWaypointCommands(sanitized);
    for (let index = 0; index < commands.length; index += 1) {
      await postGatewayText(resolvedManualServerUrl, "/command", commands[index], 5000);
      if (index < commands.length - 1) {
        await delayMs(2);
      }
    }

    return { pointCount: sanitized.length, commandCount: commands.length };
  };

  const runDemoDirectToGateway = async (points: DemoPathPoint[]) => {
    const relay = await relayWaypointsToGateway(points);
    await delayMs(10);
    await postGatewayText(resolvedManualServerUrl, "/command", "DEMOON", 5000);
    await delayMs(10);
    await postGatewayText(resolvedManualServerUrl, "/command", "AUTO", 5000);
    return relay;
  };

  const resolveGatewayActionCommand = (actionId: string) => {
    switch (actionId) {
      case "mission-start":
      case "mission-resume":
        return "AUTO";
      case "mission-pause":
      case "mission-complete":
        return "PAUSE";
      case "mission-abort":
        return "ESTOP";
      case "command-reset":
        return "RESET";
      default:
        return null;
    }
  };

  const resolveGatewayTestMenuCommand = (action: TestMenuAction, rawValue = "") => {
    switch (action.id) {
      case "mode-manual":
        return "MANUAL";
      case "mode-test":
      case "ack-pause":
        return "PAUSE";
      case "mode-auto":
        return "AUTO";
      case "ack-reset":
        return "RESET";
      case "ack-estop":
        return "ESTOP";
      case "drive-forward":
        return "FORWARD";
      case "drive-left":
        return "LEFT";
      case "drive-stop":
        return "STOP";
      case "drive-right":
        return "RIGHT";
      case "drive-backward":
        return "BACKWARD";
      case "salt-50":
        return "TEST SALT 50";
      case "brine-50":
        return "TEST BRINE 50";
      case "agitator-on":
        return "AGITATOR ON";
      case "thrower-on":
        return "THROWER ON";
      case "relay-on":
        return "RELAY ON";
      case "vibration-on":
        return "VIBRATION ON";
      case "all-on":
        return ["TEST SALT 100", "TEST BRINE 100", "AGITATOR ON", "THROWER ON", "RELAY ON", "VIBRATION ON"];
      case "safe-off":
        return ["TEST SALT 0", "TEST BRINE 0", "AGITATOR OFF", "THROWER OFF", "RELAY OFF", "VIBRATION OFF", "STOP"];
      case "mix-preset":
      case "raw-command":
        return rawValue || null;
      default:
        return null;
    }
  };

  const openManualControl = async () => {
    setPendingAction("manual-open");
    try {
      setManualControlVisible(true);

      if (!resolvedManualServerUrl) {
        setError("Gateway manual URL is not set. Expected default: http://172.20.10.2");
        return;
      }

      try {
        if (manualGatewayConnected) {
          await postGatewayText(resolvedManualServerUrl, "/command", "MANUAL", 3000);
        } else {
          await postText(serverUrl, "/command", "MANUAL", 4000);
        }
        setManualControlVisible(true);
        setError(null);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Manual mode command could not be sent");
      }
    } catch (requestError) {
      setError(toFriendlyErrorMessage(requestError, "Unable to open manual control"));
    } finally {
      setPendingAction(null);
    }
  };

  const closeManualControl = async () => {
    setManualControlVisible(false);
    try {
      if (manualGatewayConnected) {
        await postGatewayText(resolvedManualServerUrl, "/command", "STOP", 3000);
        await postGatewayText(resolvedManualServerUrl, "/command", "PAUSE", 3000);
      } else {
        await postText(serverUrl, "/command", "STOP", 4000);
        await postText(serverUrl, "/command", "PAUSE", 4000);
      }
    } catch {
      // Ignore errors on close
    }
  };

  const performManualCommand = async (command: string) => {
    setPendingAction(`manual-${command}`);
    try {
      if (manualGatewayConnected) {
        await postGatewayText(resolvedManualServerUrl, "/command", command.toUpperCase(), 3000);
      } else {
        await postText(serverUrl, "/command", command.toUpperCase(), 4000);
      }
      setError(null);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Manual command failed: ${command}`);
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const refresh = useCallback(async () => {
    if (!serverReachable) {
      if (isMounted.current) {
        setSocketState("polling");
      }
      return;
    }
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;

    try {
      const [statusSettled, summarySettled, healthSettled, testMenuSettled] = await Promise.allSettled([
        getJsonAllowError<StatusResponse>(serverUrl, "/status"),
        getJsonAllowError<SummaryResponse>(serverUrl, "/api/supervision/summary"),
        getJsonAllowError<HealthPayload>(serverUrl, "/api/health"),
        getJsonAllowError<TestMenuResponse>(serverUrl, "/api/test-menu"),
      ]);

      if (!isMounted.current) return;

      const statusResult = statusSettled.status === "fulfilled" ? statusSettled.value : null;
      const summaryResult = summarySettled.status === "fulfilled" ? summarySettled.value : null;
      const healthResult = healthSettled.status === "fulfilled" ? healthSettled.value : null;
      const testMenuResult = testMenuSettled.status === "fulfilled" ? testMenuSettled.value : null;

      if (statusResult?.ok && statusResult.data) {
        setStatus(statusResult.data);
      }
      if (summaryResult?.ok && summaryResult.data?.summary) {
        setSummary(summaryResult.data.summary);
      }
      if (healthResult) {
        setHealth(healthResult.data);
      }
      if (testMenuResult?.ok && testMenuResult.data?.ok) {
        setTestMenu(Array.isArray(testMenuResult.data.tests) ? testMenuResult.data.tests : FALLBACK_TEST_MENU);
        setCommandHistory(Array.isArray(testMenuResult.data.commandHistory) ? testMenuResult.data.commandHistory : []);
      } else {
        setTestMenu((current) => (current.length ? current : FALLBACK_TEST_MENU));
      }

      const anySuccess = Boolean(
        statusResult?.ok
        || summaryResult?.ok
        || healthResult?.ok
        || testMenuResult?.ok,
      );

      if (anySuccess) {
        setError(null);
      } else {
        setError("Unable to refresh server state");
      }
    } catch (requestError) {
      if (!isMounted.current) return;
      setError(requestError instanceof Error ? requestError.message : "Unable to refresh server state");
    } finally {
      refreshInFlight.current = false;

      if (refreshQueued.current && isMounted.current) {
        refreshQueued.current = false;
        setTimeout(() => {
          void refresh();
        }, 75);
      }
    }
  }, [serverReachable, serverUrl]);

  const requestRefresh = useCallback(() => {
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!serverReachable) {
      setSocketState("polling");
      return;
    }
    requestRefresh();
    const timer = setInterval(requestRefresh, 1200);
    return () => clearInterval(timer);
  }, [requestRefresh, serverReachable]);

  useEffect(() => {
    onDemoPathPreviewChange?.(demoPathPoints);
  }, [demoPathPoints, onDemoPathPreviewChange]);

  useEffect(() => {
    if (!serverReachable) {
      setSocketState("polling");
      return;
    }

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
          message.event === "operator.updated" ||
          message.event === "ws.test"
        ) {
          setSocketState("live");
          requestRefresh();
        }
      } catch {
        setSocketState("polling");
      }
    };

    return () => {
      socket.close();
    };
  }, [serverReachable, serverUrl, requestRefresh]);

  useEffect(() => {
    const cfg = summary?.demo?.config;
    if (!cfg || demoConfigHydratedRef.current) return;
    if (typeof cfg.laneWidthM === "number") setDemoLaneWidthInput(cfg.laneWidthM.toFixed(2));
    if (typeof cfg.geofenceToleranceM === "number") setDemoGeofenceToleranceInput(cfg.geofenceToleranceM.toFixed(2));
    if (typeof cfg.minSpotDistanceM === "number") setDemoMinSpotDistanceInput(cfg.minSpotDistanceM.toFixed(2));
    if (typeof cfg.passes === "number") setDemoPassesInput(String(cfg.passes));
    if (typeof cfg.obstaclePolicyEnabled === "boolean") setDemoObstacleEnabled(cfg.obstaclePolicyEnabled);
    if (typeof cfg.obstacleStopCm === "number") setDemoObstacleStopInput(String(Math.round(cfg.obstacleStopCm)));
    if (typeof cfg.obstacleSidestepCm === "number") setDemoObstacleSidestepInput(String(Math.round(cfg.obstacleSidestepCm)));
    demoConfigHydratedRef.current = true;
  }, [summary?.demo?.config]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const performCommand = async (command: string) => {
    setPendingAction(command);
    try {
      const upper = command.toUpperCase();
      const useGatewayDirect = directGatewayPreferred && ["AUTO", "MANUAL", "PAUSE", "STOP", "FORWARD", "BACKWARD", "LEFT", "RIGHT", "ESTOP", "RESET"].includes(upper);

      if (useGatewayDirect) {
        await postGatewayText(resolvedManualServerUrl, "/command", upper, 5000);
      } else {
        await postText(serverUrl, "/command", upper);
      }

      setError(null);
      await refresh();
    } catch (requestError) {
      setError(toFriendlyErrorMessage(requestError, `Command failed: ${command}`));
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
      const gatewayCommand = directGatewayPreferred ? resolveGatewayActionCommand(actionId) : null;
      if (gatewayCommand) {
        await postGatewayText(resolvedManualServerUrl, "/command", gatewayCommand, 5000);
      } else {
        await postJson(serverUrl, endpoint, {});
      }
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(toFriendlyErrorMessage(requestError, `Action failed: ${actionId}`));
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

  const openPreflight = () => {
    if (demoModeEnabled) {
      setError("Demo mode is active. Use the Demo Setup controls below to build and run the route.");
      return;
    }
    setPreflightVisible(true);
  };

  const confirmMissionStart = async () => {
    setPreflightVisible(false);
    await performAction("mission-start");
  };

  const toggleDemoMode = async () => {
    setPendingAction('demo-mode-toggle');
    try {
      await postJson(serverUrl, '/api/demo-mode', {
        enabled: !demoModeEnabled,
        source: 'app.controller',
      });
      setDemoPathPoints([]);
      setTestResult(null);
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to change demo mode');
    } finally {
      setPendingAction(null);
    }
  };

  const saveDemoTuning = async () => {
    setPendingAction("demo-config-save");
    try {
      const laneWidthM = Number(demoLaneWidthInput);
      const geofenceToleranceM = Number(demoGeofenceToleranceInput);
      const minSpotDistanceM = Number(demoMinSpotDistanceInput);
      const passes = Number(demoPassesInput);
      const obstacleStopCm = Number(demoObstacleStopInput);
      const obstacleSidestepCm = Number(demoObstacleSidestepInput);

      await postJson(serverUrl, "/api/demo-mode", {
        enabled: demoModeEnabled,
        source: "app.controller",
        config: {
          laneWidthM: Number.isFinite(laneWidthM) && laneWidthM > 0 ? laneWidthM : undefined,
          geofenceToleranceM: Number.isFinite(geofenceToleranceM) && geofenceToleranceM >= 0 ? geofenceToleranceM : undefined,
          minSpotDistanceM: Number.isFinite(minSpotDistanceM) && minSpotDistanceM > 0 ? minSpotDistanceM : undefined,
          passes: Number.isFinite(passes) ? Math.max(1, Math.min(5, Math.round(passes))) : undefined,
          obstaclePolicyEnabled: demoObstacleEnabled,
          obstacleStopCm: Number.isFinite(obstacleStopCm) && obstacleStopCm > 0 ? Math.round(obstacleStopCm) : undefined,
          obstacleSidestepCm: Number.isFinite(obstacleSidestepCm) && obstacleSidestepCm > 0 ? Math.round(obstacleSidestepCm) : undefined,
        },
      });

      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save demo tuning");
    } finally {
      setPendingAction(null);
    }
  };

  const markDemoSpot = async (kind: 'start' | 'end') => {
    setPendingAction(`demo-spot-${kind}`);
    try {
      await postJson(serverUrl, '/api/demo-mode/spot', {
        kind,
        source: 'app.controller',
        allowWeakGps: true,
      });
      setDemoPathPoints([]);
      setTestResult(`${kind === 'start' ? 'Spot A' : 'Spot B'} updated. Build Demo Path again to refresh the route.`);
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Unable to mark ${kind === 'start' ? 'Spot A' : 'Spot B'}`);
    } finally {
      setPendingAction(null);
    }
  };

  const buildDemoPath = async (allowWeakGps?: boolean) => {
    setPendingAction(allowWeakGps ? "demo-path-override" : "demo-path");
    try {
      const payload: Record<string, unknown> = {
        source: "app.controller",
        saltPct,
        brinePct,
      };
      if (allowWeakGps === true) {
        payload.allowWeakGps = true;
      }

      const response = await postJson<DemoPathBuildResponse>(serverUrl, "/api/demo-mode/path", payload, 25000);
      const warnings = Array.isArray(response?.warnings) ? response.warnings.filter(Boolean) : [];
      const points = Array.isArray(response?.path?.points) ? response.path.points : [];
      const pointCount = points.length || Math.max(0, Math.round(Number(response?.path?.pointCount ?? 0)));
      const notices = pointCount > 0 ? [`Built ${pointCount} demo waypoint${pointCount === 1 ? "" : "s"}.`] : [];
      setDemoPathPoints(points);

      if (points.length >= 2 && directGatewayPreferred) {
        notices.push("Ready to send directly from the phone to the gateway.");
      }

      setTestResult([...notices, ...warnings].join(" ") || null);
      setError(null);
      await refresh();
    } catch (requestError) {
      setDemoPathPoints([]);
      setTestResult(null);
      setError(toFriendlyErrorMessage(requestError, "Unable to build the demo path"));
    } finally {
      setPendingAction(null);
    }
  };

  const runDemoPath = async (allowWeakGps = true) => {
    setPendingAction("demo-run");
    try {
      if (directGatewayPreferred && demoPathPoints.length < 2) {
        throw new Error("Build Demo Path first so the phone has the latest waypoints to send.");
      }

      const shouldUseDirectGateway = directGatewayPreferred && demoPathPoints.length >= 2;

      if (shouldUseDirectGateway) {
        const relay = await runDemoDirectToGateway(demoPathPoints);
        setTestResult(`Demo sent to the gateway over Wi-Fi (${relay.pointCount} waypoints in ${relay.commandCount} commands) and AUTO was requested.`);
      } else {
        await postJson(serverUrl, "/api/demo-mode/run", {
          source: "app.controller",
          allowWeakGps,
        }, 25000);
        setTestResult(null);
      }

      setError(null);
      await refresh();
    } catch (requestError) {
      if (resolvedManualServerUrl && demoPathPoints.length >= 2) {
        try {
          const relay = await runDemoDirectToGateway(demoPathPoints);
          setTestResult(`Demo sent to the gateway over Wi-Fi (${relay.pointCount} waypoints in ${relay.commandCount} commands) and AUTO was requested.`);
          setError(null);
          await refresh();
          return;
        } catch {
          // Fall through to the original error below.
        }
      }

      setError(toFriendlyErrorMessage(requestError, directGatewayPreferred
        ? "Unable to run the demo path through the gateway"
        : "Unable to run the demo path"));
    } finally {
      setPendingAction(null);
    }
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
      const directCommand = directGatewayPreferred ? resolveGatewayTestMenuCommand(action, rawValue) : null;
      if (directCommand) {
        const commands = Array.isArray(directCommand) ? directCommand : [directCommand];
        for (let index = 0; index < commands.length; index += 1) {
          await postGatewayText(resolvedManualServerUrl, "/command", commands[index], 5000);
          if (index < commands.length - 1) {
            await delayMs(100);
          }
        }
        setTestResult(commands.length === 1
          ? `${action.title}: sent directly to the gateway over Wi-Fi.`
          : `${action.title}: ${commands.length} commands sent directly to the gateway over Wi-Fi.`);
      } else {
        const payload: Record<string, unknown> = { actionId: action.id };
        if (field) {
          payload[field] = rawValue;
        }
        const response = await postJson<TestMenuRunResponse>(serverUrl, "/api/test-menu/run", payload);
        setTestResult(summarizeCommandResult(action.title, response));
      }
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

    const resolveGroupName = (action: TestMenuAction) => {
      const kind = String(action.kind ?? "").toLowerCase();
      const sourceGroup = String(action.group ?? "Operations");

      if (kind === "drive" || sourceGroup === "Modes" || sourceGroup === "Drive") {
        return "Drive Controls";
      }
      if (kind === "transport") {
        return "Connection Tools";
      }
      return sourceGroup;
    };

    for (const action of testMenu) {
      const groupName = resolveGroupName(action);
      const existing = groups.get(groupName) ?? [];
      existing.push(action);
      groups.set(groupName, existing);
    }

    const preferredOrder = [
      "Drive Controls",
      "Connection Tools",
      "Mission",
      "Dispersion",
      "Sensors",
      "Operations",
    ];

    return Array.from(groups.entries()).sort((a, b) => {
      const ai = preferredOrder.indexOf(a[0]);
      const bi = preferredOrder.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [testMenu]);

  const toFriendlyLabel = (value?: string | null, fallback = "Unknown") => {
    if (!value) return fallback;
    return String(value)
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const formatMissionStateLabel = (value?: string | null) => {
    switch (String(value ?? "").toUpperCase()) {
      case "IDLE":
      case "READY":
        return "Ready";
      case "CONFIGURING":
      case "PLANNED":
        return "Setup";
      case "RUNNING":
        return "Running";
      case "PAUSED":
        return "Paused";
      case "COMPLETED":
        return "Complete";
      case "ABORTED":
        return "Stopped";
      case "ERROR":
        return "Needs attention";
      default:
        return toFriendlyLabel(value);
    }
  };

  const formatRobotStateLabel = (value?: string | null) => {
    switch (String(value ?? "").toUpperCase()) {
      case "IDLE":
      case "READY":
        return "Ready";
      case "MANUAL":
        return "Manual";
      case "AUTO":
      case "AUTONOMOUS":
        return "Automatic";
      case "RUNNING":
        return "Running";
      case "PAUSED":
        return "Paused";
      case "ESTOP":
        return "Emergency stop";
      case "SAFE_OFF":
        return "Safe stop";
      case "ERROR":
      case "FAULT":
        return "Needs attention";
      case "OFFLINE":
        return "Offline";
      default:
        return toFriendlyLabel(value);
    }
  };

  const formatConnectionStateLabel = (value?: string | null, fallback = "Unknown") => {
    switch (String(value ?? "").toLowerCase()) {
      case "online":
        return "Connected";
      case "ready":
        return "Ready";
      case "degraded":
      case "stale":
        return "Delayed";
      case "offline":
        return "Offline";
      case "unknown":
      case "":
        return fallback;
      default:
        return toFriendlyLabel(value, fallback);
    }
  };

  const allowedAction = (actionId: string) => summary?.allowedActions.find((action) => action.id === actionId);
  const missionState = summary?.mission?.state ?? "UNKNOWN";
  const coveragePct = summary?.coverage?.coveredPct ?? summary?.coverage?.coveragePercent ?? summary?.mission?.coveragePct ?? 0;
  const alerts = summary?.alerts ?? [];
  const hasCriticalAlert = alerts.some((alert) => alert.level === "critical");
  const hasWarningAlert = alerts.some((alert) => alert.level === "warning");
  const latestAlert = alerts[alerts.length - 1] ?? null;
  const recentNotes = (summary?.notes ?? []).slice(-2).reverse();
  const recentCommands = commandHistory.slice(0, 6);
  const latestCommand = recentCommands[0] ?? null;
  const connection = summary?.connectivity ?? null;
  const robotOperationalState = summary?.robot?.state
    ?? connection?.robot?.robotState
    ?? ((connection?.robot?.state === "offline" || connection?.robot?.reachable === false) ? "OFFLINE" : null)
    ?? status?.state
    ?? "UNKNOWN";
  const overallConnectionState = connection?.overall?.state ?? status?.connectivity?.state ?? (health?.ready ? "online" : "degraded");
  const backendState = connection?.backend?.state ?? (health?.checks?.db ? "online" : "degraded");
  const baseStationState = connection?.baseStation?.state ?? (health?.checks?.bridge ? "online" : "degraded");
  const robotLinkState = connection?.robot?.state ?? (health?.checks?.telemetry ? "online" : "stale");
  const commandPathState = connection?.commandPath?.state ?? "unknown";
  const missionStateLabel = formatMissionStateLabel(missionState);
  const robotOperationalLabel = formatRobotStateLabel(robotOperationalState);
  const overallConnectionLabel = formatConnectionStateLabel(overallConnectionState);
  const backendStateLabel = formatConnectionStateLabel(backendState);
  const baseStationStateLabel = formatConnectionStateLabel(baseStationState);
  const robotLinkStateLabel = formatConnectionStateLabel(robotLinkState);
  const commandPathStateLabel = formatConnectionStateLabel(commandPathState);
  const robotStateTone = ["ESTOP", "FAULT", "ERROR", "SAFE_OFF", "ABORTED"].includes(String(robotOperationalState).toUpperCase())
    ? "critical"
    : (["PAUSE", "PAUSED", "MANUAL", "OFFLINE"].includes(String(robotOperationalState).toUpperCase()) || hasWarningAlert)
      ? "warning"
      : "ok";
  const robotPillStyle = robotStateTone === "critical"
    ? styles.statusPillCritical
    : robotStateTone === "warning"
      ? styles.statusPillPoll
      : styles.statusPillLive;
  const alertsPillStyle = hasCriticalAlert
    ? styles.statusPillCritical
    : hasWarningAlert
      ? styles.statusPillPoll
      : styles.statusPillOk;
  const alertsPillLabel = hasCriticalAlert ? "Critical Alert" : hasWarningAlert ? "Warning Active" : "No Active Alerts";
  const connectionReason = connection?.overall?.reason ?? status?.connectivity?.reason ?? null;
  const baseStationReachable = Boolean(connection?.baseStation?.reachable ?? (baseStationState === "online"));
  const connectionPathLabel = connectionMode === 'cloud'
    ? 'Remote server'
    : connection?.baseStation?.connectionPathLabel ?? connection?.overall?.connectionPathLabel ?? 'Server link';
  const baseStationLabel = baseStationReachable
    ? (connection?.baseStation?.connectionPathLabel === 'Remote bridge' ? 'Connected (Remote)' : 'Connected')
    : baseStationStateLabel;
  const baseStationOperationalState = formatConnectionStateLabel(
    connection?.baseStation?.stationState ?? connection?.baseStation?.mode ?? (baseStationReachable ? 'ready' : baseStationState),
  );
  const baseStationTransportLabel = [connection?.baseStation?.wifiLinkState, connection?.baseStation?.loraLinkState]
    .filter((value): value is string => Boolean(value))
    .map((value) => toFriendlyLabel(value))
    .join(' • ');
  const gatewayState = connection?.gateway?.state ?? (connection?.baseStation?.loraLinkState ? String(connection.baseStation.loraLinkState).toLowerCase() : 'unknown');
  const gatewayWorking = Boolean(connection?.gateway?.working ?? connection?.gateway?.reachable ?? (gatewayState === 'online'));
  const gatewayReason = connection?.gateway?.reason ?? null;
  const gatewayLabel = [gatewayState, connection?.gateway?.linkState, connection?.gateway?.evidence]
    .filter((value): value is string => Boolean(value))
    .map((value) => toFriendlyLabel(value))
    .join(' • ');
  const stm32TelemetryAgeMs = summary?.robot?.ageMs ?? null;
  const stm32Online = Boolean(summary?.robot && !summary?.robot?.stale && robotLinkState === 'online');
  const stm32StateLabel = stm32Online ? 'Connected' : (summary?.robot ? 'Delayed' : 'Offline');
  const stm32LastSeenLabel = typeof stm32TelemetryAgeMs === 'number'
    ? (stm32TelemetryAgeMs < 1000
        ? `${stm32TelemetryAgeMs} ms ago`
        : `${(stm32TelemetryAgeMs / 1000).toFixed(stm32TelemetryAgeMs < 10000 ? 1 : 0)} s ago`)
    : 'No telemetry yet';
  const gpsReady = Boolean(connection?.robot?.gpsReady);
  const demoModeEnabled = Boolean(summary?.demo?.enabled);
  const demoSpots = summary?.demo?.spots ?? null;
  const demoSpotGpsStatus = summary?.demo?.spotGpsStatus ?? null;
  const demoReadiness = summary?.demo?.readiness ?? null;
  const effectiveWaypointState = demoReadiness?.wpPushState ?? summary?.lora?.wpPushState ?? "none";
  const waypointsCommitted = effectiveWaypointState === "committed" || effectiveWaypointState === "remote-queued";
  const missionStartReady = Boolean(allowedAction("mission-start")?.enabled);
  const demoDiagnostics = summary?.demo?.diagnostics ?? null;
  const demoObstacle = summary?.demo?.obstacle ?? null;
  const robotMotor = summary?.robot?.motor ?? null;
  const robotProx = summary?.robot?.prox ?? null;
  const robotHeading = typeof summary?.robot?.heading === "number" ? summary.robot.heading : null;
  const demoGatewayReady = directGatewayPreferred && demoPathPoints.length >= 2;
  const demoBlockers = (Array.isArray(demoReadiness?.blockers) ? demoReadiness.blockers.filter(Boolean) : [])
    .filter((reason) => !(directGatewayPreferred && /waypoints are .*not committed|no command transport available/i.test(reason)));
  const restoredAt = health?.persistence?.restoredAt ?? null;
  const showRecoveryBanner = Boolean(restoredAt && missionState !== "IDLE");
  const summaryItems = [
    { label: "Mission", value: missionStateLabel, detail: "Current status" },
    { label: "Robot", value: robotOperationalLabel, detail: hasCriticalAlert ? "Fault active" : hasWarningAlert ? "Warning active" : (robotLinkState === "online" ? "Telemetry live" : "Telemetry needs attention") },
    { label: "Coverage", value: `${coveragePct.toFixed(1)}%`, detail: "Progress" },
  ];
  const systemCheckItems = [
    { label: "Remote Server", value: backendStateLabel, detail: connectionPathLabel, good: backendState === "online" },
    { label: "Base Station", value: baseStationOperationalState, detail: baseStationTransportLabel || "Link status", good: baseStationReachable },
    { label: "Gateway", value: gatewayLabel || formatConnectionStateLabel(gatewayState), detail: gatewayReason ?? "LoRa bridge", good: gatewayWorking },
    { label: "STM32", value: stm32StateLabel, detail: stm32LastSeenLabel, good: stm32Online },
    { label: "GPS", value: gpsReady ? "Ready" : "Needs attention", detail: gpsReady ? "Autonomy ready" : "Wait for lock", good: gpsReady },
    { label: "Waypoints", value: demoGatewayReady ? "Ready in app" : (waypointsCommitted ? (effectiveWaypointState === "remote-queued" ? "Syncing" : "Committed") : "Not committed"), detail: directGatewayPreferred ? "Phone to gateway HTTP" : commandPathStateLabel, good: demoGatewayReady || waypointsCommitted },
  ];
  const attentionItems = systemCheckItems
    .filter((item) => item.good === false)
    .map((item) => item.label);
  const preflightItems = [
    { label: "Server connected", detail: "The app can reach the remote server.", good: backendState === "online" },
    { label: "Base station reachable", detail: connection?.baseStation?.connectionPathLabel === "Remote bridge" ? "The backend is receiving live remote status from the base station." : "The backend can reach the base station.", good: baseStationReachable },
    { label: "Gateway live", detail: gatewayReason ?? "The gateway is passing LoRa traffic between the robot and base station.", good: gatewayWorking },
    { label: "STM32 live", detail: stm32Online ? `Telemetry is current (${stm32LastSeenLabel}).` : `STM32 telemetry is stale or missing (${stm32LastSeenLabel}).`, good: stm32Online },
    { label: "Robot link live", detail: "Robot telemetry is current.", good: robotLinkState === "online" },
    { label: "GPS ready", detail: "The robot has a valid GPS fix for autonomy.", good: gpsReady },
    { label: "Waypoints committed", detail: directGatewayPreferred ? "The phone is ready to send the planned path directly to the gateway." : "The planned path has been committed to the robot.", good: demoGatewayReady || waypointsCommitted },
  ];
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

  const connectionDotStyle = [
    styles.connectionDot,
    connectionStatus === 'connected'
      ? styles.connectionDotConnected
      : connectionStatus === 'fallback'
        ? styles.connectionDotFallback
        : connectionStatus === 'error'
          ? styles.connectionDotError
          : styles.connectionDotConnecting,
  ];
  const connectionBadgeLabel = connectionBusy
    ? 'Checking'
    : connectionMode === 'cloud'
      ? 'Remote'
      : connectionMode === 'manual'
        ? 'Custom'
        : connectionStatus === 'error'
          ? 'Offline'
          : 'Server';

  const shouldHighlightConnection = connectionBusy || connectionStatus === 'error' || connectionMode === 'cloud' || connectionMode === 'manual';
  const formatDemoSpot = (spot?: DemoSpot | null, emptyLabel = "Not marked yet") => {
    const markedAt = spot?.markedAt ?? spot?.at ?? null;
    if (!markedAt) {
      return emptyLabel;
    }
    const parts = [
      `Marked ${new Date(markedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    ];
    if (spot?.robot?.state) {
      parts.push(`Status ${formatRobotStateLabel(spot?.robot?.state)}`);
    }
    if (spot?.robot?.gpsFix === true) {
      parts.push("GPS fix");
    }
    if (spot?.robot?.gpsFix === false) {
      parts.push("No GPS fix");
    }
    return parts.join(" • ");
  };


  useEffect(() => {
    setConnectionExpanded(shouldHighlightConnection);
  }, [shouldHighlightConnection]);

  useEffect(() => {
    let cancelled = false;

    const checkGateway = async () => {
      if (!resolvedManualServerUrl) {
        if (!cancelled) {
          setManualGatewayConnected(false);
        }
        return;
      }

      try {
        const connected = await verifyManualGateway();
        if (!cancelled) {
          setManualGatewayConnected(connected);
        }
      } catch {
        if (!cancelled) {
          setManualGatewayConnected(false);
        }
      }
    };

    void checkGateway();
    const timer = setInterval(() => {
      void checkGateway();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [resolvedManualServerUrl]);

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.pageBg, paddingTop: insets.top + 8 }]}> 
      <Text style={[styles.title, { color: theme.title }]}>Robotic Anti-Icing Control</Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusPill, socketState === 'live' ? styles.statusPillLive : styles.statusPillPoll]}>
          <Text style={styles.statusPillText}>{socketState === 'live' ? 'Live' : 'Polling'}</Text>
        </View>
        <View style={[styles.statusPill, robotPillStyle]}>
          <Text style={styles.statusPillText}>{robotOperationalLabel}</Text>
        </View>
        <View style={[styles.statusPill, connectionPillStyle]}>
          <Text style={styles.statusPillText}>{overallConnectionLabel}</Text>
        </View>
        <View style={[styles.statusPill, alertsPillStyle]}>
          <Text style={styles.statusPillText}>{alertsPillLabel}</Text>
        </View>
      </View>

      {showRecoveryBanner ? (
        <AppCard style={[styles.card, styles.recoveryCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
          <Text style={[styles.sectionTitle, styles.recoveryTitle, { color: theme.sectionTitle }]}>Mission Restored</Text>
          <Text style={[styles.metaText, { color: theme.text }]}>
            The backend restored an in-progress mission after restart. Review the system, then continue when you are ready.
          </Text>
          <Text style={[styles.metaText, { color: theme.muted }]}>
            Restored {restoredAt ? new Date(restoredAt).toLocaleString() : 'recently'}
          </Text>
        </AppCard>
      ) : null}

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>System Status</Text>

        <View style={styles.summaryGrid}>
          {summaryItems.map((item) => (
            <View
              key={item.label}
              style={[
                styles.summaryItem,
                item.label === 'Coverage' ? styles.summaryItemWide : null,
              ]}
            >
              <Text style={[styles.quickLabel, { color: theme.muted }]}>{item.label}</Text>
              <Text style={[styles.summaryValue, { color: theme.text }]}>{item.value}</Text>
              <Text style={[styles.summaryDetail, { color: theme.muted }]}>{item.detail}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.systemBanner, attentionItems.length ? styles.systemBannerNeeds : styles.systemBannerGood]}>
          <Text style={styles.systemBannerTitle}>{attentionItems.length ? 'Needs attention' : 'System ready'}</Text>
          <Text style={styles.systemBannerText}>
            {attentionItems.length ? attentionItems.join(' • ') : 'Remote server, base station, telemetry, and GPS look ready.'}
          </Text>
        </View>

        <View style={styles.systemCheckGrid}>
          {systemCheckItems.map((item) => (
            <View
              key={item.label}
              style={[
                styles.systemCheckItem,
                item.good ? styles.systemCheckItemGood : styles.systemCheckItemNeeds,
              ]}
            >
              <View style={styles.systemCheckTopRow}>
                <View style={styles.systemCheckLabelBlock}>
                  <Text style={[styles.quickLabel, { color: theme.muted }]}>{item.label}</Text>
                  <Text style={[styles.systemCheckValue, { color: item.good ? '#1f7a52' : '#9b5c12' }]}>{item.value}</Text>
                </View>
                {item.good ? (
                  <View style={[styles.quickStateBadge, styles.quickStateBadgeGood]}>
                    <Text style={styles.quickStateBadgeText}>Ready</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.systemCheckDetail, { color: theme.muted }]}>{item.detail}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.metaText, { color: theme.muted }]}> 
          Cmd {status?.last_cmd ?? summary?.lora?.lastCmd ?? "--"} | Path {commandPathStateLabel} | Queue {connection?.baseStation?.queueDepth ?? status?.queue_depth ?? 0}
        </Text>
        <Text style={[styles.metaText, { color: theme.muted }]}> 
          Base link {baseStationLabel}{baseStationTransportLabel ? ` • ${baseStationTransportLabel}` : ''}
        </Text>
        <Text style={[styles.metaText, { color: theme.muted }]}> 
          Gateway {gatewayLabel || formatConnectionStateLabel(gatewayState)}{gatewayReason ? ` • ${gatewayReason}` : ''}
        </Text>
        <Text style={[styles.metaText, { color: theme.muted }]}> 
          STM32 {stm32StateLabel} • Last seen {stm32LastSeenLabel}
        </Text>
        {robotMotor ? (
          <Text style={[styles.metaText, { color: theme.muted }]}> 
            Motors M1 {Math.round(Number(robotMotor.m1 ?? 0))} • M2 {Math.round(Number(robotMotor.m2 ?? 0))}
          </Text>
        ) : null}
        {robotHeading !== null ? (
          <Text style={[styles.metaText, { color: theme.muted }]}> 
            Heading {robotHeading.toFixed(1)}°
          </Text>
        ) : null}
        {robotProx ? (
          <Text style={[styles.metaText, { color: theme.muted }]}> 
            Proximity L {robotProx.left ?? '--'} cm • R {robotProx.right ?? '--'} cm
          </Text>
        ) : null}
        {connectionReason ? <Text style={[styles.metaText, { color: theme.muted }]}>{connectionReason}</Text> : null}
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

      <AppCard style={[styles.card, styles.connectionCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Pressable style={styles.connectionCardRow} onPress={() => setConnectionExpanded((current) => !current)}>
          <View style={styles.connectionCardInfo}>
            <View style={connectionDotStyle} />
            <View style={styles.connectionCardTextWrap}>
              <View style={styles.connectionCardTitleRow}>
                <Text style={[styles.sectionTitle, styles.connectionCardTitle, { color: theme.sectionTitle }]}>Connection</Text>
                <View style={styles.connectionBadge}>
                  <Text style={styles.connectionBadgeText}>{connectionBadgeLabel}</Text>
                </View>
              </View>
              <Text style={[styles.metaText, { color: theme.text }]}>{connectionLabel}</Text>
              <Text style={[styles.metaText, { color: theme.muted }]} numberOfLines={connectionExpanded ? 2 : 1}>
                {connectionBusy ? 'Checking server...' : connectionDetail}
              </Text>
              <Text style={[styles.metaText, { color: theme.muted }]}>Path: {connectionPathLabel}</Text>
            </View>
          </View>
          <View style={styles.connectionCardActions}>
            <AppButton
              label={connectionBusy ? 'Checking...' : 'Change'}
              onPress={onOpenConnection}
              disabled={connectionBusy}
              compact
              variant="secondary"
              style={styles.connectionChangeButton}
            />
            <Text style={[styles.connectionChevron, { color: theme.muted }]}>{connectionExpanded ? 'Hide' : 'Show'}</Text>
          </View>
        </Pressable>
        {connectionExpanded ? (
          <View style={styles.connectionExpandedBlock}>
            <Text style={[styles.metaText, { color: theme.muted }]}> 
              The app connects to the remote server, and that server manages the base station and robot link.
            </Text>
          </View>
        ) : null}
      </AppCard>



      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Material Mix</Text>
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
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Run Controls</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Commit the route, then use Start Auto to review checks and begin the run.</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Long paths are committed in local batches capped at 120 waypoints.</Text>
        <View style={styles.missionActionGrid}>
          <ActionButton label="Commit" onPress={() => performAction("push-waypoints")} disabled={!allowedAction("push-waypoints")?.enabled} busy={pendingAction === "push-waypoints"} compact />
          <ActionButton label="Start Auto" onPress={openPreflight} disabled={!allowedAction("mission-start")?.enabled} busy={pendingAction === "mission-start"} compact />
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

        <Text style={[styles.sectionTitle, { color: theme.sectionTitle, marginTop: 8 }]}>Manual Control</Text>
        <View style={styles.manualControlRow}>
          <AppButton label="Open Manual Control" onPress={openManualControl} style={styles.manualControlButton} />
          <View style={styles.manualGatewayStatus}>
            <View
              style={[
                styles.manualGatewayDot,
                manualGatewayConnected ? styles.manualGatewayDotConnected : styles.manualGatewayDotDisconnected,
              ]}
            />
            <Text style={[styles.manualGatewayText, { color: theme.muted }]}>
              {manualGatewayConnected ? "Connected" : "Disconnected"}
            </Text>
          </View>
        </View>
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Pressable style={styles.serviceToolsHeader} onPress={() => setServiceToolsVisible((current) => !current)}>
          <View style={styles.serviceToolsHeaderText}>
            <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Service Tools</Text>
            <Text style={[styles.metaText, { color: theme.muted }]}>Advanced checks and recent command history when needed.</Text>
          </View>
          <Text style={[styles.connectionChevron, { color: theme.muted }]}>{serviceToolsVisible ? 'Hide' : 'Show'}</Text>
        </Pressable>

        {serviceToolsVisible ? (
          <View style={styles.serviceToolsBody}>
      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Indoor Demo</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Drive indoors with manual control, then mark Spot A and Spot B when the robot reaches each demo position.</Text>
        <View style={styles.demoButtonRow}>
          <AppButton
            label={pendingAction === "demo-mode-toggle" ? "Updating..." : (demoModeEnabled ? "Return to Live" : "Enable Demo")}
            onPress={toggleDemoMode}
            disabled={pendingAction === "demo-mode-toggle"}
            variant={demoModeEnabled ? "secondary" : "primary"}
            style={styles.demoPrimaryButton}
          />
          <AppButton
            label="Open Manual Control"
            onPress={openManualControl}
            variant="outline"
            style={styles.demoPrimaryButton}
          />
        </View>
        <View style={styles.demoButtonRow}>
          <AppButton
            label={pendingAction === "demo-spot-start" ? "Marking Spot A..." : "Mark Spot A"}
            onPress={() => markDemoSpot("start")}
            disabled={!demoModeEnabled || pendingAction === "demo-spot-start"}
            variant="secondary"
            style={styles.demoPrimaryButton}
          />
          <AppButton
            label={pendingAction === "demo-spot-end" ? "Marking Spot B..." : "Mark Spot B"}
            onPress={() => markDemoSpot("end")}
            disabled={!demoModeEnabled || pendingAction === "demo-spot-end"}
            variant="secondary"
            style={styles.demoPrimaryButton}
          />
        </View>
        <View style={styles.demoSpotGrid}>
          <View style={styles.demoSpotCard}>
            <Text style={[styles.quickLabel, { color: theme.muted }]}>Spot A</Text>
            <Text style={[styles.metaText, { color: theme.text }]}>{formatDemoSpot(demoSpots?.start)}</Text>
            {demoSpotGpsStatus?.start?.ready === false ? (
              <Text style={styles.demoError}>{demoSpotGpsStatus.start.reason}</Text>
            ) : null}
          </View>
          <View style={styles.demoSpotCard}>
            <Text style={[styles.quickLabel, { color: theme.muted }]}>Spot B</Text>
            <Text style={[styles.metaText, { color: theme.text }]}>{formatDemoSpot(demoSpots?.end)}</Text>
            {demoSpotGpsStatus?.end?.ready === false ? (
              <Text style={styles.demoError}>{demoSpotGpsStatus.end.reason}</Text>
            ) : null}
          </View>
        </View>
        <AppButton
          label={pendingAction === "demo-path" ? "Building Demo Path..." : "Build Demo Path"}
          onPress={() => buildDemoPath(false)}
          disabled={!demoModeEnabled || !demoSpots?.start || !demoSpots?.end || pendingAction === "demo-path" || pendingAction === "demo-path-override"}
          variant="primary"
          style={styles.demoBuildButton}
        />
        <AppButton
          label={pendingAction === "demo-path-override" ? "Overriding GPS Check..." : "Build Demo Path (Service Override)"}
          onPress={() => buildDemoPath(true)}
          disabled={!demoModeEnabled || !demoSpots?.start || !demoSpots?.end || pendingAction === "demo-path" || pendingAction === "demo-path-override" || pendingAction === "demo-run"}
          variant="outline"
          style={styles.demoBuildButton}
        />
        <AppButton
          label={pendingAction === "demo-run" ? "Starting Demo Run..." : "Run Demo Path"}
          onPress={() => runDemoPath(true)}
          disabled={!demoModeEnabled || !demoSpots?.start || !demoSpots?.end || (directGatewayPreferred && demoPathPoints.length < 2) || pendingAction === "demo-path" || pendingAction === "demo-path-override" || pendingAction === "demo-run"}
          variant="success"
          style={styles.demoBuildButton}
        />
        <Text style={[styles.metaText, { color: theme.text }]}>Current path: {demoPathPoints.length} waypoint{demoPathPoints.length === 1 ? "" : "s"}</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Transport: {directGatewayPreferred ? "Phone to gateway over Wi-Fi" : "Server-managed delivery"}</Text>
        <View style={styles.demoSpotGrid}>
          <View style={styles.demoSpotCard}>
            <Text style={[styles.quickLabel, { color: theme.muted }]}>Run Readiness</Text>
            <Text style={[styles.metaText, { color: theme.text }]}>
              Mission {demoReadiness?.missionState ?? "Unknown"} • Waypoints {demoGatewayReady ? "ready in app" : (demoReadiness?.wpPushState ?? "none")}
            </Text>
            <Text style={[styles.metaText, { color: theme.text }]}>
              {(demoGatewayReady || demoReadiness?.readyToRun) ? "Ready to run" : "Not ready"}
            </Text>
            {demoBlockers.length ? demoBlockers.slice(0, 4).map((reason) => (
              <Text key={reason} style={styles.demoError}>{reason}</Text>
            )) : null}
          </View>
          <View style={styles.demoSpotCard}>
            <Text style={[styles.quickLabel, { color: theme.muted }]}>LoRa Diagnostics</Text>
            <Text style={[styles.metaText, { color: theme.text }]}>
              Path {demoDiagnostics?.commandPathState ?? "unknown"} • WP {demoDiagnostics?.wpPushState ?? "none"}
            </Text>
            <Text style={[styles.metaText, { color: theme.text }]}>
              LoRa {demoDiagnostics?.loraDegraded ? "degraded" : "ok"}
            </Text>
            {demoDiagnostics?.loraLastError ? <Text style={styles.demoError}>{demoDiagnostics.loraLastError}</Text> : null}
          </View>
        </View>
        <Text style={[styles.quickLabel, { color: theme.muted, marginTop: 8 }]}>Demo Tuning</Text>
        <View style={styles.demoTuningGrid}>
          <View style={styles.demoTuningField}>
            <Text style={[styles.demoTuningLabel, { color: theme.muted }]}>Lane Width (m)</Text>
            <TextInput
              style={[styles.input, styles.demoTuningInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={demoLaneWidthInput}
              onChangeText={setDemoLaneWidthInput}
              placeholder="Lane m"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={styles.demoTuningField}>
            <Text style={[styles.demoTuningLabel, { color: theme.muted }]}>Geofence Tolerance (m)</Text>
            <TextInput
              style={[styles.input, styles.demoTuningInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={demoGeofenceToleranceInput}
              onChangeText={setDemoGeofenceToleranceInput}
              placeholder="Fence tol m"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={styles.demoTuningField}>
            <Text style={[styles.demoTuningLabel, { color: theme.muted }]}>Minimum Spot Distance (m)</Text>
            <TextInput
              style={[styles.input, styles.demoTuningInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={demoMinSpotDistanceInput}
              onChangeText={setDemoMinSpotDistanceInput}
              placeholder="Min spot m"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={styles.demoTuningField}>
            <Text style={[styles.demoTuningLabel, { color: theme.muted }]}>Passes</Text>
            <TextInput
              style={[styles.input, styles.demoTuningInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={demoPassesInput}
              onChangeText={setDemoPassesInput}
              placeholder="Passes"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={styles.demoTuningField}>
            <Text style={[styles.demoTuningLabel, { color: theme.muted }]}>Obstacle Stop Distance (cm)</Text>
            <TextInput
              style={[styles.input, styles.demoTuningInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={demoObstacleStopInput}
              onChangeText={setDemoObstacleStopInput}
              placeholder="Stop cm"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={styles.demoTuningField}>
            <Text style={[styles.demoTuningLabel, { color: theme.muted }]}>Obstacle Sidestep Distance (cm)</Text>
            <TextInput
              style={[styles.input, styles.demoTuningInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              value={demoObstacleSidestepInput}
              onChangeText={setDemoObstacleSidestepInput}
              placeholder="Sidestep cm"
              placeholderTextColor={theme.muted}
            />
          </View>
        </View>
        <View style={styles.demoButtonRow}>
          <AppButton
            label={demoObstacleEnabled ? "Obstacle Policy: ON" : "Obstacle Policy: OFF"}
            onPress={() => setDemoObstacleEnabled((current) => !current)}
            variant={demoObstacleEnabled ? "success" : "outline"}
            style={styles.demoPrimaryButton}
          />
          <AppButton
            label={pendingAction === "demo-config-save" ? "Saving Tuning..." : "Save Demo Tuning"}
            onPress={saveDemoTuning}
            disabled={pendingAction === "demo-config-save"}
            variant="secondary"
            style={styles.demoPrimaryButton}
          />
        </View>
        {demoObstacle?.active ? (
          <Text style={[styles.metaText, { color: theme.muted }]}>Obstacle action: {demoObstacle.mode ?? "unknown"}{demoObstacle.side ? ` (${demoObstacle.side})` : ""} • nearest {demoObstacle.nearestCm ?? "--"} cm</Text>
        ) : null}
        {demoModeEnabled ? (
          <Text style={[styles.metaText, { color: theme.muted }]}>Demo mode keeps standard autonomy buttons locked. Build the demo path, then use Run Demo Path for indoor testing.</Text>
        ) : null}
      </AppCard>

            <Text style={[styles.metaText, { color: theme.muted }]}>Indoor demo tools are kept here for setup and testing.</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>LoRa app controls are grouped as LoRa App Commands and LoRa Transport below.</Text>
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

            <View style={styles.serviceToolsHistoryBlock}>
              <Text style={[styles.opsGroupTitle, { color: theme.sectionTitle }]}>Recent Commands</Text>
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
            </View>
          </View>
        ) : null}
      </AppCard>

      <AppCard style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}> 
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Notes</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Short notes for follow-up or record keeping.</Text>
        <TextInput
          style={[styles.input, styles.noteInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Add a note for the next update"
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
        visible={preflightVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreflightVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Preflight & Autonomy</Text>
                <Text style={styles.modalSubtitle}>Start Auto runs these checks before autonomy begins.</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={() => setPreflightVisible(false)}>
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>

            <View style={styles.preflightList}>
              {preflightItems.map((item) => (
                <View key={item.label} style={styles.preflightRow}>
                  <View style={[styles.preflightDot, item.good ? styles.preflightDotGood : styles.preflightDotNeeds]} />
                  <View style={styles.preflightTextWrap}>
                    <Text style={styles.preflightTitle}>{item.label}</Text>
                    <Text style={styles.modalStatusText}>{item.detail}</Text>
                  </View>
                  <Text style={[styles.preflightStateText, item.good ? styles.preflightStateGood : styles.preflightStateNeeds]}>
                    {item.good ? 'Ready' : 'Check'}
                  </Text>
                </View>
              ))}
            </View>

            {connectionReason ? <Text style={styles.modalStatusText}>{connectionReason}</Text> : null}

            <View style={styles.preflightActions}>
              <AppButton
                label="Start Autonomy"
                onPress={confirmMissionStart}
                disabled={!missionStartReady || pendingAction === 'mission-start'}
                variant="success"
                style={styles.preflightButton}
              />
              <AppButton
                label="Not Yet"
                onPress={() => setPreflightVisible(false)}
                variant="secondary"
                style={styles.preflightButton}
              />
            </View>
          </View>
        </View>
      </Modal>

      <JoystickControl
        visible={manualControlVisible}
        serverUrl={serverUrl}
        manualTargetUrl={resolvedManualServerUrl}
        missionStateLabel={missionStateLabel}
        robotOperationalState={formatRobotStateLabel(summary?.robot?.state ?? status?.state ?? "UNKNOWN")}
        lastCmd={status?.last_cmd ?? summary?.lora?.lastCmd ?? null}
        onClose={closeManualControl}
        joystickState={joystickState}
        setJoystickState={setJoystickState}
        onPerformCommand={performManualCommand}
        pendingAction={pendingAction}
        saltPct={saltPct}
        brinePct={brinePct}
      />
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
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: -2,
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
  flowCard: {
    marginTop: 2,
  },
  flowSteps: {
    gap: 10,
  },
  flowStep: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dce6f0',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flowStepTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#16324f',
    marginBottom: 4,
  },
  connectionCard: {
    marginTop: 2,
  },
  connectionCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  connectionCardInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  connectionCardTextWrap: {
    flex: 1,
    gap: 2,
  },
  connectionCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionCardTitle: {
    marginBottom: 0,
  },
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5,
  },
  connectionDotConnected: {
    backgroundColor: '#1f9d64',
  },
  connectionDotFallback: {
    backgroundColor: '#d98b1f',
  },
  connectionDotError: {
    backgroundColor: '#c84141',
  },
  connectionDotConnecting: {
    backgroundColor: '#5b88b8',
  },
  connectionBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#eef4fb',
    borderWidth: 1,
    borderColor: '#d7e2ee',
  },
  connectionBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#315781',
    textTransform: 'uppercase',
  },
  connectionCardActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  connectionChevron: {
    fontSize: 12,
    fontWeight: '700',
    color: '#63788e',
  },
  connectionExpandedBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e3eaf2',
  },
  serviceToolsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  serviceToolsHeaderText: {
    flex: 1,
    gap: 2,
  },
  serviceToolsBody: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e3eaf2',
    gap: 8,
  },
  serviceToolsHistoryBlock: {
    marginTop: 10,
    gap: 8,
  },
  connectionChangeButton: {
    minWidth: 92,
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
  manualControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  manualControlButton: {
    minWidth: 180,
  },
  manualGatewayStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  manualGatewayDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  manualGatewayDotConnected: {
    backgroundColor: "#1a9a5b",
  },
  manualGatewayDotDisconnected: {
    backgroundColor: "#b63d3d",
  },
  manualGatewayText: {
    fontSize: 12,
    fontWeight: "600",
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
  recoveryCard: {
    borderColor: '#dce7d2',
    backgroundColor: '#f8fcf4',
  },
  recoveryTitle: {
    marginBottom: 6,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryItem: {
    width: '48.5%',
    minHeight: 78,
    borderWidth: 1,
    borderColor: '#e3eaf2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: '#fbfcfe',
    gap: 3,
  },
  summaryItemWide: {
    width: '100%',
    minHeight: 56,
    paddingVertical: 6,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  summaryDetail: {
    fontSize: 11,
    lineHeight: 15,
  },
  systemBanner: {
    width: '100%',
    alignSelf: 'stretch',
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    gap: 1,
  },
  systemBannerGood: {
    borderColor: '#d4eadf',
    backgroundColor: '#f4fbf7',
  },
  systemBannerNeeds: {
    borderColor: '#f1dfbd',
    backgroundColor: '#fff9ef',
  },
  systemBannerTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16324f',
    textTransform: 'uppercase',
  },
  systemBannerText: {
    fontSize: 10,
    lineHeight: 14,
    color: '#4f6275',
  },
  systemCheckGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  systemCheckItem: {
    width: '48.5%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  systemCheckItemGood: {
    borderColor: '#d4eadf',
    backgroundColor: '#f4fbf7',
  },
  systemCheckItemNeeds: {
    borderColor: '#f1dfbd',
    backgroundColor: '#fff9ef',
  },
  systemCheckTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  systemCheckLabelBlock: {
    flex: 1,
    gap: 2,
  },
  quickStateBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  quickStateBadgeGood: {
    backgroundColor: '#dff3e8',
  },
  quickStateBadgeNeeds: {
    backgroundColor: '#f7e8cb',
  },
  quickStateBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#35506a',
    textTransform: 'uppercase',
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
  systemCheckValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  systemCheckDetail: {
    fontSize: 11,
    lineHeight: 15,
  },
  quickDetail: {
    fontSize: 11,
    lineHeight: 15,
  },
  metaText: {
    fontSize: 12,
    color: "#63788e",
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
  demoButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  demoPrimaryButton: {
    flex: 1,
  },
  demoSpotGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  demoSpotCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e1e8f0",
    borderRadius: 12,
    padding: 12,
    gap: 4,
    backgroundColor: "#f8fbff",
  },
  demoBuildButton: {
    marginTop: 10,
  },
  preflightList: {
    gap: 10,
  },
  preflightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  preflightDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 6,
  },
  preflightDotGood: {
    backgroundColor: '#1f9d64',
  },
  preflightDotNeeds: {
    backgroundColor: '#d98b1f',
  },
  preflightTextWrap: {
    flex: 1,
    gap: 2,
  },
  preflightTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#13233a',
  },
  preflightStateText: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  preflightStateGood: {
    color: '#1f7a52',
  },
  preflightStateNeeds: {
    color: '#9b5c12',
  },
  preflightActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  preflightButton: {
    flex: 1,
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
  demoTuningGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  demoTuningField: {
    width: "48%",
    gap: 4,
  },
  demoTuningLabel: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
  },
  demoTuningInput: {
    minHeight: 42,
    width: "100%",
  },
  demoError: {
    color: "#b63d3d",
    marginTop: 2,
    lineHeight: 16,
  },
  demoInputLabel: {
    width: 118,
    fontSize: 11,
    fontWeight: "600",
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



























import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
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

type TestMenuResponse = {
  ok: boolean;
  tests: TestMenuAction[];
  commandHistory?: CommandHistoryEntry[];
};

type StatusResponse = StatusPayload;

type JoystickState = {
  x: number;
  y: number;
  drive: number;
  turn: number;
  active: boolean;
};

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  setSaltPct: (value: number) => void;
  setBrinePct: (value: number) => void;
  connectionLabel: string;
  connectionStatus: 'connecting' | 'connected' | 'fallback' | 'error';
  connectionDetail: string;
  connectionMode: 'discovering' | 'local' | 'cloud' | 'manual';
  connectionBusy: boolean;
  onOpenConnection: () => void;
};

const MISSION_ENDPOINTS: Record<string, string> = {
  "mission-start": "/api/mission/start",
  "mission-pause": "/api/mission/pause",
  "mission-resume": "/api/mission/resume",
  "mission-abort": "/api/mission/abort",
  "mission-complete": "/api/mission/complete",
  "push-waypoints": "/api/lora/push-waypoints",
};

const JOYSTICK_PAD_SIZE = 172;
const JOYSTICK_KNOB_SIZE = 64;
const JOYSTICK_TRAVEL_RADIUS = (JOYSTICK_PAD_SIZE - JOYSTICK_KNOB_SIZE) / 2;
const JOYSTICK_SEND_INTERVAL_MS = 85;
const JOYSTICK_DEAD_ZONE = 0.145;
const JOYSTICK_COMMAND_STEP = 2;
const JOYSTICK_RESPONSE_CURVE = 1.3;
const JOYSTICK_TOUCH_SLOP_PX = 8;
const JOYSTICK_STRAIGHT_LOCK_THRESHOLD = 0.16;
const JOYSTICK_STRAIGHT_ASSIST_START = 0.3;
const JOYSTICK_STRAIGHT_TURN_SCALE = 0.34;
const JOYSTICK_AXIS_LOCK_MARGIN = 0.18;
const JOYSTICK_AXIS_LOCK_BREAK = 0.3;
const JOYSTICK_TURN_WHILE_DRIVING_SCALE = 0.22;
const JOYSTICK_DRIVE_WHILE_TURNING_SCALE = 0.5;
const JOYSTICK_INPUT_SMOOTHING = 0.29;
const JOYSTICK_VISUAL_SMOOTHING = 0.44;
const JOYSTICK_EDGE_FOLLOW_BOOST = 0.16;
const JOYSTICK_CENTER_SETTLE = 0.085;
const JOYSTICK_COMMAND_HYSTERESIS = 12;
const JOYSTICK_CENTER_DAMP_ZONE = 0.3;
const JOYSTICK_CENTER_DAMP_SCALE = 0.68;
const JOYSTICK_MID_DAMP_ZONE = 0.52;
const JOYSTICK_MID_DAMP_SCALE = 0.9;
const JOYSTICK_COMMAND_MAX_STEP = 12;
const JOYSTICK_REVERSAL_GUARD = 14;
const JOYSTICK_FORCE_SEND_DELTA = 12;
const JOYSTICK_FORCE_SEND_GAP_MS = 45;
const JOYSTICK_INNER_VISUAL_SMOOTHING = 0.6;
const JOYSTICK_INNER_COMMAND_SMOOTHING = 0.42;
const JOYSTICK_INNER_RADIUS = 0.5;
const MANUAL_BUTTON_INITIAL_REPEAT_MS = 150;
const MANUAL_BUTTON_REPEAT_MS = 120;

function clampJoystickAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function applyJoystickDeadZone(value: number): number {
  const clamped = clampJoystickAxis(value);
  const magnitude = Math.abs(clamped);

  if (magnitude <= JOYSTICK_DEAD_ZONE) {
    return 0;
  }

  const normalized = (magnitude - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE);
  const curved = Math.pow(normalized, JOYSTICK_RESPONSE_CURVE);
  return Math.sign(clamped) * curved;
}

function snapJoystickPercent(value: number): number {
  const snapped = Math.round(value / JOYSTICK_COMMAND_STEP) * JOYSTICK_COMMAND_STEP;
  return Math.max(-100, Math.min(100, snapped));
}

function smoothJoystickAxis(previous: number, next: number): number {
  const radius = Math.min(1, Math.abs(next));
  const baseBlend = radius < JOYSTICK_INNER_RADIUS
    ? JOYSTICK_INNER_COMMAND_SMOOTHING
    : JOYSTICK_INPUT_SMOOTHING;
  const blend = Math.abs(next) > Math.abs(previous) ? baseBlend : baseBlend * 0.78;
  const filtered = previous + (next - previous) * blend;
  return Math.abs(filtered) < JOYSTICK_CENTER_SETTLE ? 0 : filtered;
}

function smoothJoystickVector(
  previous: { turn: number; drive: number },
  next: { turn: number; drive: number },
  baseBlend: number,
): { turn: number; drive: number } {
  const radius = Math.min(1, Math.hypot(next.turn, next.drive));
  const effectiveBaseBlend = radius < JOYSTICK_INNER_RADIUS
    ? Math.max(baseBlend, JOYSTICK_INNER_VISUAL_SMOOTHING)
    : baseBlend;
  const blend = Math.min(0.78, effectiveBaseBlend + radius * JOYSTICK_EDGE_FOLLOW_BOOST);
  const turn = previous.turn + (next.turn - previous.turn) * blend;
  const drive = previous.drive + (next.drive - previous.drive) * blend;
  return {
    turn: Math.abs(turn) < JOYSTICK_CENTER_SETTLE ? 0 : turn,
    drive: Math.abs(drive) < JOYSTICK_CENTER_SETTLE ? 0 : drive,
  };
}

function dampJoystickAxis(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) {
    return 0;
  }
  if (magnitude < JOYSTICK_CENTER_DAMP_ZONE) {
    return value * JOYSTICK_CENTER_DAMP_SCALE;
  }
  if (magnitude < JOYSTICK_MID_DAMP_ZONE) {
    return value * JOYSTICK_MID_DAMP_SCALE;
  }
  return value;
}

function stabilizeJoystickPercent(previous: number, next: number): number {
  if (next === 0) {
    return Math.abs(previous) <= JOYSTICK_COMMAND_HYSTERESIS ? 0 : next;
  }

  if (previous === 0 && Math.abs(next) <= JOYSTICK_COMMAND_HYSTERESIS) {
    return 0;
  }

  if (Math.sign(previous) === Math.sign(next) && Math.abs(next - previous) < JOYSTICK_COMMAND_HYSTERESIS) {
    return previous;
  }

  return next;
}

function limitJoystickPercentChange(previous: number, next: number): number {
  if (previous !== 0 && next !== 0 && Math.sign(previous) !== Math.sign(next) && Math.abs(next) < JOYSTICK_REVERSAL_GUARD) {
    return 0;
  }

  const delta = next - previous;
  if (Math.abs(delta) <= JOYSTICK_COMMAND_MAX_STEP) {
    return next;
  }

  return previous + Math.sign(delta) * JOYSTICK_COMMAND_MAX_STEP;
}

function shapeJoystickVector(
  rawTurn: number,
  rawDrive: number,
  lockedMode: 'free' | 'drive' | 'turn',
): { turn: number; drive: number; mode: 'free' | 'drive' | 'turn' } {
  let turnAxis = applyJoystickDeadZone(rawTurn);
  let driveAxis = applyJoystickDeadZone(rawDrive);

  const absTurn = Math.abs(turnAxis);
  const absDrive = Math.abs(driveAxis);
  let mode = lockedMode;

  if (mode === 'free') {
    if (absDrive >= JOYSTICK_STRAIGHT_ASSIST_START && absDrive - absTurn >= JOYSTICK_AXIS_LOCK_MARGIN) {
      mode = 'drive';
    } else if (absTurn >= JOYSTICK_STRAIGHT_ASSIST_START && absTurn - absDrive >= JOYSTICK_AXIS_LOCK_MARGIN) {
      mode = 'turn';
    }
  }

  if (mode === 'drive') {
    if (absTurn > absDrive + JOYSTICK_AXIS_LOCK_BREAK) {
      mode = 'turn';
    } else if (absTurn <= JOYSTICK_STRAIGHT_LOCK_THRESHOLD) {
      turnAxis = 0;
    } else {
      turnAxis *= JOYSTICK_TURN_WHILE_DRIVING_SCALE;
    }
  }

  if (mode === 'turn') {
    if (absDrive > absTurn + JOYSTICK_AXIS_LOCK_BREAK) {
      mode = 'drive';
    } else {
      driveAxis *= JOYSTICK_DRIVE_WHILE_TURNING_SCALE;
    }
  }

  if (mode === 'free' && absDrive >= JOYSTICK_STRAIGHT_ASSIST_START) {
    if (absTurn <= JOYSTICK_STRAIGHT_LOCK_THRESHOLD) {
      turnAxis = 0;
    } else if (absTurn < absDrive) {
      turnAxis *= JOYSTICK_STRAIGHT_TURN_SCALE;
    }
  }

  if (absTurn > absDrive + 0.2 && absDrive < 0.34) {
    driveAxis *= 0.72;
  }

  return {
    turn: snapJoystickPercent(turnAxis * 100),
    drive: snapJoystickPercent(driveAxis * 100),
    mode,
  };
}

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

export default function ControllerScreen({
  serverUrl,
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
  const [pressedManualButton, setPressedManualButton] = useState<string | null>(null);
  const [socketState, setSocketState] = useState("polling");
  const [manualControlVisible, setManualControlVisible] = useState(false);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [serviceToolsVisible, setServiceToolsVisible] = useState(false);
  const [preflightVisible, setPreflightVisible] = useState(false);
  const emptyJoystickState: JoystickState = { x: 0, y: 0, drive: 0, turn: 0, active: false };
  const [joystickState, setJoystickState] = useState<JoystickState>(emptyJoystickState);
  const refreshInFlight = useRef(false);
  const heldManualCommand = useRef<string | null>(null);
  const heldManualTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldManualDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldManualInFlight = useRef(false);
  const joystickCommand = useRef({ drive: 0, turn: 0 });
  const joystickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const joystickInFlight = useRef(false);
  const queuedJoystickCommand = useRef<{ drive: number; turn: number; refreshAfter: boolean } | null>(null);
  const lastJoystickSent = useRef({ drive: 0, turn: 0 });
  const lastJoystickDispatchAt = useRef(0);
  const joystickKnobPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const joystickAxisLock = useRef<'free' | 'drive' | 'turn'>('free');
  const joystickFilteredInput = useRef({ turn: 0, drive: 0 });
  const joystickVisualInput = useRef({ turn: 0, drive: 0 });

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
    const timer = setInterval(refresh, 1000);
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
          message.event === "operator.updated" ||
          message.event === "ws.test"
        ) {
          setSocketState("live");
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

  useEffect(() => {
    return () => {
      if (heldManualTimer.current) {
        clearInterval(heldManualTimer.current);
      }
      if (heldManualDelayTimer.current) {
        clearTimeout(heldManualDelayTimer.current);
      }
      if (joystickTimer.current) {
        clearInterval(joystickTimer.current);
      }
    };
  }, []);

  const clearHeldManualLoop = () => {
    if (heldManualDelayTimer.current) {
      clearTimeout(heldManualDelayTimer.current);
      heldManualDelayTimer.current = null;
    }
    if (heldManualTimer.current) {
      clearInterval(heldManualTimer.current);
      heldManualTimer.current = null;
    }
    heldManualCommand.current = null;
  };

  const postHeldManualCommand = async (command: string, refreshAfter = false) => {
    if (heldManualInFlight.current) {
      return;
    }

    heldManualInFlight.current = true;
    try {
      await postText(serverUrl, "/command", command.toUpperCase());
      setError(null);
      if (refreshAfter) {
        await refresh();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Command failed: ${command}`);
    } finally {
      heldManualInFlight.current = false;
    }
  };

  const clearJoystickState = () => {
    joystickCommand.current = { drive: 0, turn: 0 };
    queuedJoystickCommand.current = null;
    joystickAxisLock.current = 'free';
    joystickFilteredInput.current = { turn: 0, drive: 0 };
    joystickVisualInput.current = { turn: 0, drive: 0 };
    joystickKnobPosition.stopAnimation();
    Animated.spring(joystickKnobPosition, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: true,
      speed: 24,
      bounciness: 0,
    }).start();
    setJoystickState((current) => (
      current.drive === 0 && current.turn === 0 && !current.active ? current : emptyJoystickState
    ));
  };

  const postDriveVector = async (drive: number, turn: number, refreshAfter = false) => {
    const nextDrive = Math.max(-100, Math.min(100, Math.round(drive)));
    const nextTurn = Math.max(-100, Math.min(100, Math.round(turn)));

    if (joystickInFlight.current) {
      queuedJoystickCommand.current = { drive: nextDrive, turn: nextTurn, refreshAfter };
      return;
    }

    if (lastJoystickSent.current.drive === nextDrive && lastJoystickSent.current.turn === nextTurn) {
      if (refreshAfter) {
        await refresh();
      }
      return;
    }

    joystickInFlight.current = true;
    lastJoystickDispatchAt.current = Date.now();
    try {
      await postText(serverUrl, "/command", `DRIVE,THROTTLE:${nextDrive},TURN:${nextTurn}`);
      lastJoystickSent.current = { drive: nextDrive, turn: nextTurn };
      setError(null);
      if (refreshAfter) {
        await refresh();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Manual drive command failed");
    } finally {
      joystickInFlight.current = false;
      const queued = queuedJoystickCommand.current;
      queuedJoystickCommand.current = null;
      if (queued && (queued.drive !== nextDrive || queued.turn !== nextTurn || queued.refreshAfter)) {
        void postDriveVector(queued.drive, queued.turn, queued.refreshAfter);
      }
    }
  };

  const ensureJoystickLoop = () => {
    if (joystickTimer.current) {
      return;
    }

    joystickTimer.current = setInterval(() => {
      if (!manualControlVisible) {
        return;
      }
      const next = joystickCommand.current;
      void postDriveVector(next.drive, next.turn);
    }, JOYSTICK_SEND_INTERVAL_MS);
  };

  const updateJoystickFromTouch = (locationX: number, locationY: number) => {
    clearHeldManualLoop();

    const rawX = locationX - JOYSTICK_PAD_SIZE / 2;
    const rawY = locationY - JOYSTICK_PAD_SIZE / 2;
    const distance = Math.hypot(rawX, rawY);
    if (distance <= JOYSTICK_TOUCH_SLOP_PX) {
      locationX = JOYSTICK_PAD_SIZE / 2;
      locationY = JOYSTICK_PAD_SIZE / 2;
    }
    const scale = distance > JOYSTICK_TRAVEL_RADIUS ? JOYSTICK_TRAVEL_RADIUS / distance : 1;
    const x = (locationX - JOYSTICK_PAD_SIZE / 2) * scale;
    const y = (locationY - JOYSTICK_PAD_SIZE / 2) * scale;

    const rawTurnInput = x / JOYSTICK_TRAVEL_RADIUS;
    const rawDriveInput = (-1 * y) / JOYSTICK_TRAVEL_RADIUS;
    const rawVector = { turn: rawTurnInput, drive: rawDriveInput };

    const nextVisualInput = smoothJoystickVector(
      joystickVisualInput.current,
      rawVector,
      JOYSTICK_VISUAL_SMOOTHING,
    );
    joystickVisualInput.current = nextVisualInput;

    const nextCommandInput = {
      turn: smoothJoystickAxis(joystickFilteredInput.current.turn, rawTurnInput),
      drive: smoothJoystickAxis(joystickFilteredInput.current.drive, rawDriveInput),
    };
    joystickFilteredInput.current = nextCommandInput;

    const { turn: rawTurn, drive: rawDrive, mode } = shapeJoystickVector(
      dampJoystickAxis(nextCommandInput.turn),
      dampJoystickAxis(nextCommandInput.drive),
      joystickAxisLock.current,
    );
    joystickAxisLock.current = mode;
    const turn = limitJoystickPercentChange(
      joystickCommand.current.turn,
      stabilizeJoystickPercent(joystickCommand.current.turn, rawTurn),
    );
    const drive = limitJoystickPercentChange(
      joystickCommand.current.drive,
      stabilizeJoystickPercent(joystickCommand.current.drive, rawDrive),
    );
    const displayX = nextVisualInput.turn * JOYSTICK_TRAVEL_RADIUS;
    const displayY = (-nextVisualInput.drive) * JOYSTICK_TRAVEL_RADIUS;
    const active = drive !== 0 || turn !== 0;

    joystickKnobPosition.setValue({ x: displayX, y: displayY });
    joystickCommand.current = { drive, turn };
    setJoystickState((current) => (
      current.drive === drive && current.turn === turn && current.active === active
        ? current
        : { x: displayX, y: displayY, drive, turn, active }
    ));

    const shouldKickImmediate = !joystickTimer.current;
    ensureJoystickLoop();
    if (shouldKickImmediate) {
      void postDriveVector(drive, turn);
      return;
    }

    const elapsedSinceDispatch = Date.now() - lastJoystickDispatchAt.current;
    const driveDelta = Math.abs(drive - lastJoystickSent.current.drive);
    const turnDelta = Math.abs(turn - lastJoystickSent.current.turn);
    if (
      !joystickInFlight.current
      && elapsedSinceDispatch >= JOYSTICK_FORCE_SEND_GAP_MS
      && (driveDelta >= JOYSTICK_FORCE_SEND_DELTA || turnDelta >= JOYSTICK_FORCE_SEND_DELTA)
    ) {
      void postDriveVector(drive, turn);
    }
  };

  const releaseJoystickDrive = async (refreshAfter = true) => {
    if (joystickTimer.current) {
      clearInterval(joystickTimer.current);
      joystickTimer.current = null;
    }
    clearJoystickState();
    await postDriveVector(0, 0, refreshAfter);
  };

  const joystickResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        updateJoystickFromTouch(event.nativeEvent.locationX, event.nativeEvent.locationY);
      },
      onPanResponderMove: (event) => {
        updateJoystickFromTouch(event.nativeEvent.locationX, event.nativeEvent.locationY);
      },
      onPanResponderRelease: () => {
        void releaseJoystickDrive();
      },
      onPanResponderTerminate: () => {
        void releaseJoystickDrive();
      },
    }),
    [manualControlVisible, serverUrl],
  );

  const performCommand = async (command: string) => {
    if (joystickTimer.current) {
      clearInterval(joystickTimer.current);
      joystickTimer.current = null;
    }
    clearJoystickState();

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

  const beginHeldManualCommand = async (command: string) => {
    if (heldManualCommand.current === command || pendingAction) {
      return;
    }

    if (joystickTimer.current) {
      clearInterval(joystickTimer.current);
      joystickTimer.current = null;
    }
    clearJoystickState();
    setPressedManualButton(null);
    clearHeldManualLoop();

    setPressedManualButton(command);
    heldManualCommand.current = command;
    await postHeldManualCommand(command);

    heldManualDelayTimer.current = setTimeout(() => {
      if (heldManualCommand.current !== command) {
        return;
      }
      heldManualTimer.current = setInterval(() => {
        if (heldManualCommand.current !== command) {
          return;
        }
        void postHeldManualCommand(command);
      }, MANUAL_BUTTON_REPEAT_MS);
    }, MANUAL_BUTTON_INITIAL_REPEAT_MS);
  };

  const releaseHeldManualCommand = async () => {
    setPressedManualButton(null);
    clearHeldManualLoop();
    if (pendingAction) {
      return;
    }
    await postHeldManualCommand("STOP", true);
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

  const openPreflight = () => {
    if (demoModeEnabled) {
      setError("Demo mode is on. Use manual drive for the indoor demo instead of starting a mission.");
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
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to change demo mode');
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
      });
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Unable to mark ${kind === 'start' ? 'Spot A' : 'Spot B'}`);
    } finally {
      setPendingAction(null);
    }
  };

  const buildDemoPath = async (allowWeakGps = false) => {
    setPendingAction(allowWeakGps ? "demo-path-override" : "demo-path");
    try {
      const response = await postJson<{ warnings?: string[] }>(serverUrl, "/api/demo-mode/path", {
        source: "app.controller",
        saltPct,
        brinePct,
        allowWeakGps,
      });
      setTestResult(Array.isArray(response?.warnings) && response.warnings.length ? response.warnings.join(" ") : null);
      setError(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to build demo path");
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
      const payload: Record<string, unknown> = { actionId: action.id };
      if (field) {
        payload[field] = rawValue;
      }
      const response = await postJson<TestMenuRunResponse>(serverUrl, "/api/test-menu/run", payload);
      setTestResult(summarizeCommandResult(action.title, response));
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
  const robotOperationalState = summary?.robot?.state ?? status?.state ?? "UNKNOWN";
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
  const missionStateLabel = formatMissionStateLabel(missionState);
  const robotOperationalLabel = formatRobotStateLabel(robotOperationalState);
  const overallConnectionLabel = formatConnectionStateLabel(overallConnectionState);
  const backendStateLabel = formatConnectionStateLabel(backendState);
  const baseStationStateLabel = formatConnectionStateLabel(baseStationState);
  const robotLinkStateLabel = formatConnectionStateLabel(robotLinkState);
  const commandPathStateLabel = formatConnectionStateLabel(commandPathState);
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
  const waypointsCommitted = summary?.lora?.wpPushState === "committed";
  const missionStartReady = Boolean(allowedAction("mission-start")?.enabled);
  const demoModeEnabled = Boolean(summary?.demo?.enabled);
  const demoSpots = summary?.demo?.spots ?? null;
  const demoSpotGpsStatus = summary?.demo?.spotGpsStatus ?? null;
  const restoredAt = health?.persistence?.restoredAt ?? null;
  const showRecoveryBanner = Boolean(restoredAt && missionState !== "IDLE");
  const summaryItems = [
    { label: "Mission", value: missionStateLabel, detail: "Current status" },
    { label: "Robot", value: robotOperationalLabel, detail: robotLinkState === "online" ? "Telemetry live" : "Telemetry needs attention" },
    { label: "Coverage", value: `${coveragePct.toFixed(1)}%`, detail: "Progress" },
  ];
  const systemCheckItems = [
    { label: "Remote Server", value: backendStateLabel, detail: connectionPathLabel, good: backendState === "online" },
    { label: "Base Station", value: baseStationOperationalState, detail: baseStationTransportLabel || "Link status", good: baseStationReachable },
    { label: "Gateway", value: gatewayLabel || formatConnectionStateLabel(gatewayState), detail: gatewayReason ?? "LoRa bridge", good: gatewayWorking },
    { label: "STM32", value: stm32StateLabel, detail: stm32LastSeenLabel, good: stm32Online },
    { label: "GPS", value: gpsReady ? "Ready" : "Needs attention", detail: gpsReady ? "Autonomy ready" : "Wait for lock", good: gpsReady },
    { label: "Waypoints", value: waypointsCommitted ? "Committed" : "Not committed", detail: commandPathStateLabel, good: waypointsCommitted },
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
    { label: "Waypoints committed", detail: "The planned path has been committed to the robot.", good: waypointsCommitted },
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

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.pageBg, paddingTop: insets.top + 8 }]}> 
      <Text style={[styles.title, { color: theme.title }]}>RAIS Controller</Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusPill, socketState === 'live' ? styles.statusPillLive : styles.statusPillPoll]}>
          <Text style={styles.statusPillText}>{socketState === 'live' ? 'Live' : 'Polling'}</Text>
        </View>
        <View style={[styles.statusPill, styles.statusPillMission]}>
          <Text style={styles.statusPillText}>{robotOperationalLabel}</Text>
        </View>
        <View style={[styles.statusPill, connectionPillStyle]}>
          <Text style={styles.statusPillText}>{overallConnectionLabel}</Text>
        </View>
        <View style={[styles.statusPill, hasCriticalAlert ? styles.statusPillCritical : styles.statusPillOk]}>
          <Text style={styles.statusPillText}>{hasCriticalAlert ? "Critical Alert" : "No Critical Alerts"}</Text>
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
        <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>Run Controls</Text>
        <Text style={[styles.metaText, { color: theme.muted }]}>Commit the route, then use Start Auto to review checks and begin the run.</Text>
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
        <AppButton label="Open Manual Control" onPress={() => setManualControlVisible(true)} style={styles.manualLauncher} />
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
            onPress={() => setManualControlVisible(true)}
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
              <Text style={styles.error}>{demoSpotGpsStatus.start.reason}</Text>
            ) : null}
          </View>
          <View style={styles.demoSpotCard}>
            <Text style={[styles.quickLabel, { color: theme.muted }]}>Spot B</Text>
            <Text style={[styles.metaText, { color: theme.text }]}>{formatDemoSpot(demoSpots?.end)}</Text>
            {demoSpotGpsStatus?.end?.ready === false ? (
              <Text style={styles.error}>{demoSpotGpsStatus.end.reason}</Text>
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
          disabled={!demoModeEnabled || !demoSpots?.start || !demoSpots?.end || pendingAction === "demo-path" || pendingAction === "demo-path-override"}
          variant="outline"
          style={styles.demoBuildButton}
        />
        {demoModeEnabled ? (
          <Text style={[styles.metaText, { color: theme.muted }]}>Demo mode keeps autonomy locked while manual driving and safe stop actions stay available.</Text>
        ) : null}
      </AppCard>

            <Text style={[styles.metaText, { color: theme.muted }]}>Indoor demo tools are kept here for setup and testing.</Text>
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

      <Modal
        visible={manualControlVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { void releaseJoystickDrive(false); void releaseHeldManualCommand(); setManualControlVisible(false); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Manual / Joystick Control</Text>
                <Text style={styles.modalSubtitle}>Use the thumb pad for finer low-speed control, or hold the buttons for fixed moves.</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={() => { void releaseJoystickDrive(false); void releaseHeldManualCommand(); setManualControlVisible(false); }}>
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.modalStatusText}>Mission {missionStateLabel} | Robot {formatRobotStateLabel(summary?.robot?.state ?? status?.state ?? "UNKNOWN")} | Cmd {status?.last_cmd ?? summary?.lora?.lastCmd ?? "--"}</Text>
            <Text style={styles.manualHintText}>Slide from center for smoother steering and slower corrections; release anywhere to stop.</Text>

            <View style={styles.manualDrivePanel}>
              <Text style={styles.manualMiniLabel}>Thumb pad</Text>
              <View style={styles.joystickPad} {...joystickResponder.panHandlers}>
                <View style={styles.joystickAxisHorizontal} />
                <View style={styles.joystickAxisVertical} />
                <Animated.View
                  style={[
                    styles.joystickKnob,
                    { transform: joystickKnobPosition.getTranslateTransform() },
                  ]}
                />
              </View>
              <Text style={[styles.joystickReadout, joystickState.active ? styles.joystickReadoutActive : null]}>
                Drive {joystickState.drive}% • Turn {joystickState.turn}%
              </Text>
            </View>

            <View style={styles.dpad}>
              <Text style={styles.manualMiniLabel}>Quick buttons</Text>
              <Pressable
                style={[styles.commandButton, pressedManualButton === "FORWARD" ? styles.commandButtonActive : null]}
                onPressIn={() => { void beginHeldManualCommand("FORWARD"); }}
                onPressOut={() => { void releaseHeldManualCommand(); }}
              >
                <Text style={[styles.commandText, pressedManualButton === "FORWARD" ? styles.commandTextActive : null]}>
                  {pressedManualButton === "FORWARD" || pendingAction === "FORWARD" ? "FWD..." : "FWD"}
                </Text>
              </Pressable>
              <View style={styles.row}>
                <Pressable
                  style={[styles.commandButton, pressedManualButton === "LEFT" ? styles.commandButtonActive : null]}
                  onPressIn={() => { void beginHeldManualCommand("LEFT"); }}
                  onPressOut={() => { void releaseHeldManualCommand(); }}
                >
                  <Text style={[styles.commandText, pressedManualButton === "LEFT" ? styles.commandTextActive : null]}>
                    {pressedManualButton === "LEFT" || pendingAction === "LEFT" ? "TURN L..." : "TURN L"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.commandButton, styles.stopButton, pressedManualButton === "STOP" ? styles.stopButtonActive : null]}
                  onPressIn={() => setPressedManualButton("STOP")}
                  onPressOut={() => setPressedManualButton(null)}
                  onPress={() => performCommand("STOP")}
                >
                  <Text style={[styles.commandText, pressedManualButton === "STOP" ? styles.commandTextActive : null]}>
                    {pressedManualButton === "STOP" || pendingAction === "STOP" ? "STOP..." : "STOP"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.commandButton, pressedManualButton === "RIGHT" ? styles.commandButtonActive : null]}
                  onPressIn={() => { void beginHeldManualCommand("RIGHT"); }}
                  onPressOut={() => { void releaseHeldManualCommand(); }}
                >
                  <Text style={[styles.commandText, pressedManualButton === "RIGHT" ? styles.commandTextActive : null]}>
                    {pressedManualButton === "RIGHT" || pendingAction === "RIGHT" ? "TURN R..." : "TURN R"}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                style={[styles.commandButton, pressedManualButton === "BACKWARD" ? styles.commandButtonActive : null]}
                onPressIn={() => { void beginHeldManualCommand("BACKWARD"); }}
                onPressOut={() => { void releaseHeldManualCommand(); }}
              >
                <Text style={[styles.commandText, pressedManualButton === "BACKWARD" ? styles.commandTextActive : null]}>
                  {pressedManualButton === "BACKWARD" || pendingAction === "BACKWARD" ? "REV..." : "REV"}
                </Text>
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
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  commandButtonActive: {
    backgroundColor: "#1f5a97",
    transform: [{ scale: 0.97 }],
    shadowColor: "#14324f",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  stopButton: {
    backgroundColor: "#b63d3d",
  },
  stopButtonActive: {
    backgroundColor: "#9f2f2f",
  },
  commandText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  commandTextActive: {
    color: "#f5fbff",
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
  manualHintText: {
    fontSize: 12,
    lineHeight: 17,
    color: "#4f6275",
  },
  manualDrivePanel: {
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  manualMiniLabel: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: "700",
    color: "#37506a",
  },
  joystickPad: {
    width: JOYSTICK_PAD_SIZE,
    height: JOYSTICK_PAD_SIZE,
    borderRadius: JOYSTICK_PAD_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef4fb",
    borderWidth: 1,
    borderColor: "#d4e0ee",
    position: "relative",
  },
  joystickAxisHorizontal: {
    position: "absolute",
    left: 20,
    right: 20,
    height: 2,
    borderRadius: 999,
    backgroundColor: "#d1dceb",
  },
  joystickAxisVertical: {
    position: "absolute",
    top: 20,
    bottom: 20,
    width: 2,
    borderRadius: 999,
    backgroundColor: "#d1dceb",
  },
  joystickKnob: {
    position: "absolute",
    top: (JOYSTICK_PAD_SIZE - JOYSTICK_KNOB_SIZE) / 2,
    left: (JOYSTICK_PAD_SIZE - JOYSTICK_KNOB_SIZE) / 2,
    width: JOYSTICK_KNOB_SIZE,
    height: JOYSTICK_KNOB_SIZE,
    borderRadius: JOYSTICK_KNOB_SIZE / 2,
    backgroundColor: "#2c6fb7",
    borderWidth: 3,
    borderColor: "#ffffff",
    shadowColor: "#1d3f68",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  joystickReadout: {
    fontSize: 12,
    fontWeight: "700",
    color: "#63788e",
  },
  joystickReadoutActive: {
    color: "#174f83",
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



























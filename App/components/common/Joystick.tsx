import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  GestureResponderEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { postPlainText, postText, toWebSocketUrl } from "../../lib/serverApi";

export type JoystickState = {
  x: number;
  y: number;
  drive: number;
  turn: number;
  active: boolean;
};

type ManualTransportMode = "direct-base" | "server-fallback" | "server-only" | "server-live";

export const JOYSTICK_PAD_SIZE = 172;
export const JOYSTICK_KNOB_SIZE = 64;
export const JOYSTICK_TRAVEL_RADIUS = (JOYSTICK_PAD_SIZE - JOYSTICK_KNOB_SIZE) / 2;
export const JOYSTICK_DEAD_ZONE = 0.06;
const JOYSTICK_SEND_MIN_INTERVAL_MS = 40;
const JOYSTICK_HOLD_REPEAT_MS = 90;
const HELD_COMMAND_REPEAT_MS = 90;
const STOP_BURST_COUNT = 3;
const STOP_BURST_GAP_MS = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeToPercent(value: number): number {
  return Math.round(clamp(value, -100, 100));
}

function computeJoystickValues(locationX: number, locationY: number) {
  const rawX = locationX - JOYSTICK_PAD_SIZE / 2;
  const rawY = locationY - JOYSTICK_PAD_SIZE / 2;
  const distance = Math.hypot(rawX, rawY);
  const scale = distance > JOYSTICK_TRAVEL_RADIUS ? JOYSTICK_TRAVEL_RADIUS / distance : 1;
  const x = rawX * scale;
  const y = rawY * scale;

  const rawTurn = normalizeToPercent((x / JOYSTICK_TRAVEL_RADIUS) * 100);
  const rawDrive = normalizeToPercent((-y / JOYSTICK_TRAVEL_RADIUS) * 100);

  const turn = Math.abs(rawTurn) <= JOYSTICK_DEAD_ZONE * 100 ? 0 : rawTurn;
  const drive = Math.abs(rawDrive) <= JOYSTICK_DEAD_ZONE * 100 ? 0 : rawDrive;

  return { x, y, turn, drive };
}

function buildCompactManualPacket(seq: number, drive: number, turn: number) {
  return `J:${seq},${drive},${turn}`;
}

async function postManualCommand(
  serverUrl: string,
  targetUrl: string,
  command: string,
  directToBase: boolean,
  tryServerSocket?: (command: string) => boolean,
): Promise<ManualTransportMode> {
  if (directToBase) {
    try {
      await postPlainText(targetUrl, "/command", command, 1800);
      return "direct-base";
    } catch {
      // Fall back to the server path if the direct base-station path is unavailable.
    }
  }

  if (tryServerSocket?.(command)) {
    return directToBase ? "server-fallback" : "server-live";
  }

  await postText(serverUrl, "/command", command);
  return directToBase ? "server-fallback" : "server-only";
}

async function sendDriveCommand(
  serverUrl: string,
  targetUrl: string,
  directToBase: boolean,
  drive: number,
  turn: number,
  driveSequenceRef: React.MutableRefObject<number>,
  lastSentRef: React.MutableRefObject<{ drive: number; turn: number }>,
  lastSentAtRef: React.MutableRefObject<number>,
  onTransportMode?: (mode: ManualTransportMode) => void,
  tryServerSocket?: (command: string) => boolean,
  options?: { force?: boolean },
) {
  const force = options?.force === true;
  if (!force && lastSentRef.current.drive === drive && lastSentRef.current.turn === turn) {
    return;
  }

  const now = Date.now();
  const isStop = (drive === 0 && turn === 0);
  if (!isStop && (now - lastSentAtRef.current) < JOYSTICK_SEND_MIN_INTERVAL_MS) {
    return;
  }

  lastSentRef.current = { drive, turn };
  lastSentAtRef.current = now;
  driveSequenceRef.current += 1;
  const seq = driveSequenceRef.current;
  const directCommand = buildCompactManualPacket(seq, drive, turn);
  const fallbackCommand = `D:${drive},${turn},S:${seq}`;

  try {
    if (directToBase) {
      try {
        await postPlainText(targetUrl, "/command", directCommand, 1800);
        onTransportMode?.("direct-base");
      } catch {
        const transport = await postManualCommand(serverUrl, targetUrl, fallbackCommand, directToBase, tryServerSocket);
        onTransportMode?.(transport);
      }
    } else {
      const transport = await postManualCommand(serverUrl, targetUrl, fallbackCommand, directToBase, tryServerSocket);
      onTransportMode?.(transport);
    }
  } catch {
    // Keep it simple; error handling is handled by the screen.
  }
}

type JoystickControlProps = {
  visible: boolean;
  serverUrl: string;
  manualTargetUrl?: string | null;
  radioMode?: string | null;
  missionStateLabel: string;
  robotOperationalState: string;
  lastCmd: string | null;
  onClose: () => Promise<void> | void;
  joystickState: JoystickState;
  setJoystickState: (state: JoystickState) => void;
  onPerformCommand: (command: string) => Promise<boolean>;
  pendingAction: string | null;
};

const QUICK_DRIVE_COMMANDS: Record<string, { drive: number; turn: number } | null> = {
  FORWARD: { drive: 100, turn: 0 },
  BACKWARD: { drive: -100, turn: 0 },
  LEFT: { drive: 0, turn: -100 },
  RIGHT: { drive: 0, turn: 100 },
  STOP: null,
};

export function JoystickControl({
  visible,
  serverUrl,
  manualTargetUrl,
  radioMode,
  missionStateLabel,
  robotOperationalState,
  lastCmd,
  onClose,
  joystickState,
  setJoystickState,
  onPerformCommand,
  pendingAction,
}: JoystickControlProps) {
  const emptyJoystickState: JoystickState = { x: 0, y: 0, drive: 0, turn: 0, active: false };
  const [pressedManualButton, setPressedManualButton] = useState<string | null>(null);
  const resolvedManualUrl = (manualTargetUrl ?? serverUrl).trim();
  const useDirectBasePath = Boolean(manualTargetUrl && manualTargetUrl.trim() && manualTargetUrl.trim() !== serverUrl.trim());
  const [manualTransportMode, setManualTransportMode] = useState<ManualTransportMode>(
    useDirectBasePath ? "direct-base" : "server-only",
  );
  const driveSequenceRef = useRef(0);
  const lastJoystickSent = useRef({ drive: 0, turn: 0 });
  const lastJoystickSentAt = useRef(0);
  const serverSocketRef = useRef<WebSocket | null>(null);
  const joystickActiveRef = useRef(false);
  const joystickCurrentRef = useRef({ drive: 0, turn: 0 });
  const joystickHoldTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heldCommandRef = useRef<string | null>(null);
  const heldCommandTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const padRef = useRef<View | null>(null);
  const padLayout = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const clearHeldCommandLoop = () => {
    heldCommandRef.current = null;
    if (heldCommandTimerRef.current) {
      clearInterval(heldCommandTimerRef.current);
      heldCommandTimerRef.current = null;
    }
  };

  const clearJoystickHoldLoop = () => {
    joystickActiveRef.current = false;
    joystickCurrentRef.current = { drive: 0, turn: 0 };
    if (joystickHoldTimerRef.current) {
      clearInterval(joystickHoldTimerRef.current);
      joystickHoldTimerRef.current = null;
    }
  };

  const ensureJoystickHoldLoop = () => {
    if (joystickHoldTimerRef.current) return;
    joystickHoldTimerRef.current = setInterval(() => {
      if (!joystickActiveRef.current) return;
      const { drive, turn } = joystickCurrentRef.current;
      if (drive === 0 && turn === 0) return;
      void sendDriveCommand(serverUrl, resolvedManualUrl, useDirectBasePath, drive, turn, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode, tryServerSocketCommand, { force: true });
    }, JOYSTICK_HOLD_REPEAT_MS);
  };

  const tryServerSocketCommand = (command: string) => {
    const socket = serverSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    if (command.startsWith("D:")) {
      const match = command.match(/^D:([-+]?\d+),([-+]?\d+)(?:,S:(\d+))?$/);
      if (!match) {
        return false;
      }

      socket.send(JSON.stringify({
        event: "manual.drive",
        payload: {
          drive: Number(match[1]),
          turn: Number(match[2]),
          seq: match[3] ? Number(match[3]) : null,
        },
      }));
      return true;
    }

    socket.send(JSON.stringify({
      event: "manual.command",
      payload: { command },
    }));
    return true;
  };

  const sendStopBurst = async () => {
    for (let i = 0; i < STOP_BURST_COUNT; i += 1) {
      try {
        const transport = await postManualCommand(serverUrl, resolvedManualUrl, "STOP", useDirectBasePath);
        setManualTransportMode(transport);
      } catch {
        // Keep trying burst sends to maximize release reliability.
      }
      if (i + 1 < STOP_BURST_COUNT) {
        await new Promise((resolve) => setTimeout(resolve, STOP_BURST_GAP_MS));
      }
    }
  };

  const measurePad = () => {
    const node = padRef.current;
    if (!node || !node.measure) {
      return;
    }
    node.measure((fx, fy, width, height, px, py) => {
      padLayout.current = { x: px, y: py, width, height };
    });
  };

  const getTouchLocation = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;

    let normalizedX = locationX;
    let normalizedY = locationY;

    if (padLayout.current) {
      normalizedX = pageX - padLayout.current.x;
      normalizedY = pageY - padLayout.current.y;
    }

    const boundedX = clamp(normalizedX, 0, JOYSTICK_PAD_SIZE);
    const boundedY = clamp(normalizedY, 0, JOYSTICK_PAD_SIZE);
    return { locationX: boundedX, locationY: boundedY };
  };

  useEffect(() => {
    return () => {
      clearJoystickHoldLoop();
      clearHeldCommandLoop();
      sendDriveCommand(serverUrl, resolvedManualUrl, useDirectBasePath, 0, 0, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode, tryServerSocketCommand);
      void sendStopBurst();
    };
  }, [serverUrl, resolvedManualUrl, useDirectBasePath]);

  useEffect(() => {
    if (!visible || useDirectBasePath) {
      if (serverSocketRef.current) {
        serverSocketRef.current.close();
        serverSocketRef.current = null;
      }
      return;
    }

    const socket = new WebSocket(toWebSocketUrl(serverUrl));
    serverSocketRef.current = socket;

    socket.onopen = () => {
      setManualTransportMode("server-live");
    };

    socket.onclose = () => {
      if (serverSocketRef.current === socket) {
        serverSocketRef.current = null;
      }
    };

    socket.onerror = () => {
      if (serverSocketRef.current === socket) {
        setManualTransportMode("server-only");
      }
    };

    return () => {
      if (serverSocketRef.current === socket) {
        serverSocketRef.current = null;
      }
      socket.close();
    };
  }, [visible, serverUrl, useDirectBasePath]);

  const updateJoystickFromTouch = async (event: GestureResponderEvent) => {
    const { locationX, locationY } = getTouchLocation(event);
    const next = computeJoystickValues(locationX, locationY);
    const active = next.drive !== 0 || next.turn !== 0;
    const nextState = { x: next.x, y: next.y, drive: next.drive, turn: next.turn, active };

    joystickActiveRef.current = active;
    joystickCurrentRef.current = { drive: next.drive, turn: next.turn };
    ensureJoystickHoldLoop();

    setJoystickState(nextState);
    sendDriveCommand(serverUrl, resolvedManualUrl, useDirectBasePath, next.drive, next.turn, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode, tryServerSocketCommand);
  };

  const resetJoystick = () => {
    clearJoystickHoldLoop();
    setJoystickState(emptyJoystickState);
    sendDriveCommand(serverUrl, resolvedManualUrl, useDirectBasePath, 0, 0, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode, tryServerSocketCommand);
  };

  const joystickResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (event) => {
          void updateJoystickFromTouch(event);
        },
        onPanResponderMove: (event) => {
          void updateJoystickFromTouch(event);
        },
        onPanResponderRelease: () => {
          resetJoystick();
        },
        onPanResponderTerminate: () => {
          resetJoystick();
        },
      }),
    [resolvedManualUrl, useDirectBasePath],
  );

  const beginHeldManualCommand = async (command: string) => {
    if (pressedManualButton === command || pendingAction) {
      return;
    }

    clearHeldCommandLoop();
    setPressedManualButton(command);
    const normalized = command.toUpperCase();
    heldCommandRef.current = normalized;
    const quickDrive = QUICK_DRIVE_COMMANDS[normalized];

    if (quickDrive) {
      joystickActiveRef.current = true;
      joystickCurrentRef.current = quickDrive;
      ensureJoystickHoldLoop();
      void sendDriveCommand(
        serverUrl,
        resolvedManualUrl,
        useDirectBasePath,
        quickDrive.drive,
        quickDrive.turn,
        driveSequenceRef,
        lastJoystickSent,
        lastJoystickSentAt,
        setManualTransportMode,
        tryServerSocketCommand,
        { force: true },
      );
      return;
    }

    try {
      const transport = await postManualCommand(serverUrl, resolvedManualUrl, normalized, useDirectBasePath, tryServerSocketCommand);
      setManualTransportMode(transport);
    } catch {
      // Repeat loop keeps command alive while held.
    }

    heldCommandTimerRef.current = setInterval(() => {
      if (heldCommandRef.current !== normalized) {
        return;
      }
      void postManualCommand(serverUrl, resolvedManualUrl, normalized, useDirectBasePath, tryServerSocketCommand).then((transport) => {
        setManualTransportMode(transport);
      }).catch(() => {
        // Ignore transient send failures while button is held.
      });
    }, HELD_COMMAND_REPEAT_MS);
  };

  const releaseHeldManualCommand = async () => {
    clearHeldCommandLoop();
    setPressedManualButton(null);
    await sendStopBurst();
  };

  const handleClose = async () => {
    clearHeldCommandLoop();
    resetJoystick();
    setPressedManualButton(null);
    await sendStopBurst();
    await Promise.resolve(onClose());
  };

  const manualTransportLabel =
    manualTransportMode === "direct-base"
      ? "Direct base link"
      : (manualTransportMode === "server-fallback"
        ? "Server fallback"
        : (manualTransportMode === "server-live" ? "Server live" : "Server path"));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>Manual / Joystick Control</Text>
              <Text style={styles.modalSubtitle}>
                Use the thumb pad for finer low-speed control. Exit Manual returns to telemetry/test mode.
              </Text>
            </View>
            <Pressable style={styles.modalCloseButton} onPress={handleClose}>
              <Text style={styles.modalCloseButtonText}>Exit Manual</Text>
            </Pressable>
          </View>

          <Text style={styles.modalStatusText}>
            Mission {missionStateLabel} | Robot {robotOperationalState} | Cmd {lastCmd ?? "--"}
          </Text>
          <Text style={styles.modalStatusText}>
            Radio {radioMode ?? "--"} | Manual path {manualTransportLabel}
          </Text>
          <Text style={styles.manualHintText}>
            Slide from center for smoother steering and slower corrections; release anywhere to stop.
          </Text>

          <View style={styles.manualDrivePanel}>
            <Text style={styles.manualMiniLabel}>Thumb pad</Text>
            <View
              ref={padRef}
              onLayout={measurePad}
              style={styles.joystickPad}
              {...joystickResponder.panHandlers}
            >
              <View style={styles.joystickAxisHorizontal} />
              <View style={styles.joystickAxisVertical} />
              <View
                style={[
                  styles.joystickKnob,
                  { transform: [{ translateX: joystickState.x }, { translateY: joystickState.y }] },
                ]}
              />
            </View>
            <Text style={[styles.joystickReadout, joystickState.active ? styles.joystickReadoutActive : null]}>
              Drive {joystickState.drive}% • Turn {joystickState.turn}%
            </Text>
            <View style={styles.joystickDebugCard}>
              <Text style={styles.joystickDebugText}>
                Pos x:{joystickState.x.toFixed(1)} y:{joystickState.y.toFixed(1)} | active:{joystickState.active ? 1 : 0}
              </Text>
              <Text style={styles.joystickDebugText}>
                Cmd preview D:{joystickState.drive},{joystickState.turn},S:{driveSequenceRef.current + 1}
              </Text>
              <Text style={styles.joystickDebugText}>
                Dead-zone {(JOYSTICK_DEAD_ZONE * 100).toFixed(0)}% | Path {manualTransportMode}
              </Text>
            </View>
          </View>

          <View style={styles.dpad}>
            <Text style={styles.manualMiniLabel}>Quick buttons</Text>
            <Pressable
              style={[styles.commandButton, pressedManualButton === "FORWARD" ? styles.commandButtonActive : null]}
              onPressIn={() => {
                void beginHeldManualCommand("FORWARD");
              }}
              onPressOut={() => {
                void releaseHeldManualCommand();
              }}
            >
              <Text style={[styles.commandText, pressedManualButton === "FORWARD" ? styles.commandTextActive : null]}>
                {pressedManualButton === "FORWARD" || pendingAction === "FORWARD" ? "FWD..." : "FWD"}
              </Text>
            </Pressable>
            <View style={styles.row}>
              <Pressable
                style={[styles.commandButton, pressedManualButton === "LEFT" ? styles.commandButtonActive : null]}
                onPressIn={() => {
                  void beginHeldManualCommand("LEFT");
                }}
                onPressOut={() => {
                  void releaseHeldManualCommand();
                }}
              >
                <Text style={[styles.commandText, pressedManualButton === "LEFT" ? styles.commandTextActive : null]}>
                  {pressedManualButton === "LEFT" || pendingAction === "LEFT" ? "TURN L..." : "TURN L"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.commandButton, styles.stopButton, pressedManualButton === "STOP" ? styles.stopButtonActive : null]}
                onPressIn={() => setPressedManualButton("STOP")}
                onPressOut={() => setPressedManualButton(null)}
                onPress={() => {
                  void releaseHeldManualCommand();
                }}
              >
                <Text style={[styles.commandText, pressedManualButton === "STOP" ? styles.commandTextActive : null]}>
                  {pressedManualButton === "STOP" || pendingAction === "STOP" ? "STOP..." : "STOP"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.commandButton, pressedManualButton === "RIGHT" ? styles.commandButtonActive : null]}
                onPressIn={() => {
                  void beginHeldManualCommand("RIGHT");
                }}
                onPressOut={() => {
                  void releaseHeldManualCommand();
                }}
              >
                <Text style={[styles.commandText, pressedManualButton === "RIGHT" ? styles.commandTextActive : null]}>
                  {pressedManualButton === "RIGHT" || pendingAction === "RIGHT" ? "TURN R..." : "TURN R"}
                </Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.commandButton, pressedManualButton === "BACKWARD" ? styles.commandButtonActive : null]}
              onPressIn={() => {
                void beginHeldManualCommand("BACKWARD");
              }}
              onPressOut={() => {
                void releaseHeldManualCommand();
              }}
            >
              <Text style={[styles.commandText, pressedManualButton === "BACKWARD" ? styles.commandTextActive : null]}>
                {pressedManualButton === "BACKWARD" || pendingAction === "BACKWARD" ? "REV..." : "REV"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  joystickDebugCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#f3f7fc",
    borderColor: "#d6e2ef",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  joystickDebugText: {
    fontSize: 11,
    color: "#35506b",
    fontWeight: "600",
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
});

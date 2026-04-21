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
import { postGatewayPlainText, postGatewayText } from "../../lib/serverApi";

// Manual-drive control surface for the gateway path. This file turns touch
// gestures into repeated drive vectors and quick directional commands while
// trying to stay robust on mobile networks.

export type JoystickState = {
  x: number;
  y: number;
  drive: number;
  turn: number;
  active: boolean;
};

type ManualTransportMode = "direct-gateway";

export const JOYSTICK_PAD_SIZE = 172;
export const JOYSTICK_KNOB_SIZE = 64;
export const JOYSTICK_TRAVEL_RADIUS = (JOYSTICK_PAD_SIZE - JOYSTICK_KNOB_SIZE) / 2;
export const JOYSTICK_DEAD_ZONE = 0.06;
const JOYSTICK_MAX_OUTPUT_PERCENT = 100;
const JOYSTICK_SEND_MIN_INTERVAL_MS = 40;
const JOYSTICK_HOLD_REPEAT_MS = 45;
const HELD_COMMAND_REPEAT_MS = 150;
const STOP_BURST_COUNT = 2;
const STOP_BURST_GAP_MS = 45;
const QUICK_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const QUICK_BUTTON_PRESS_RETENTION = { top: 28, bottom: 28, left: 28, right: 28 };
const JOYSTICK_TOUCH_Y_OFFSET = -22;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeToPercent(value: number): number {
  return Math.round(clamp(value, -100, 100));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeJoystickValues(locationX: number, locationY: number) {
  const rawX = locationX - JOYSTICK_PAD_SIZE / 2;
  const rawY = locationY - JOYSTICK_PAD_SIZE / 2;
  const distance = Math.hypot(rawX, rawY);
  const scale = distance > JOYSTICK_TRAVEL_RADIUS ? JOYSTICK_TRAVEL_RADIUS / distance : 1;
  const x = rawX * scale;
  const y = rawY * scale;

  const rawTurn = normalizeToPercent((x / JOYSTICK_TRAVEL_RADIUS) * JOYSTICK_MAX_OUTPUT_PERCENT);
  const rawDrive = normalizeToPercent((-y / JOYSTICK_TRAVEL_RADIUS) * JOYSTICK_MAX_OUTPUT_PERCENT);

  // Small thumb jitter around center should still count as neutral.
  const turn = Math.abs(rawTurn) <= JOYSTICK_DEAD_ZONE * 100 ? 0 : rawTurn;
  const drive = Math.abs(rawDrive) <= JOYSTICK_DEAD_ZONE * 100 ? 0 : rawDrive;

  return { x, y, turn, drive };
}

function mapJoystickToManualCommand(drive: number, turn: number): string {
  if (drive === 0 && turn === 0) {
    return "STOP";
  }

  if (Math.abs(drive) >= Math.abs(turn)) {
    return drive > 0 ? "FORWARD" : "BACKWARD";
  }

  return turn < 0 ? "LEFT" : "RIGHT";
}

function buildDriveWireCommand(drive: number, turn: number, sequence: number): string {
  return `D:${normalizeToPercent(drive)},${normalizeToPercent(turn)},S:${sequence}`;
}

async function postManualCommand(
  targetUrl: string,
  command: string,
): Promise<ManualTransportMode> {
  await postGatewayText(targetUrl, "/command", command);
  return "direct-gateway";
}

async function sendDriveCommand(
  targetUrl: string,
  drive: number,
  turn: number,
  driveSequenceRef: React.MutableRefObject<number>,
  lastSentRef: React.MutableRefObject<string>,
  lastSentAtRef: React.MutableRefObject<number>,
  onTransportMode?: (mode: ManualTransportMode) => void,
  options?: { force?: boolean },
) {
  const force = options?.force === true;
  const vectorKey = `${drive},${turn}`;
  if (!force && lastSentRef.current === vectorKey) {
    return;
  }

  const now = Date.now();
  const isStop = (drive === 0 && turn === 0);
  // Motion vectors are rate-limited, but stop is allowed through immediately.
  if (!isStop && (now - lastSentAtRef.current) < JOYSTICK_SEND_MIN_INTERVAL_MS) {
    return;
  }

  const nextSequence = driveSequenceRef.current + 1;
  const command = buildDriveWireCommand(drive, turn, nextSequence);

  lastSentRef.current = vectorKey;
  lastSentAtRef.current = now;
  driveSequenceRef.current = nextSequence;

  try {
    await postGatewayPlainText(targetUrl, "/command", command, 1800);
    onTransportMode?.("direct-gateway");
  } catch {
    // Keep it simple; error handling is handled by the screen.
  }
}

type JoystickControlProps = {
  visible: boolean;
  serverUrl: string;
  manualTargetUrl?: string | null;
  missionStateLabel: string;
  robotOperationalState: string;
  lastCmd: string | null;
  onClose: () => Promise<void> | void;
  joystickState: JoystickState;
  setJoystickState: (state: JoystickState) => void;
  onPerformCommand: (command: string) => Promise<boolean>;
  pendingAction: string | null;
  saltPct: number;
  brinePct: number;
};

const QUICK_DIRECTION_COMMANDS = new Set(["FORWARD", "BACKWARD", "LEFT", "RIGHT"]);

export function JoystickControl({
  visible,
  serverUrl,
  manualTargetUrl,
  missionStateLabel,
  robotOperationalState,
  lastCmd,
  onClose,
  joystickState,
  setJoystickState,
  onPerformCommand,
  pendingAction,
  saltPct,
  brinePct,
}: JoystickControlProps) {
  const emptyJoystickState: JoystickState = { x: 0, y: 0, drive: 0, turn: 0, active: false };
  const [pressedManualButton, setPressedManualButton] = useState<string | null>(null);
  const resolvedManualUrl = (manualTargetUrl ?? "").trim();
  const gatewayManualReady = resolvedManualUrl.length > 0;
  const [manualTransportMode, setManualTransportMode] = useState<ManualTransportMode>("direct-gateway");
  const [manualSaltOn, setManualSaltOn] = useState(false);
  const [manualBrineOn, setManualBrineOn] = useState(false);
  const driveSequenceRef = useRef(0);
  const lastJoystickSent = useRef("0,0");
  const lastJoystickSentAt = useRef(0);
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
      if (!gatewayManualReady) return;
      if (!joystickActiveRef.current) return;
      const { drive, turn } = joystickCurrentRef.current;
      if (drive === 0 && turn === 0) return;
      // Re-send while held so the gateway keeps receiving fresh motion intents.
      void sendDriveCommand(resolvedManualUrl, drive, turn, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode, { force: true });
    }, JOYSTICK_HOLD_REPEAT_MS);
  };

  const sendStopBurst = async () => {
    if (!gatewayManualReady) return;
    // Stop is sent as a short burst because release reliability matters more
    // than command economy when the operator lifts their thumb.
    for (let i = 0; i < STOP_BURST_COUNT; i += 1) {
      try {
        const transport = await postManualCommand(resolvedManualUrl, "STOP");
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
    if (!node || !node.measureInWindow) {
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      padLayout.current = { x, y, width, height };
    });
  };

  const getTouchLocation = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;

    let normalizedX = locationX;
    let normalizedY = locationY;

    if (padLayout.current) {
      normalizedX = pageX - padLayout.current.x;
      normalizedY = pageY - padLayout.current.y + JOYSTICK_TOUCH_Y_OFFSET;
    }

    const boundedX = clamp(normalizedX, 0, JOYSTICK_PAD_SIZE);
    const boundedY = clamp(normalizedY, 0, JOYSTICK_PAD_SIZE);
    return { locationX: boundedX, locationY: boundedY };
  };

  const setManualSaltOutput = async (enabled: boolean) => {
    const pct = enabled ? clampPercent(saltPct) : 0;
    const ok = await onPerformCommand(`TEST SALT ${pct}`);
    if (ok) {
      setManualSaltOn(enabled && pct > 0);
    }
    return ok;
  };

  const setManualBrineOutput = async (enabled: boolean) => {
    const pct = enabled ? clampPercent(brinePct) : 0;
    const ok = await onPerformCommand(`TEST BRINE ${pct}`);
    if (ok) {
      setManualBrineOn(enabled && pct > 0);
    }
    return ok;
  };

  useEffect(() => {
    return () => {
      clearJoystickHoldLoop();
      clearHeldCommandLoop();
      if (gatewayManualReady) {
        void sendDriveCommand(resolvedManualUrl, 0, 0, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode);
      }
      void sendStopBurst();
    };
  }, [gatewayManualReady, resolvedManualUrl]);

  useEffect(() => {
    if (!visible) {
      setManualSaltOn(false);
      setManualBrineOn(false);
    }
  }, [visible]);

  const updateJoystickFromTouch = async (event: GestureResponderEvent) => {
    if (!gatewayManualReady) return;
    const { locationX, locationY } = getTouchLocation(event);
    const next = computeJoystickValues(locationX, locationY);
    const active = next.drive !== 0 || next.turn !== 0;
    const nextState = { x: next.x, y: next.y, drive: next.drive, turn: next.turn, active };

    joystickActiveRef.current = active;
    joystickCurrentRef.current = { drive: next.drive, turn: next.turn };
    ensureJoystickHoldLoop();

    setJoystickState(nextState);
    void sendDriveCommand(resolvedManualUrl, next.drive, next.turn, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode);
  };

  const resetJoystick = async () => {
    clearJoystickHoldLoop();
    setJoystickState(emptyJoystickState);
    lastJoystickSent.current = "0,0";
    lastJoystickSentAt.current = 0;
    if (gatewayManualReady) {
      await sendDriveCommand(resolvedManualUrl, 0, 0, driveSequenceRef, lastJoystickSent, lastJoystickSentAt, setManualTransportMode, { force: true },);
      await sendStopBurst();
    }
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
          void resetJoystick();
        },
        onPanResponderTerminate: () => {
          void resetJoystick();
        },
      }),
    [gatewayManualReady, resolvedManualUrl],
  );

  const beginHeldManualCommand = async (command: string) => {
    if (pressedManualButton === command || pendingAction) {
      return;
    }

    clearHeldCommandLoop();
    clearJoystickHoldLoop();
    setPressedManualButton(command);
    const normalized = command.toUpperCase();
    heldCommandRef.current = normalized;
    setJoystickState(emptyJoystickState);

    try {
      const transport = await postManualCommand(resolvedManualUrl, normalized);
      setManualTransportMode(transport);
    } catch {
      // Repeat loop keeps command alive while held.
    }

    heldCommandTimerRef.current = setInterval(() => {
      if (heldCommandRef.current !== normalized) {
        return;
      }
      void postManualCommand(resolvedManualUrl, normalized).then((transport) => {
        setManualTransportMode(transport);
      }).catch(() => {
        // Ignore transient send failures while button is held.
      });
    }, HELD_COMMAND_REPEAT_MS);
  };

  const releaseHeldManualCommand = async (options?: { burstStop?: boolean }) => {
    const releasedCommand = heldCommandRef.current;
    clearHeldCommandLoop();
    clearJoystickHoldLoop();
    setPressedManualButton(null);
    setJoystickState(emptyJoystickState);
    lastJoystickSent.current = "0,0";
    lastJoystickSentAt.current = 0;
    if (releasedCommand && QUICK_DIRECTION_COMMANDS.has(releasedCommand)) {
      const transport = await postManualCommand(resolvedManualUrl, "STOP");
      setManualTransportMode(transport);
    } else {
      await sendDriveCommand(
        resolvedManualUrl,
        0,
        0,
        driveSequenceRef,
        lastJoystickSent,
        lastJoystickSentAt,
        setManualTransportMode,
        { force: true },
      );
    }
    if (options?.burstStop) {
      await sendStopBurst();
    }
  };

  const handleClose = async () => {
    clearHeldCommandLoop();
    await resetJoystick();
    setPressedManualButton(null);
    await onPerformCommand("TEST SALT 0");
    await onPerformCommand("TEST BRINE 0");
    setManualSaltOn(false);
    setManualBrineOn(false);
    await sendStopBurst();
    await Promise.resolve(onClose());
  };

  const manualTransportLabel =
    manualTransportMode === "direct-gateway"
      ? "Direct gateway link"
      : (manualTransportMode === "server-live" ? "Server live" : "Server path");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>Manual / Joystick Control</Text>
              <Text style={styles.modalSubtitle}>
                Use thumb pad for control
              </Text>
            </View>
            <Pressable style={styles.modalCloseButton} onPress={handleClose}>
              <Text style={styles.modalCloseButtonText}>Exit Manual</Text>
            </Pressable>
          </View>

          <Text style={styles.modalStatusText}>
            Mission {missionStateLabel} | Robot {robotOperationalState} | Cmd {lastCmd ?? "--"}
          </Text>
          <Text style={styles.manualHintText}>
            Slide to steer • Release to stop
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
                Cmd preview {buildDriveWireCommand(joystickState.drive, joystickState.turn, driveSequenceRef.current + 1)}
              </Text>
              <Text style={styles.joystickDebugText}>
                Dead-zone {(JOYSTICK_DEAD_ZONE * 100).toFixed(0)}% | Max {JOYSTICK_MAX_OUTPUT_PERCENT}% | Path {manualTransportMode}
              </Text>
            </View>
          </View>

          <View style={styles.dpad}>
            <Text style={styles.manualMiniLabel}>Quick buttons</Text>
            <Pressable
              style={[styles.commandButton, pressedManualButton === "FORWARD" ? styles.commandButtonActive : null]}
              hitSlop={QUICK_BUTTON_HIT_SLOP}
              pressRetentionOffset={QUICK_BUTTON_PRESS_RETENTION}
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
                hitSlop={QUICK_BUTTON_HIT_SLOP}
                pressRetentionOffset={QUICK_BUTTON_PRESS_RETENTION}
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
                hitSlop={QUICK_BUTTON_HIT_SLOP}
                pressRetentionOffset={QUICK_BUTTON_PRESS_RETENTION}
                onPressIn={() => {
                  setPressedManualButton("STOP");
                  void releaseHeldManualCommand({ burstStop: true });
                }}
                onPressOut={() => setPressedManualButton(null)}
              >
                <Text style={[styles.commandText, pressedManualButton === "STOP" ? styles.commandTextActive : null]}>
                  {pressedManualButton === "STOP" || pendingAction === "STOP" ? "STOP..." : "STOP"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.commandButton, pressedManualButton === "RIGHT" ? styles.commandButtonActive : null]}
                hitSlop={QUICK_BUTTON_HIT_SLOP}
                pressRetentionOffset={QUICK_BUTTON_PRESS_RETENTION}
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
              hitSlop={QUICK_BUTTON_HIT_SLOP}
              pressRetentionOffset={QUICK_BUTTON_PRESS_RETENTION}
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

          <View style={styles.materialPanel}>
            <Text style={styles.manualMiniLabel}>Material controls</Text>
            <View style={styles.materialRow}>
              <View style={styles.materialCard}>
                <View style={styles.materialHeaderRow}>
                  <Text style={styles.materialTitle}>Salt {clampPercent(saltPct)}%</Text>
                  <Text style={styles.materialStatus}>{manualSaltOn ? "ON" : "OFF"}</Text>
                </View>
                <View style={styles.materialButtonRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.materialButton,
                      styles.materialButtonOn,
                      manualSaltOn ? styles.materialButtonOnActive : null,
                      pressed ? styles.materialButtonPressed : null,
                    ]}
                    onPress={() => {
                      void setManualSaltOutput(true);
                    }}
                  >
                    <Text style={styles.materialButtonText}>ON</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.materialButton,
                      styles.materialButtonOff,
                      !manualSaltOn ? styles.materialButtonOffActive : null,
                      pressed ? styles.materialButtonPressed : null,
                    ]}
                    onPress={() => {
                      void setManualSaltOutput(false);
                    }}
                  >
                    <Text style={styles.materialButtonText}>OFF</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.materialCard}>
                <View style={styles.materialHeaderRow}>
                  <Text style={styles.materialTitle}>Brine {clampPercent(brinePct)}%</Text>
                  <Text style={styles.materialStatus}>{manualBrineOn ? "ON" : "OFF"}</Text>
                </View>
                <View style={styles.materialButtonRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.materialButton,
                      styles.materialButtonOn,
                      manualBrineOn ? styles.materialButtonOnActive : null,
                      pressed ? styles.materialButtonPressed : null,
                    ]}
                    onPress={() => {
                      void setManualBrineOutput(true);
                    }}
                  >
                    <Text style={styles.materialButtonText}>ON</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.materialButton,
                      styles.materialButtonOff,
                      !manualBrineOn ? styles.materialButtonOffActive : null,
                      pressed ? styles.materialButtonPressed : null,
                    ]}
                    onPress={() => {
                      void setManualBrineOutput(false);
                    }}
                  >
                    <Text style={styles.materialButtonText}>OFF</Text>
                  </Pressable>
                </View>
              </View>
            </View>
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
    padding: 16,
    gap: 10,
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
    fontSize: 20,
    fontWeight: "800",
    color: "#13233a",
  },
  modalSubtitle: {
    fontSize: 12,
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
    fontSize: 11,
    lineHeight: 15,
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
  materialPanel: {
    gap: 8,
  },
  materialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  materialCard: {
    flex: 1,
    minWidth: 150,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6e2ef",
    backgroundColor: "#f3f7fc",
    padding: 10,
    gap: 6,
  },
  materialHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  materialTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#16324f",
  },
  materialStatus: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4f6275",
  },
  materialButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  materialButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  materialButtonOn: {
    backgroundColor: "#2c6fb7",
  },
  materialButtonOff: {
    backgroundColor: "#7c8794",
  },
  materialButtonOnActive: {
    backgroundColor: "#1f5a97",
  },
  materialButtonOffActive: {
    backgroundColor: "#5d6772",
  },
  materialButtonPressed: {
    transform: [{ scale: 0.97 }],
    shadowColor: "#14324f",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  materialButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
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

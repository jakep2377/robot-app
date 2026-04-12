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
import { postText } from "../../lib/serverApi";

export type JoystickState = {
  x: number;
  y: number;
  drive: number;
  turn: number;
  active: boolean;
};

export const JOYSTICK_PAD_SIZE = 172;
export const JOYSTICK_KNOB_SIZE = 64;
export const JOYSTICK_TRAVEL_RADIUS = (JOYSTICK_PAD_SIZE - JOYSTICK_KNOB_SIZE) / 2;
export const JOYSTICK_DEAD_ZONE = 0.12;
const JOYSTICK_SEND_MIN_INTERVAL_MS = 40;

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

async function sendDriveCommand(
  serverUrl: string,
  drive: number,
  turn: number,
  lastSentRef: React.MutableRefObject<{ drive: number; turn: number }>,
  lastSentAtRef: React.MutableRefObject<number>,
) {
  if (lastSentRef.current.drive === drive && lastSentRef.current.turn === turn) {
    return;
  }

  const now = Date.now();
  const isStop = (drive === 0 && turn === 0);
  if (!isStop && (now - lastSentAtRef.current) < JOYSTICK_SEND_MIN_INTERVAL_MS) {
    return;
  }

  lastSentRef.current = { drive, turn };
  lastSentAtRef.current = now;

  try {
    await postText(serverUrl, "/command", `DRIVE,THROTTLE:${drive},TURN:${turn}`);
  } catch {
    // Keep it simple; error handling is handled by the screen.
  }
}

type JoystickControlProps = {
  visible: boolean;
  serverUrl: string;
  missionStateLabel: string;
  robotOperationalState: string;
  lastCmd: string | null;
  onClose: () => void;
  joystickState: JoystickState;
  setJoystickState: (state: JoystickState) => void;
  onPerformCommand: (command: string) => Promise<void>;
  pendingAction: string | null;
};

export function JoystickControl({
  visible,
  serverUrl,
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
  const lastJoystickSent = useRef({ drive: 0, turn: 0 });
  const lastJoystickSentAt = useRef(0);
  const padRef = useRef<View | null>(null);
  const padLayout = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

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
    const { pageX, pageY, locationX, locationY } = event.nativeEvent;
    if (padLayout.current && typeof pageX === "number" && typeof pageY === "number") {
      return {
        locationX: pageX - padLayout.current.x,
        locationY: pageY - padLayout.current.y,
      };
    }
    return { locationX, locationY };
  };

  useEffect(() => {
    return () => {
      sendDriveCommand(serverUrl, 0, 0, lastJoystickSent, lastJoystickSentAt);
    };
  }, [serverUrl]);

  const updateJoystickFromTouch = async (event: GestureResponderEvent) => {
    const { locationX, locationY } = getTouchLocation(event);
    const next = computeJoystickValues(locationX, locationY);
    const active = next.drive !== 0 || next.turn !== 0;
    const nextState = { x: next.x, y: next.y, drive: next.drive, turn: next.turn, active };

    setJoystickState(nextState);
    sendDriveCommand(serverUrl, next.drive, next.turn, lastJoystickSent, lastJoystickSentAt);
  };

  const resetJoystick = () => {
    setJoystickState(emptyJoystickState);
    sendDriveCommand(serverUrl, 0, 0, lastJoystickSent, lastJoystickSentAt);
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
    [serverUrl],
  );

  const beginHeldManualCommand = async (command: string) => {
    if (pressedManualButton === command || pendingAction) {
      return;
    }

    setPressedManualButton(command);
    await postText(serverUrl, "/command", command.toUpperCase());
  };

  const releaseHeldManualCommand = async () => {
    setPressedManualButton(null);
    if (pendingAction) {
      return;
    }
    await postText(serverUrl, "/command", "STOP");
  };

  const handleClose = async () => {
    resetJoystick();
    setPressedManualButton(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>Manual / Joystick Control</Text>
              <Text style={styles.modalSubtitle}>
                Use the thumb pad for finer low-speed control, or hold the buttons for fixed moves.
              </Text>
            </View>
            <Pressable style={styles.modalCloseButton} onPress={handleClose}>
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.modalStatusText}>
            Mission {missionStateLabel} | Robot {robotOperationalState} | Cmd {lastCmd ?? "--"}
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
                onPress={() => onPerformCommand("STOP")}
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

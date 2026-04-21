import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppButton from "./AppButton";

// Reusable confirmation/alert modal with a small opinionated tone system so
// destructive, warning, and success states all read consistently in the app.

type Variant = "primary" | "secondary" | "outline" | "danger" | "success";
type Tone = "info" | "success" | "warning" | "danger";

type Action = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
};

type Props = {
  visible: boolean;
  title: string;
  message: string;
  tone?: Tone;
  primaryAction?: Action | null;
  secondaryAction?: Action | null;
  onClose: () => void;
};

const toneConfig: Record<Tone, { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; iconBg: string; iconColor: string }> = {
  info: { icon: "information-outline", iconBg: "#eaf2fb", iconColor: "#1f5f9f" },
  success: { icon: "check-circle-outline", iconBg: "#e7f6ef", iconColor: "#2d8a65" },
  warning: { icon: "alert-outline", iconBg: "#fff4e4", iconColor: "#bf7a16" },
  danger: { icon: "alert-circle-outline", iconBg: "#fdecec", iconColor: "#b63d3d" },
};

export default function AppNoticeModal({
  visible,
  title,
  message,
  tone = "info",
  primaryAction,
  secondaryAction,
  onClose,
}: Props) {
  const config = toneConfig[tone];

  const runAction = (action?: Action | null) => {
    onClose();
    action?.onPress?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={[styles.iconWrap, { backgroundColor: config.iconBg }]}>
              <MaterialCommunityIcons name={config.icon} size={22} color={config.iconColor} />
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.message}>{message}</Text>
            </View>
          </View>

          <View style={styles.buttonRow}>
            {secondaryAction ? (
              <AppButton
                label={secondaryAction.label}
                onPress={() => runAction(secondaryAction)}
                variant={secondaryAction.variant ?? "outline"}
                style={styles.button}
              />
            ) : null}
            <AppButton
              label={primaryAction?.label ?? "OK"}
              onPress={() => runAction(primaryAction)}
              variant={primaryAction?.variant ?? "primary"}
              style={styles.button}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(9, 17, 28, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#fbfdff",
    borderWidth: 1,
    borderColor: "#d8e5f2",
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#16324f",
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: "#486179",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
  },
});

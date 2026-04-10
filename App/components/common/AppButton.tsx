import React from "react";
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from "react-native";

type Variant = "primary" | "secondary" | "outline" | "danger" | "success";

type Props = {
  label: string;
  children?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  variant?: Variant;
  compact?: boolean;
};

export default function AppButton({
  label,
  children,
  onPress,
  disabled,
  style,
  textStyle,
  variant = "primary",
  compact,
}: Props) {
  const hasLabel = label.trim().length > 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" ? styles.primary : null,
        variant === "secondary" ? styles.secondary : null,
        variant === "outline" ? styles.outline : null,
        variant === "danger" ? styles.danger : null,
        variant === "success" ? styles.success : null,
        compact ? styles.compact : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      {children ? (
        <>
          {hasLabel ? (
            <Text
              style={[
                styles.text,
                variant === "outline" ? styles.outlineText : null,
                disabled ? styles.disabledText : null,
                textStyle,
              ]}
            >
              {label}
            </Text>
          ) : null}
          {children}
        </>
      ) : hasLabel ? (
        <Text
          style={[
            styles.text,
            variant === "outline" ? styles.outlineText : null,
            disabled ? styles.disabledText : null,
            textStyle,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    shadowColor: "#0f172a",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pressed: {
    opacity: 0.94,
    transform: [{ scale: 0.985 }],
  },
  compact: {
    minHeight: 38,
    paddingHorizontal: 12,
  },
  primary: {
    backgroundColor: "#1f5f9f",
    borderColor: "#184d82",
  },
  secondary: {
    backgroundColor: "#16324f",
    borderColor: "#112a43",
  },
  success: {
    backgroundColor: "#2d8a65",
    borderColor: "#246a50",
  },
  danger: {
    backgroundColor: "#b63d3d",
    borderColor: "#942f2f",
  },
  outline: {
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#c7d8e8",
    shadowOpacity: 0.03,
    elevation: 1,
  },
  disabled: {
    backgroundColor: "#9eabb8",
    borderColor: "#9eabb8",
  },
  text: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 0.2,
  },
  outlineText: {
    color: "#16324f",
  },
  disabledText: {
    color: "#ffffff",
  },
});

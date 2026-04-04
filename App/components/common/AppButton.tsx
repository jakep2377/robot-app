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
      style={[
        styles.base,
        variant === "primary" ? styles.primary : null,
        variant === "secondary" ? styles.secondary : null,
        variant === "outline" ? styles.outline : null,
        variant === "danger" ? styles.danger : null,
        variant === "success" ? styles.success : null,
        compact ? styles.compact : null,
        disabled ? styles.disabled : null,
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
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  compact: {
    minHeight: 40,
    paddingHorizontal: 12,
  },
  primary: {
    backgroundColor: "#2c6fb7",
  },
  secondary: {
    backgroundColor: "#16324f",
  },
  success: {
    backgroundColor: "#2d8a65",
  },
  danger: {
    backgroundColor: "#b63d3d",
  },
  outline: {
    backgroundColor: "#fbfcfe",
    borderWidth: 1,
    borderColor: "#cfd9e4",
  },
  disabled: {
    backgroundColor: "#9eabb8",
    borderColor: "#9eabb8",
  },
  text: {
    color: "#ffffff",
    fontWeight: "700",
  },
  outlineText: {
    color: "#16324f",
  },
  disabledText: {
    color: "#ffffff",
  },
});

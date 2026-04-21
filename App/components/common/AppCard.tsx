import React from "react";
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

// Shared surface wrapper used across screens to keep cards visually consistent
// while still allowing each caller to customize spacing and heading styles.

type Props = {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
};

export default function AppCard({ title, children, style, contentStyle, titleStyle }: Props) {
  return (
    <View style={[styles.card, style]}>
      <View style={[styles.content, contentStyle]}>
        {title ? <Text style={[styles.title, titleStyle]}>{title}</Text> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f7fbff",
    borderWidth: 1,
    borderColor: "#d4e0ec",
    borderRadius: 22,
    shadowColor: "#0f172a",
    shadowOpacity: 0.09,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  content: {
    padding: 18,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#15304b",
    letterSpacing: 0.2,
  },
});

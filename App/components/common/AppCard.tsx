import React from "react";
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

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
    backgroundColor: "#fbfdff",
    borderWidth: 1,
    borderColor: "#d8e4f0",
    borderRadius: 20,
    shadowColor: "#0f172a",
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  content: {
    padding: 18,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#16324f",
  },
});

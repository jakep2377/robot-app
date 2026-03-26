import React, { useMemo, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  accentColor: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function PercentSlider({ label, value, onChange, accentColor }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const normalizedValue = clamp(value);
  const filledWidth = useMemo(() => {
    if (!trackWidth) {
      return 0;
    }
    return (normalizedValue / 100) * trackWidth;
  }, [normalizedValue, trackWidth]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const handleTrackPress = (locationX: number) => {
    if (!trackWidth) {
      return;
    }
    const nextValue = (locationX / trackWidth) * 100;
    onChange(clamp(nextValue));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: accentColor }]}>{normalizedValue}%</Text>
      </View>

      <View style={styles.controlsRow}>
        <Pressable style={styles.stepButton} onPress={() => onChange(clamp(normalizedValue - 5))}>
          <Text style={styles.stepButtonText}>-5</Text>
        </Pressable>

        <Pressable
          style={styles.trackWrap}
          onLayout={handleLayout}
          onPress={(event) => handleTrackPress(event.nativeEvent.locationX)}
        >
          <View style={styles.trackBackground}>
            <View style={[styles.trackFill, { width: filledWidth, backgroundColor: accentColor }]} />
            <View style={[styles.thumb, { left: Math.max(0, filledWidth - 11), borderColor: accentColor }]} />
          </View>
        </Pressable>

        <Pressable style={styles.stepButton} onPress={() => onChange(clamp(normalizedValue + 5))}>
          <Text style={styles.stepButtonText}>+5</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 15,
    color: "#304863",
    fontWeight: "600",
  },
  value: {
    fontSize: 15,
    fontWeight: "700",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepButton: {
    width: 42,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#eef3f8",
  },
  stepButtonText: {
    color: "#16324f",
    fontWeight: "700",
  },
  trackWrap: {
    flex: 1,
    paddingVertical: 10,
  },
  trackBackground: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#d7dfe8",
    overflow: "visible",
    justifyContent: "center",
  },
  trackFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  thumb: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 3,
    top: -5,
  },
});
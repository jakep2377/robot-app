import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

// Percent slider used for treatment controls. It supports both step buttons and
// drag gestures so operators can make coarse or fine changes quickly.

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
  const normalizedValue = clamp(value);
  const trackRef = useRef<View | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [trackLeft, setTrackLeft] = useState(0);
  const [displayValue, setDisplayValue] = useState(normalizedValue);
  const isDraggingRef = useRef(false);
  const pendingValueRef = useRef(normalizedValue);
  const displayedValue = isDraggingRef.current ? displayValue : normalizedValue;
  const thumbOffset = useMemo(() => {
    if (trackWidth <= 0) return 0;
    return (displayedValue / 100) * trackWidth;
  }, [displayedValue, trackWidth]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      setDisplayValue(normalizedValue);
      pendingValueRef.current = normalizedValue;
    }
  }, [normalizedValue]);

  const updateFromPageX = (pageX: number) => {
    if (trackWidth <= 0) return;
    const nextValue = clamp(((pageX - trackLeft) / trackWidth) * 100);
    setDisplayValue(nextValue);
    pendingValueRef.current = nextValue;
  };

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
    requestAnimationFrame(() => {
      trackRef.current?.measureInWindow((x) => {
        setTrackLeft(x);
      });
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          isDraggingRef.current = true;
          updateFromPageX(event.nativeEvent.pageX);
        },
        onPanResponderMove: (event) => {
          updateFromPageX(event.nativeEvent.pageX);
        },
        onPanResponderRelease: () => {
          isDraggingRef.current = false;
          const nextValue = pendingValueRef.current;
          setDisplayValue(nextValue);
          if (nextValue !== normalizedValue) {
            onChange(nextValue);
          }
        },
        onPanResponderTerminate: () => {
          isDraggingRef.current = false;
          const nextValue = pendingValueRef.current;
          setDisplayValue(nextValue);
          if (nextValue !== normalizedValue) {
            onChange(nextValue);
          }
        },
      }),
    [normalizedValue, onChange, trackLeft, trackWidth],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: accentColor }]}>{displayedValue}%</Text>
      </View>

      <View style={styles.controlsRow}>
        <Pressable style={styles.stepButton} onPress={() => onChange(clamp(normalizedValue - 5))}>
          <Text style={styles.stepButtonText}>-5</Text>
        </Pressable>

        <View
          ref={trackRef}
          style={styles.sliderWrap}
          onLayout={handleTrackLayout}
          {...panResponder.panHandlers}
        >
          <View style={styles.trackBase} />
          <View style={[styles.trackFill, { backgroundColor: accentColor, width: thumbOffset }]} />
          <View
            style={[
              styles.thumb,
              {
                borderColor: accentColor,
                left: thumbOffset,
              },
            ]}
          />
        </View>

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
    width: 46,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#eef3f8",
  },
  stepButtonText: {
    color: "#16324f",
    fontWeight: "700",
  },
  sliderWrap: {
    flex: 1,
    height: 32,
    justifyContent: "center",
  },
  trackBase: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#d7dfe8",
  },
  trackFill: {
    position: "absolute",
    left: 0,
    top: 13,
    height: 6,
    borderRadius: 999,
  },
  thumb: {
    position: "absolute",
    top: 6,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 3,
    shadowColor: "#7a8794",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});

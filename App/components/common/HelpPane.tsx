import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppButton from "./AppButton";
import AppCard from "./AppCard";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

type HelpSection = {
  title: string;
  icon: IconName;
  content: string[];
};

const helpSections: HelpSection[] = [
  {
    title: "Quick Start",
    icon: "check-circle-outline",
    content: [
      "Open Area Map and tap Draw Area.",
      "Pick the first corner, then the opposite corner.",
      "Submit the area and plan the path.",
      "Use Controller to push waypoints and run the mission.",
      "Open Manual Control only when needed.",
    ],
  },
  {
    title: "Area Map",
    icon: "map-marker-path",
    content: [
      "Drag corner markers to adjust the work area.",
      "Use + and - to zoom.",
      "Clear removes the current area.",
      "Plan Path uses the current salt and brine values.",
    ],
  },
  {
    title: "Controller",
    icon: "gamepad-variant-outline",
    content: [
      "Quick Status shows mission, coverage, robot state, and server readiness.",
      "Mission Controls handle waypoint push and mission actions.",
      "Emergency controls cover E-Stop and Reset.",
      "Field Notes are for short handoff notes.",
    ],
  },
  {
    title: "Manual Control",
    icon: "controller-classic-outline",
    content: [
      "Open Manual Control from Controller.",
      "Drive with FWD, LEFT, RIGHT, BACK, and STOP.",
      "Use direct drive only when needed.",
    ],
  },
  {
    title: "Weather",
    icon: "weather-snowy",
    content: [
      "Check current conditions and recommended mix.",
      "Tap a forecast time or enter a manual service time.",
      "Schedule Service requests location and alerts only when needed.",
    ],
  },
  {
    title: "Troubleshooting",
    icon: "lightbulb-on-outline",
    content: [
      "If commands do not execute, verify the server is Ready.",
      "If telemetry is stale, confirm robot and bridge link health.",
      "If a mission action is disabled, a backend safety gate is blocking it.",
    ],
  },
];

export interface HelpPaneProps {
  visible: boolean;
  onClose: () => void;
}

export default function HelpPane({ visible, onClose }: HelpPaneProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <MaterialCommunityIcons name="help-circle-outline" size={24} color="#2c6fb7" />
          <Text style={styles.headerTitle}>Help & Guide</Text>
        </View>
        {visible === false && onClose ? (
          <AppButton label="Close" onPress={onClose} variant="outline" style={styles.closeButton} />
        ) : null}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {helpSections.map((section, index) => (
          <AppCard key={section.title} style={styles.sectionContainer} contentStyle={styles.sectionCardContent}>
            <Pressable style={styles.sectionHeader} onPress={() => setExpandedIndex(expandedIndex === index ? null : index)}>
              <MaterialCommunityIcons name={section.icon} size={22} color="#2c6fb7" style={styles.sectionIcon} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.expandIcon}>{expandedIndex === index ? "-" : "+"}</Text>
            </Pressable>

            {expandedIndex === index ? (
              <View style={styles.sectionContent}>
                {section.content.map((line) => (
                  <Text key={`${section.title}-${line}`} style={styles.contentText}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </AppCard>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#eef3f9",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#f8fbff",
    borderBottomWidth: 1,
    borderBottomColor: "#d6e1ec",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: "700",
    color: "#16324f",
  },
  closeButton: {
    minWidth: 84,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionContainer: {
    marginBottom: 12,
    overflow: "hidden",
  },
  sectionCardContent: {
    padding: 0,
    gap: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#f8fbff",
    borderBottomWidth: 1,
    borderBottomColor: "#e3ebf3",
  },
  sectionIcon: {
    marginRight: 12,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#16324f",
  },
  expandIcon: {
    fontSize: 20,
    color: "#2c6fb7",
    fontWeight: "700",
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
  },
  contentText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#35506a",
    marginBottom: 4,
  },
});

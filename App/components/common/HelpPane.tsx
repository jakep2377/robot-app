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
      "Set the base station and outline the service area.",
      "Save the area and build the route.",
      "Go to Operate to commit the path and start the mission.",
      "Use manual control only for positioning or recovery.",
    ],
  },
  {
    title: "Connection",
    icon: "lan-connect",
    content: [
      "The app uses the hosted server for normal operation.",
      "The server manages the base station and robot link.",
      "Only change the server address when you need to use a different system.",
    ],
  },
  {
    title: "System Status",
    icon: "view-dashboard-outline",
    content: [
      "Check Mission, Robot, and Coverage first.",
      "Fix any item marked Needs attention before autonomy.",
      "Use the alerts card for the most recent blocking issue.",
    ],
  },
  {
    title: "Plan",
    icon: "map-marker-path",
    content: [
      "Place the base station, then set two area corners.",
      "Save Area stores the lot boundary for planning.",
      "Build Route creates the coverage path the robot will follow.",
    ],
  },
  {
    title: "Operate",
    icon: "gamepad-variant-outline",
    content: [
      "Use Commit after the route is ready.",
      "Start Auto runs the preflight checks and begins autonomy.",
      "Pause, Resume, Finish, and Abort stay on the Operate tab.",
    ],
  },
  {
    title: "Manual Control",
    icon: "controller-classic-outline",
    content: [
      "Open Manual Control for short moves or recovery.",
      "Use the thumb pad for blended turning and speed.",
      "Release to stop, and use E-Stop for unsafe motion.",
    ],
  },
  {
    title: "Weather",
    icon: "weather-snowy",
    content: [
      "Review the forecast, treatment mix, and service window.",
      "Arm a reminder or auto run when conditions call for it.",
    ],
  },
  {
    title: "Troubleshooting",
    icon: "lightbulb-on-outline",
    content: [
      "If autonomy is blocked, check connection health and GPS readiness.",
      "If telemetry is stale, inspect the backend, base station, and LoRa path.",
      "Use the server dashboard for deeper system checks.",
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
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <MaterialCommunityIcons name="help-circle-outline" size={24} color="#2c6fb7" />
          <Text style={styles.headerTitle}>Quick Guide</Text>
        </View>
        {visible === false && onClose ? (
          <AppButton label="Close" onPress={onClose} variant="outline" style={styles.closeButton} />
        ) : null}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
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
                    • {line}
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
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
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
    marginBottom: 6,
  },
});



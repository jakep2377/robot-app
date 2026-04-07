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
      "Set the work area, then tap Submit Area.",
      "Plan the path for the current area.",
      "Open Controller to commit the path and start the mission.",
      "Use Manual Control only when direct driving is needed.",
    ],
  },
  {
    title: "Connection",
    icon: "lan-connect",
    content: [
      "The app connects to the backend only.",
      "The backend manages the base station and robot link.",
      "Field network is the normal path.",
      "Direct backup means the backend is using the base station fallback path.",
      "Remote fallback should only be used when a field backend is not available.",
    ],
  },
  {
    title: "Area Map",
    icon: "map-marker-path",
    content: [
      "Drag the corner markers to shape the work area.",
      "Submit Area saves the boundary for planning.",
      "Plan Path builds the coverage route with the current salt and brine values.",
      "Use Clear to remove the current area and start over.",
    ],
  },
  {
    title: "Controller",
    icon: "gamepad-variant-outline",
    content: [
      "Quick Status shows mission, coverage, and system readiness.",
      "Integration Status shows backend, base station, robot link, GPS, and waypoints.",
      "Mission Controls handle commit, start, pause, resume, complete, and abort.",
      "Field Notes are for short handoff notes.",
    ],
  },
  {
    title: "Manual Control",
    icon: "controller-classic-outline",
    content: [
      "Open Manual Control from Controller.",
      "Use FWD, LEFT, RIGHT, BACK, and STOP for short direct moves.",
      "Use E-Stop any time an immediate stop is needed.",
    ],
  },
  {
    title: "Weather",
    icon: "weather-snowy",
    content: [
      "Weather suggests a treatment mix based on current or forecast conditions.",
      "Look Ahead helps choose a service window over the next several days.",
      "Schedule Service asks for phone location and alerts only when needed.",
    ],
  },
  {
    title: "Troubleshooting",
    icon: "lightbulb-on-outline",
    content: [
      "If Start Mission is blocked, check Integration Status first.",
      "If the robot link is stale, verify the base station and LoRa path.",
      "If a mission was restored after restart, review the system before resuming.",
      "If something still looks off, use the server console for deeper testing.",
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
    marginBottom: 4,
  },
});



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
      "Open Plan and tap Mark Work Area.",
      "Pick two opposite corners, then send the area to the planner.",
      "Build the route for the current salt and brine mix.",
      "Switch to Operate to commit the route and start the mission.",
      "Use manual control only for short positioning moves or recovery.",
    ],
  },
  {
    title: "Connection",
    icon: "lan-connect",
    content: [
      "The phone app talks to the remote server, not directly to the robot.",
      "Use the default remote server for normal operation.",
      "Manual server entry is only needed when support gives you a different address.",
      "The server manages the base station and robot link for you.",
    ],
  },
  {
    title: "System Status",
    icon: "view-dashboard-outline",
    content: [
      "Mission, Robot, and Coverage at the top give the quick job summary.",
      "The cards below show whether the remote server, base station, gateway, STM32, GPS, and waypoints are ready.",
      "If the banner says Needs attention, fix those items before starting autonomy.",
      "Alerts are placed high on the Operate screen so issues are easier to catch quickly.",
    ],
  },
  {
    title: "Plan",
    icon: "map-marker-path",
    content: [
      "Drag any corner marker if the work zone needs a quick adjustment.",
      "Send Area stores the lot boundary for the planner.",
      "Build Route creates the coverage pass the robot will follow.",
      "Start Over clears the current selection so you can redraw the job cleanly.",
    ],
  },
  {
    title: "Operate",
    icon: "gamepad-variant-outline",
    content: [
      "Start with System Status and fix anything marked Needs attention.",
      "Use Commit after a route is built on the Plan tab.",
      "Start Auto runs the preflight review and then begins autonomy once the system is ready.",
      "Field Notes are a simple handoff log for the next operator or support tech.",
    ],
  },
  {
    title: "Manual Control",
    icon: "controller-classic-outline",
    content: [
      "Open Manual / Joystick Control from Operate whenever you need direct positioning.",
      "Hold FWD or REV to move, and use TURN L or TURN R to pivot the robot into position.",
      "Release any drive button to send stop, and use E-Stop immediately for unsafe motion.",
    ],
  },
  {
    title: "Weather",
    icon: "weather-snowy",
    content: [
      "This screen recommends a treatment mix based on current and forecast conditions.",
      "Next 5 Days helps you choose a better service window before conditions worsen.",
      "Create Reminder can send a phone alert ahead of the selected service time.",
    ],
  },
  {
    title: "Troubleshooting",
    icon: "lightbulb-on-outline",
    content: [
      "If Start is blocked, read the readiness cards from top to bottom first.",
      "If telemetry looks stale, verify the backend, base station, and LoRa path before retrying autonomy.",
      "If the app reconnects after a restart, review the restored mission state before resuming work.",
      "Use the server dashboard for deeper service checks when the phone view is not enough.",
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
          <Text style={styles.headerTitle}>Guide & Quick Help</Text>
        </View>
        {visible === false && onClose ? (
          <AppButton label="Close" onPress={onClose} variant="outline" style={styles.closeButton} />
        ) : null}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <AppCard style={styles.introCard}>
          <Text style={styles.introEyebrow}>Normal operator flow</Text>
          <Text style={styles.introTitle}>Plan the lot, commit the route, then monitor the mission.</Text>
          <Text style={styles.introText}>
            Most jobs follow the same sequence, so new operators can get started with less coaching.
          </Text>
          <View style={styles.flowList}>
            <View style={styles.flowChip}><Text style={styles.flowChipText}>1. Plan</Text></View>
            <View style={styles.flowChip}><Text style={styles.flowChipText}>2. Commit</Text></View>
            <View style={styles.flowChip}><Text style={styles.flowChipText}>3. Start</Text></View>
            <View style={styles.flowChip}><Text style={styles.flowChipText}>4. Monitor</Text></View>
          </View>
        </AppCard>

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
  introCard: {
    marginBottom: 12,
    backgroundColor: "#f8fbff",
  },
  introEyebrow: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    color: "#63788e",
  },
  introTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#16324f",
  },
  introText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#35506a",
  },
  flowList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  flowChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#eaf2fb",
    borderWidth: 1,
    borderColor: "#d6e5f6",
  },
  flowChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#2c6fb7",
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



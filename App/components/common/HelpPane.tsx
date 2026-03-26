import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

type HelpSection = {
  title: string;
  content: string[];
  icon: IconName;
};

const helpSections: HelpSection[] = [
  {
    title: 'Quick Start',
    icon: 'check-circle-outline',
    content: [
      '1. Open Area Map and tap Draw Area.',
      '2. Tap the first corner, then the opposite corner.',
      '3. Submit the area and plan the path.',
      '4. Use Controller to push waypoints and run the mission.',
      '5. Use Manual Mode only when direct intervention is needed.',
    ],
  },
  {
    title: 'Area Map',
    icon: 'map-marker-path',
    content: [
      'The Area Map bottom-tab icon includes a pinpoint in the top-left of the vector icon.',
      'Drag the corner markers if the rectangle needs adjustment.',
      'Use + and - to zoom the map.',
      'Clear removes the current area so you can start over.',
      'Plan Path uses the current salt and brine percentages.',
    ],
  },
  {
    title: 'Controller',
    icon: 'gamepad-variant-outline',
    content: [
      'Quick Status shows mission state, coverage, robot state, and server readiness.',
      'Mission Controls are for waypoint push and mission lifecycle commands.',
      'Emergency controls include E-Stop and Reset.',
      'Manual Mode can be opened from Controller when direct intervention is needed.',
      'Field Notes are for short handoff notes only.',
    ],
  },
  {
    title: 'Mission Controls Reference',
    icon: 'compass-outline',
    content: [
      'Push WP: Sends planned waypoints to the robot over LoRa.',
      'Start: Starts mission execution using uploaded waypoints.',
      'Pause: Temporarily pauses an active mission.',
      'Resume: Continues a paused mission.',
      'Complete: Marks mission as complete when work is done.',
      'Abort: Stops mission and exits mission flow immediately.',
      'E-Stop: Immediate emergency stop command.',
      'Reset: Clears faulted/stopped state when allowed by backend safety rules.',
    ],
  },
  {
    title: 'Manual Mode',
    icon: 'controller-classic-outline',
    content: [
      'Open Manual Mode from Controller with the Show button.',
      'Directional controls: UP, LEFT, RIGHT, DOWN, and STOP.',
      'Manual command switches robot control mode for direct operation.',
      'Pause command can halt motion during manual operation.',
      'Exit manual intervention and return to mission controls when safe.',
    ],
  },
  {
    title: 'Mission States',
    icon: 'chart-line',
    content: [
      'IDLE: Ready for mission setup.',
      'CONFIGURING: Area/path setup in progress.',
      'RUNNING: Robot is executing mission waypoints.',
      'PAUSED: Mission temporarily halted.',
      'COMPLETED/ABORTED: Mission is finished.',
    ],
  },
  {
    title: 'Weather',
    icon: 'weather-snowy',
    content: [
      'Use Weather to check conditions before setting final treatment percentages.',
      'The recommendation gives a quick starting point for salt and brine values.',
      'Refresh if the conditions look stale.',
    ],
  },
  {
    title: 'Troubleshooting',
    icon: 'lightbulb-on-outline',
    content: [
      'If commands do not execute, verify server status is Ready in Quick Status.',
      'If telemetry is stale, confirm robot and bridge link health before resuming mission.',
      'If a mission action button is disabled, backend safety gates are blocking that action.',
      'Use Field Notes to document operational issues for handoff.',
    ],
  },
];

export interface HelpPaneProps {
  visible: boolean;
  onClose: () => void;
}

export default function HelpPane({ visible, onClose }: HelpPaneProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const theme = {
    pageBg: '#eef3f9',
    headerBg: '#f8fbff',
    border: '#d6e1ec',
    cardBg: '#ffffff',
    sectionBg: '#f8fbff',
    title: '#16324f',
    text: '#35506a',
    muted: '#64778b',
  };

  const toggleSection = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.pageBg }]}>
        <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
          <Text style={[styles.headerTitle, { color: theme.title }]}>❓ Help & Guide</Text>
                    {visible === false && onClose && (
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
                  )}
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {helpSections.map((section, index) => (
            <View key={index} style={styles.sectionContainer}>
              <Pressable
                style={[styles.sectionHeader, { backgroundColor: theme.sectionBg, borderBottomColor: theme.border }]}
                onPress={() => toggleSection(index)}
              >
                <MaterialCommunityIcons name={section.icon} size={22} color="#2c6fb7" style={styles.sectionIcon} />
                <Text style={[styles.sectionTitle, { color: theme.title }]}>{section.title}</Text>
                <Text style={styles.expandIcon}>
                  {expandedIndex === index ? '−' : '+'}
                </Text>
              </Pressable>

              {expandedIndex === index && (
                <View style={[styles.sectionContent, { backgroundColor: theme.cardBg }]}> 
                  {section.content.map((line, lineIndex) => (
                    <Text key={lineIndex} style={[styles.contentText, { color: theme.text }]}> 
                      {line}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ))}

          <View style={[styles.footer, { backgroundColor: theme.sectionBg, borderTopColor: theme.border }]}>
            <Text style={[styles.footerText, { color: theme.muted }]}> 
              This guide includes extended controller documentation, including mission controls and manual mode usage.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eef3f9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#f8fbff',
    borderBottomWidth: 1,
    borderBottomColor: '#d6e1ec',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#16324f',
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  closeButtonText: {
    fontSize: 24,
    color: '#666',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionContainer: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d6e1ec',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#f8fbff',
    borderBottomWidth: 1,
    borderBottomColor: '#e3ebf3',
  },
  sectionIcon: {
    marginRight: 12,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1e3854',
  },
  expandIcon: {
    fontSize: 20,
    color: '#2c6fb7',
    fontWeight: 'bold',
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  contentText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#35506a',
    marginBottom: 4,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    backgroundColor: '#f8fbff',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e3ebf3',
  },
  footerText: {
    fontSize: 12,
    color: '#64778b',
    lineHeight: 18,
    textAlign: 'center',
  },
});

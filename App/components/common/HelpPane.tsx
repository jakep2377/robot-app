import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type HelpSection = {
  title: string;
  content: string[];
  icon: string;
};

const helpSections: HelpSection[] = [
  {
    title: 'Getting Started',
    icon: '🚀',
    content: [
      'Welcome to the LoRa Anti-Icing Robot Control System!',
      '',
      'This app allows you to define an area, plan a mission path, and monitor the robot in real-time as it applies treatment.',
      '',
      'Start on the "Area Map" tab to define your mission boundary.',
    ],
  },
  {
    title: 'Area Map - Define Your Mission',
    icon: '🗺️',
    content: [
      '1. TAP "Draw Area" to begin defining the treatment area',
      '',
      '2. TAP the first corner (Base Station corner) - this is where the robot starts',
      '',
      '3. TAP the opposite corner to complete the rectangular area',
      '',
      '4. DRAG the corner markers to adjust the boundary if needed',
      '',
      '5. TAP "Submit Area" to upload the mission area to the server',
      '',
      '6. TAP "Plan Path" to generate an optimal treatment path',
      '',
      'TIP: Use "Show Precision Tools" for more accurate corner placement with nudge buttons and crosshair mode.',
    ],
  },
  {
    title: 'Area Map - Precision Tools',
    icon: '🎯',
    content: [
      'When "Show Precision Tools" is expanded, you get:',
      '',
      '• CROSSHAIR MODE: Shows a crosshair at the map center. Useful for precise corner positioning.',
      '',
      '• NUDGE TARGET: Choose whether nudge moves the boundary box or map center',
      '',
      '• NUDGE BUTTONS: Moves the selected target in small increments (up/down/left/right)',
      '',
      '• SET CORNER: Captures the current map center as a corner',
      '',
      'HOW TO USE:',
      '1. Pan and zoom to your desired location',
      '2. Use nudge buttons to fine-tune the position with the crosshair',
      '3. Tap "Set First Corner" or "Set Opposite Corner" to capture',
    ],
  },
  {
    title: 'Area Map - Zoom & Pan',
    icon: '📍',
    content: [
      'PINCH TO ZOOM: Use two fingers to zoom in and out',
      '',
      'TAP & DRAG: Single finger drag to pan the map',
      '',
      'ZOOM BUTTONS: Use the + / - buttons for fixed zoom increments',
      '',
      'AUTO-FIT: When you submit an area or plan a path, the map automatically fits the boundary in view',
    ],
  },
  {
    title: 'Controller Tab',
    icon: '🎮',
    content: [
      'Use the Controller tab to:',
      '',
      '• Monitor robot supervision status in real-time',
      '',
      '• Adjust SALT % and BRINE % application rates',
      '',
      '• Send manual control commands (if needed)',
      '',
      'TIP: Server endpoint is automatically managed by system configuration.',
    ],
  },
  {
    title: 'Weather Tab',
    icon: '❄️',
    content: [
      'The Weather tab shows:',
      '',
      '• Current conditions (temperature, precipitation, wind)',
      '',
      '• Visibility and frost point information',
      '',
      '• Recommended salt/brine application percentages',
      '',
      'The app automatically calculates optimal treatment rates based on weather conditions to maximize effectiveness.',
    ],
  },
  {
    title: 'Server Configuration',
    icon: '🔗',
    content: [
      'The Base Station endpoint is automatically configured for this app build.',
      '',
      'No manual URL entry is required from the mobile interface.',
      '',
      'If backend routing changes are needed, update app environment/deployment config.',
      '',
      'The server monitors mission progress, coverage maps, and robot telemetry in real-time.',
    ],
  },
  {
    title: 'Mission States',
    icon: '📊',
    content: [
      'Your mission goes through these states:',
      '',
      '• IDLE: Ready to configure a new mission',
      '',
      '• CONFIGURING: Setting up area and path',
      '',
      '• RUNNING: Mission active, robot is treating the area',
      '',
      '• PAUSED: Mission temporarily suspended',
      '',
      '• COMPLETED/ABORTED: Mission finished',
      '',
      'Check the server dashboard for detailed mission status.',
    ],
  },
  {
    title: 'Tips & Troubleshooting',
    icon: '💡',
    content: [
      '• If the map won\'t zoom: Make sure you\'re using two fingers for pinch zoom',
      '',
      '• If the server won\'t connect: Check your URL and network connection',
      '',
      '• If the robot doesn\'t move: Verify the path was planned and committed to the robot',
      '',
      '• View real-time coverage: Open the server dashboard at http://localhost:3000 (or your server URL)',
      '',
      '• No signal during mission: The robot continues its last mission until radio contact is restored',
    ],
  },
];

export interface HelpPaneProps {
  visible: boolean;
  onClose: () => void;
  darkMode?: boolean;
}

export default function HelpPane({ visible, onClose, darkMode = false }: HelpPaneProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const theme = darkMode
    ? {
        pageBg: '#0f1722',
        headerBg: '#152334',
        border: '#2b3f57',
        cardBg: '#182738',
        sectionBg: '#1d2d40',
        title: '#d7e7fa',
        text: '#c0d2e6',
        muted: '#91a8c0',
      }
    : {
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
                <Text style={styles.sectionIcon}>{section.icon}</Text>
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
              For technical support or additional information, check the server dashboard or contact your system administrator.
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
    fontSize: 24,
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

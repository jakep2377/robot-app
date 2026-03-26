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
    title: 'Quick Start',
    icon: '✅',
    content: [
      '1. Open Area Map and tap Draw Area.',
      '2. Tap the first corner, then the opposite corner.',
      '3. Submit the area and plan the path.',
      '4. Use Controller to push waypoints and run the mission.',
    ],
  },
  {
    title: 'Area Map',
    icon: '🗺️',
    content: [
      'Drag the corner markers if the rectangle needs adjustment.',
      'Use + and - to zoom the map.',
      'Clear removes the current area so you can start over.',
      'Plan Path uses the current salt and brine percentages.',
    ],
  },
  {
    title: 'Controller',
    icon: '🎮',
    content: [
      'Mission Overview shows the current mission state, coverage, and robot state.',
      'Server Health shows whether the backend, bridge, and telemetry checks are healthy.',
      'Use Manual Drive only when direct movement is required.',
      'Field Notes are for short handoff notes only.',
    ],
  },
  {
    title: 'Weather',
    icon: '❄️',
    content: [
      'Use Weather to check conditions before setting final treatment percentages.',
      'The recommendation gives a quick starting point for salt and brine values.',
      'Refresh if the conditions look stale.',
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
              This help page now covers the core flow only: define the area, plan the path, then run and monitor the mission.
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

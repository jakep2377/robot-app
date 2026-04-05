import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ControllerScreen from './App/screens/ControllerScreen';
import AreaMapScreen from './App/screens/AreaMapScreen';
import WeatherScreen from './App/screens/WeatherScreen';
import HelpPane from './App/components/common/HelpPane';
import { normalizeServerUrl, probeServer, type ServerProbeResult } from './App/lib/serverApi';

const Tab = createBottomTabNavigator();
const DEFAULT_CLOUD_SERVER_URL = 'https://robot-lora-server.onrender.com';
const LOCAL_SERVER_CANDIDATES = [
  'http://10.0.2.2:8080',
  'http://10.0.3.2:8080',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

type ConnectionMode = 'discovering' | 'local' | 'cloud' | 'manual';

type ConnectionState = {
  serverUrl: string;
  mode: ConnectionMode;
  label: string;
  status: 'connecting' | 'connected' | 'fallback' | 'error';
  detail: string;
};

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.map((value) => normalizeServerUrl(value))));
}

async function pickFirstHealthy(urls: string[], timeoutMs: number) {
  const results = await Promise.all(urls.map((url) => probeServer(url, timeoutMs)));
  const success = results.find((result) => result.ok);
  return { success, results };
}

async function discoverBestServer(preferredUrl?: string | null) {
  const localCandidates = uniqueUrls([
    ...(preferredUrl ? [preferredUrl] : []),
    ...(typeof process.env.EXPO_PUBLIC_DEFAULT_SERVER_URL === 'string' && process.env.EXPO_PUBLIC_DEFAULT_SERVER_URL.trim()
      ? [process.env.EXPO_PUBLIC_DEFAULT_SERVER_URL.trim()]
      : []),
    ...LOCAL_SERVER_CANDIDATES,
  ]).filter((url) => !url.includes('onrender.com'));

  const local = await pickFirstHealthy(localCandidates, 1400);
  if (local.success) {
    return {
      state: {
        serverUrl: local.success.serverUrl,
        mode: 'local' as const,
        label: 'Local backend',
        status: 'connected' as const,
        detail: `Connected to backend in ${local.success.latencyMs} ms`,
      },
      probes: local.results,
    };
  }

  const cloud = await probeServer(DEFAULT_CLOUD_SERVER_URL, 2200);
  if (cloud.ok) {
    return {
      state: {
        serverUrl: cloud.serverUrl,
        mode: 'cloud' as const,
        label: 'Cloud fallback',
        status: 'fallback' as const,
        detail: `Using cloud backend in ${cloud.latencyMs} ms`,
      },
      probes: [...local.results, cloud],
    };
  }

  return {
      state: {
        serverUrl: preferredUrl ? normalizeServerUrl(preferredUrl) : DEFAULT_CLOUD_SERVER_URL,
        mode: 'discovering' as const,
        label: 'Backend unavailable',
        status: 'error' as const,
        detail: 'Could not reach a local backend or the cloud fallback.',
      },
    probes: [...local.results, cloud],
  };
}

function ConnectionBar({
  connection,
  busy,
  onOpen,
}: {
  connection: ConnectionState;
  busy: boolean;
  onOpen: () => void;
}) {
  const insets = useSafeAreaInsets();
  const dotStyle = [
    styles.connectionDot,
    connection.status === 'connected'
      ? styles.connectionDotConnected
      : connection.status === 'fallback'
        ? styles.connectionDotFallback
        : connection.status === 'error'
          ? styles.connectionDotError
          : styles.connectionDotConnecting,
  ];

  return (
    <View style={[styles.connectionBar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.connectionInfo}>
        <View style={dotStyle} />
        <View style={styles.connectionTextWrap}>
          <Text style={styles.connectionTitle}>{connection.label}</Text>
          <Text style={styles.connectionDetail} numberOfLines={1}>
            {busy ? 'Checking nearby server...' : connection.detail}
          </Text>
        </View>
      </View>
      <Pressable style={styles.connectionButton} onPress={onOpen}>
        {busy ? <ActivityIndicator size="small" color="#1f5f9f" /> : <Text style={styles.connectionButtonText}>Change</Text>}
      </Pressable>
    </View>
  );
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [connection, setConnection] = useState<ConnectionState>({
    serverUrl: DEFAULT_CLOUD_SERVER_URL,
    mode: 'discovering',
    label: 'Searching for backend',
    status: 'connecting',
    detail: 'Looking for a local backend server first.',
  });
  const [manualServerUrl, setManualServerUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [connectionModalVisible, setConnectionModalVisible] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [saltPct, setSaltPct] = useState(100);
  const [brinePct, setBrinePct] = useState(100);

  const runDiscovery = async (preferredUrl?: string | null) => {
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      const result = await discoverBestServer(preferredUrl);
      setConnection(result.state);
      setServerUrl(result.state.serverUrl);
      setManualServerUrl(result.state.serverUrl);
      if (result.state.status === 'error') {
        const failedLocal = result.probes.filter((probe) => !probe.ok).slice(0, 2);
        if (failedLocal.length > 0) {
          setConnectionError(failedLocal.map((probe) => `${probe.serverUrl}: ${probe.error ?? 'unreachable'}`).join('\n'));
        }
      }
    } finally {
      setConnectionBusy(false);
    }
  };

  useEffect(() => {
    runDiscovery().catch(() => {
      setConnectionBusy(false);
      setConnectionError('Unable to complete server discovery.');
    });
  }, []);

  const saveManualServer = async () => {
    const candidate = normalizeServerUrl(manualServerUrl);
    setConnectionBusy(true);
    setConnectionError(null);
    const result = await probeServer(candidate, 2200);
    setConnectionBusy(false);

    if (!result.ok) {
      setConnectionError(result.error ?? 'Unable to reach that server.');
      return;
    }

    setServerUrl(candidate);
    setConnection({
      serverUrl: candidate,
      mode: 'manual',
      label: 'Manual server',
      status: 'connected',
      detail: `Connected to ${candidate}`,
    });
    setConnectionModalVisible(false);
  };

  const useCloudFallback = async () => {
    setConnectionBusy(true);
    setConnectionError(null);
    const result = await probeServer(DEFAULT_CLOUD_SERVER_URL, 2200);
    setConnectionBusy(false);

    if (!result.ok) {
      setConnectionError(result.error ?? 'Cloud fallback is not reachable.');
      return;
    }

    setServerUrl(result.serverUrl);
    setManualServerUrl(result.serverUrl);
    setConnection({
      serverUrl: result.serverUrl,
      mode: 'cloud',
      label: 'Cloud fallback',
      status: 'fallback',
      detail: `Using cloud backend in ${result.latencyMs} ms`,
    });
    setConnectionModalVisible(false);
  };

  const tabScreenOptions = useMemo(() => ({
    headerShown: false,
    tabBarActiveTintColor: '#1f5f9f',
    tabBarInactiveTintColor: '#6b7f93',
    tabBarIconStyle: {
      marginTop: 2,
    },
    tabBarLabelStyle: {
      fontSize: 12,
      fontWeight: '700' as const,
    },
    tabBarStyle: {
      backgroundColor: '#f8fbff',
      borderTopColor: '#d7e2ee',
      borderTopWidth: 1,
      height: 80,
      paddingTop: 6,
      paddingBottom: 8,
    },
  }), []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <View style={styles.appShell}>
        <ConnectionBar connection={connection} busy={connectionBusy} onOpen={() => setConnectionModalVisible(true)} />
        <NavigationContainer>
          <Tab.Navigator screenOptions={tabScreenOptions}>
            <Tab.Screen
              name="Controller"
              options={{
                tabBarLabel: 'Controller',
                tabBarIcon: ({ color, size }) => (
                  <MaterialCommunityIcons name="gamepad-variant" size={size + 1} color={color} />
                ),
              }}
            >
              {() => (
                <ControllerScreen
                  serverUrl={serverUrl}
                  saltPct={saltPct}
                  brinePct={brinePct}
                  setSaltPct={setSaltPct}
                  setBrinePct={setBrinePct}
                />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="Area Map"
              options={{
                tabBarLabel: 'Area Map',
                tabBarIcon: ({ color, size }) => (
                  <MaterialCommunityIcons name="map-marker-path" size={size + 1} color={color} style={{ transform: [{ scaleX: -1 }] }} />
                ),
              }}
            >
              {() => <AreaMapScreen serverUrl={serverUrl} saltPct={saltPct} brinePct={brinePct} />}
            </Tab.Screen>
            <Tab.Screen
              name="Weather"
              options={{
                tabBarLabel: 'Weather',
                tabBarIcon: ({ color, size }) => (
                  <MaterialCommunityIcons name="weather-snowy" size={size + 1} color={color} />
                ),
              }}
            >
              {() => (
                <WeatherScreen
                  saltPct={saltPct}
                  brinePct={brinePct}
                  setSaltPct={setSaltPct}
                  setBrinePct={setBrinePct}
                />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="Help"
              options={{
                tabBarLabel: 'Help',
                tabBarIcon: ({ color, size }) => (
                  <MaterialCommunityIcons name="help-circle-outline" size={size + 1} color={color} />
                ),
              }}
            >
              {() => <HelpPane visible={true} onClose={() => {}} />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>
      </View>

      <Modal visible={connectionModalVisible} transparent animationType="slide" onRequestClose={() => setConnectionModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Connection</Text>
              <Pressable onPress={() => setConnectionModalVisible(false)} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.modalBodyText}>
              The app connects to the backend server only. The backend server is responsible for talking to the base station.
            </Text>
            <Text style={styles.modalStatus}>Current: {connection.label}</Text>
            <Text style={styles.modalDetail}>{connection.detail}</Text>

            <Text style={styles.inputLabel}>Manual server URL</Text>
            <TextInput
              style={styles.input}
              value={manualServerUrl}
              onChangeText={setManualServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.1.50:8080"
              placeholderTextColor="#8aa0b7"
            />

            {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}

            <View style={styles.buttonStack}>
              <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={() => runDiscovery(serverUrl)} disabled={connectionBusy}>
                <Text style={styles.actionPrimaryText}>Find Local Backend</Text>
              </Pressable>
              <Pressable style={styles.actionButton} onPress={saveManualServer} disabled={connectionBusy}>
                <Text style={styles.actionSecondaryText}>Use Manual Address</Text>
              </Pressable>
              <Pressable style={styles.actionButton} onPress={useCloudFallback} disabled={connectionBusy}>
                <Text style={styles.actionSecondaryText}>Use Cloud Fallback</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#eef4fb',
  },
  connectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#f8fbff',
    borderBottomColor: '#d7e2ee',
    borderBottomWidth: 1,
  },
  connectionInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  connectionDotConnected: {
    backgroundColor: '#1f9d64',
  },
  connectionDotFallback: {
    backgroundColor: '#d98b1f',
  },
  connectionDotError: {
    backgroundColor: '#c84141',
  },
  connectionDotConnecting: {
    backgroundColor: '#5b88b8',
  },
  connectionTextWrap: {
    flex: 1,
  },
  connectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#213c5a',
  },
  connectionDetail: {
    marginTop: 2,
    fontSize: 12,
    color: '#64809d',
  },
  connectionButton: {
    marginLeft: 12,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c6d7e8',
    backgroundColor: '#ffffff',
  },
  connectionButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#21466d',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dce6f0',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#213c5a',
  },
  modalCloseButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#eef4fb',
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#315781',
  },
  modalBodyText: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 20,
    color: '#5f7893',
  },
  modalStatus: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '800',
    color: '#213c5a',
  },
  modalDetail: {
    marginTop: 4,
    fontSize: 13,
    color: '#64809d',
  },
  inputLabel: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '800',
    color: '#4f6882',
  },
  input: {
    borderWidth: 1,
    borderColor: '#c8d7e7',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#213c5a',
    backgroundColor: '#f8fbff',
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: '#c84141',
    lineHeight: 18,
  },
  buttonStack: {
    marginTop: 18,
    gap: 10,
  },
  actionButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c8d7e7',
    backgroundColor: '#f8fbff',
  },
  actionPrimary: {
    backgroundColor: '#2f76c1',
    borderColor: '#2f76c1',
  },
  actionPrimaryText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  actionSecondaryText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#21466d',
  },
});

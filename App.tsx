/**
 * App.tsx
 *
 * App shell for the Expo client. This file owns the top-level connection and
 * setup workflow, then passes the resolved backend URL and shared treatment
 * state down into the three main tabs.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ControllerScreen from './App/screens/ControllerScreen';
import AreaMapScreen from './App/screens/AreaMapScreen';
import WeatherScreen from './App/screens/WeatherScreen';
import HelpPane from './App/components/common/HelpPane';
import { configureBaseStationSetup, normalizeBaseStationUrl, normalizeServerUrl, probeBaseStationSetup, probeServer, type BaseStationSetupStatus, type ServerProbeResult } from './App/lib/serverApi';
import type { DemoPathPoint } from './App/lib/plannerTypes';

const Tab = createBottomTabNavigator();
const DEFAULT_CLOUD_SERVER_URL = 'https://robot-lora-server.onrender.com';
const DEFAULT_MANUAL_GATEWAY_URL = 'http://172.20.10.2';
const ENV_LOCAL_SERVER_CANDIDATES = typeof process.env.EXPO_PUBLIC_LOCAL_SERVER_URLS === 'string'
  ? process.env.EXPO_PUBLIC_LOCAL_SERVER_URLS.split(',').map((value) => value.trim()).filter(Boolean)
  : [];
const SCRIPT_LOCAL_SERVER_CANDIDATES = (() => {
  const scriptUrl = NativeModules?.SourceCode?.scriptURL;
  const hostMatch = typeof scriptUrl === 'string'
    ? scriptUrl.match(/^[a-z]+:\/\/([^/:]+)/i)
    : null;
  const host = hostMatch?.[1]?.trim();

  if (!host || ['localhost', '127.0.0.1', '10.0.2.2', '10.0.3.2'].includes(host)) {
    return [];
  }

  return [`http://${host}:8080`];
})();
const LOCAL_SERVER_CANDIDATES = [
  ...ENV_LOCAL_SERVER_CANDIDATES,
  ...SCRIPT_LOCAL_SERVER_CANDIDATES,
  'http://10.0.2.2:8080',
  'http://10.0.3.2:8080',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];
const LOCAL_DISCOVERY_TIMEOUT_MS = 2200;
const CLOUD_DISCOVERY_TIMEOUT_MS = 8000;
const DISCOVERY_RETRY_INTERVAL_MS = 6000;

type ConnectionMode = 'discovering' | 'local' | 'cloud' | 'manual';

type ConnectionState = {
  serverUrl: string;
  mode: ConnectionMode;
  label: string;
  status: 'idle' | 'connecting' | 'connected' | 'fallback' | 'error';
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

async function discoverBestServer() {
  // Probe likely local targets first because they give the lowest latency for
  // map updates and manual control, then fall back to the hosted backend.
  const localCandidates = uniqueUrls(LOCAL_SERVER_CANDIDATES);
  const localProbePromise = localCandidates.length
    ? pickFirstHealthy(localCandidates, LOCAL_DISCOVERY_TIMEOUT_MS)
    : Promise.resolve({ success: null, results: [] as ServerProbeResult[] });
  const cloudProbePromise = probeServer(DEFAULT_CLOUD_SERVER_URL, CLOUD_DISCOVERY_TIMEOUT_MS);

  const { success: localSuccess, results: localResults } = await localProbePromise;

  if (localSuccess) {
    return {
      state: {
        serverUrl: localSuccess.serverUrl,
        mode: 'local' as const,
        label: 'Local server',
        status: 'connected' as const,
        detail: `Connected to the local server in ${localSuccess.latencyMs} ms`,
      },
      probes: localResults,
    };
  }

  const cloud = await cloudProbePromise;
  if (cloud.ok) {
    return {
      state: {
        serverUrl: cloud.serverUrl,
        mode: 'cloud' as const,
        label: 'Remote server',
        status: 'connected' as const,
        detail: `Connected to the hosted server in ${cloud.latencyMs} ms`,
      },
      probes: [...localResults, cloud],
    };
  }

  const cloudTimedOut = /timed out|timeout|socket|abort/i.test(String(cloud.error ?? ''));

  return {
    state: {
      serverUrl: DEFAULT_CLOUD_SERVER_URL,
      mode: 'cloud' as const,
      label: cloudTimedOut ? 'Waking remote server' : 'Server offline',
      status: cloudTimedOut ? 'connecting' as const : 'error' as const,
      detail: cloudTimedOut
        ? 'The hosted server is waking up. The app will keep retrying in the background.'
        : 'No reachable local or remote server was found.',
    },
    probes: [...localResults, cloud],
  };
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [connection, setConnection] = useState<ConnectionState>({
    serverUrl: DEFAULT_CLOUD_SERVER_URL,
    mode: 'cloud',
    label: 'Server check ready',
    status: 'idle',
    detail: 'The app will wait until you check the server connection.',
  });
  const [manualServerUrl, setManualServerUrl] = useState(DEFAULT_MANUAL_GATEWAY_URL);
  const [connectionModalVisible, setConnectionModalVisible] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [baseStationUrl, setBaseStationUrl] = useState('http://192.168.4.1');
  const [baseStationWifiSsid, setBaseStationWifiSsid] = useState('');
  const [baseStationWifiPassword, setBaseStationWifiPassword] = useState('');
  const [baseStationBackendUrl, setBaseStationBackendUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [baseStationBoardApiKey, setBaseStationBoardApiKey] = useState((typeof process.env.EXPO_PUBLIC_BOARD_API_KEY === 'string' && process.env.EXPO_PUBLIC_BOARD_API_KEY.trim()) || '');
  const [baseStationSetupBusy, setBaseStationSetupBusy] = useState(false);
  const [baseStationSetupError, setBaseStationSetupError] = useState<string | null>(null);
  const [baseStationSetupInfo, setBaseStationSetupInfo] = useState<string | null>(null);
  const [baseStationSetupStatus, setBaseStationSetupStatus] = useState<BaseStationSetupStatus | null>(null);
  const [saltPct, setSaltPct] = useState(100);
  const [brinePct, setBrinePct] = useState(100);
  const [demoPathPoints, setDemoPathPoints] = useState<DemoPathPoint[]>([]);

  const runDiscovery = async () => {
    // Centralize connection-state updates here so both startup and retry flows
    // produce the same UI state transitions.
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      const result = await discoverBestServer();
      setConnection(result.state);
      setServerUrl(result.state.serverUrl);
      setManualServerUrl(DEFAULT_MANUAL_GATEWAY_URL);
      if (result.state.status === 'error') {
        const failedProbe = result.probes.find((probe) => !probe.ok);
        setConnectionError(failedProbe?.error ?? 'Unable to reach a local or hosted server.');
      } else {
        setConnectionError(null);
      }
    } finally {
      setConnectionBusy(false);
    }
  };

  useEffect(() => {
    runDiscovery().catch(() => {
      setConnectionBusy(false);
      setConnectionError('Unable to check the server connection.');
    });
  }, []);

  useEffect(() => {
    // Retry when the hosted backend is still waking up or the previous probe
    // failed, but avoid stacking timers while a probe is already running.
    if (!['connecting', 'error'].includes(connection.status) || connectionBusy) {
      return;
    }

    const timer = setTimeout(() => {
      runDiscovery().catch(() => {
        setConnectionBusy(false);
      });
    }, DISCOVERY_RETRY_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [connection.status, connectionBusy]);

  useEffect(() => {
    setBaseStationBackendUrl(serverUrl);
  }, [serverUrl]);

  const inspectBaseStationSetup = async () => {
    setBaseStationSetupBusy(true);
    setBaseStationSetupError(null);
    setBaseStationSetupInfo(null);
    try {
      const result = await probeBaseStationSetup(baseStationUrl, 2500);
      if (!result.ok) {
        setBaseStationSetupStatus(null);
        setBaseStationSetupError(result.error ?? 'Unable to reach the base station setup AP.');
        return;
      }
      setBaseStationSetupStatus(result.payload ?? null);
      if (result.payload?.savedSsid) setBaseStationWifiSsid(result.payload.savedSsid);
      if (result.payload?.backendUrl) setBaseStationBackendUrl(result.payload.backendUrl);
      setBaseStationSetupInfo(`Connected to setup AP in ${result.latencyMs} ms.`);
    } finally {
      setBaseStationSetupBusy(false);
    }
  };

  const saveBaseStationSetup = async () => {
    if (!baseStationWifiSsid.trim()) {
      setBaseStationSetupError('Enter the Wi-Fi name the base station should join.');
      return;
    }

    // The setup AP always receives the cloud backend URL here so the base
    // station rejoins normal mode with a predictable server target.
    setBaseStationSetupBusy(true);
    setBaseStationSetupError(null);
    setBaseStationSetupInfo(null);
    try {
      const normalizedBackendUrl = normalizeServerUrl(DEFAULT_CLOUD_SERVER_URL);
      const response = await configureBaseStationSetup(baseStationUrl, {
        ssid: baseStationWifiSsid.trim(),
        password: baseStationWifiPassword,
        backendUrl: normalizedBackendUrl,
      });
      setBaseStationBackendUrl(normalizedBackendUrl);
      setBaseStationSetupInfo(response.message ?? 'Wi‑Fi saved. The base station is restarting into normal mode.');
      setBaseStationSetupStatus((previous) => ({
        ...(previous ?? {}),
        configured: true,
        savedSsid: baseStationWifiSsid.trim(),
        backendUrl: normalizedBackendUrl,
        boardApiKeySet: false,
      }));
    } catch (error) {
      setBaseStationSetupError(error instanceof Error ? error.message : 'Unable to save the base station setup.');
    } finally {
      setBaseStationSetupBusy(false);
    }
  };

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
      label: 'Custom server',
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
      setConnectionError(result.error ?? 'Remote server is not reachable.');
      return;
    }

    setServerUrl(result.serverUrl);
    setManualServerUrl(DEFAULT_MANUAL_GATEWAY_URL);
    setConnection({
      serverUrl: result.serverUrl,
      mode: 'cloud',
      label: 'Remote server',
      status: 'connected',
      detail: `Connected to the remote server in ${result.latencyMs} ms`,
    });
    setConnectionModalVisible(false);
  };

  const baseStationSetupStage = baseStationSetupError
    ? 'Setup AP not reached'
    : baseStationSetupInfo
      ? 'Setup saved'
      : baseStationSetupStatus
        ? 'Setup AP connected'
        : 'Waiting for setup';
  const baseStationSetupDetail = baseStationSetupError
    ? 'Join SaltRobot_Base, then tap Check Setup Network.'
    : baseStationSetupInfo
      ? 'Reconnect your phone to the normal network, then tap Check Server Connection.'
      : baseStationSetupStatus
        ? 'The base station AP is responding. Save Wi-Fi to move it onto your normal network.'
        : 'Use this section only while your phone is connected to SaltRobot_Base.';
  const tabScreenOptions = useMemo(() => ({
    headerShown: false,
    lazy: true,
    freezeOnBlur: false,
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
        <NavigationContainer>
          <Tab.Navigator screenOptions={tabScreenOptions} detachInactiveScreens={false}>
            <Tab.Screen
              name="Controller"
              options={{
                tabBarLabel: 'Operate',
                tabBarIcon: ({ color, size }) => (
                  <MaterialCommunityIcons name="gamepad-variant" size={size + 1} color={color} />
                ),
              }}
            >
              {() => (
                <ControllerScreen
                  serverUrl={serverUrl}
                  manualServerUrl={manualServerUrl}
                  saltPct={saltPct}
                  brinePct={brinePct}
                  setSaltPct={setSaltPct}
                  setBrinePct={setBrinePct}
                  connectionLabel={connection.label}
                  connectionStatus={connection.status}
                  connectionDetail={connection.detail}
                  connectionMode={connection.mode}
                  connectionBusy={connectionBusy}
                  onOpenConnection={() => setConnectionModalVisible(true)}
                  onDemoPathPreviewChange={setDemoPathPoints}
                />
              )}
            </Tab.Screen>
            <Tab.Screen
              name="Area Map"
              options={{
                tabBarLabel: 'Plan',
                tabBarIcon: ({ color, size }) => (
                  <MaterialCommunityIcons name="map-marker-path" size={size + 1} color={color} style={{ transform: [{ scaleX: -1 }] }} />
                ),
              }}
            >
              {() => <AreaMapScreen serverUrl={serverUrl} saltPct={saltPct} brinePct={brinePct} demoPathPoints={demoPathPoints} />}
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
                  serverUrl={serverUrl}
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
                tabBarLabel: 'Guide',
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
              <Text style={styles.modalTitle}>Server connection</Text>
              <Pressable onPress={() => setConnectionModalVisible(false)} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.modalBodyText}>
                This app stays pointed at your hosted remote server so the autonomy flow is consistent everywhere.
              </Text>
              <View style={styles.modalStepRow}>
                <View style={styles.modalStepCard}>
                  <Text style={styles.modalStepNumber}>1</Text>
                  <Text style={styles.modalStepText}>Check the hosted server</Text>
                </View>
                <View style={styles.modalStepCard}>
                  <Text style={styles.modalStepNumber}>2</Text>
                  <Text style={styles.modalStepText}>Set the base station Wi-Fi once</Text>
                </View>
                <View style={styles.modalStepCard}>
                  <Text style={styles.modalStepNumber}>3</Text>
                  <Text style={styles.modalStepText}>Plan and run from the same backend every time</Text>
                </View>
              </View>
              <Text style={styles.modalStatus}>Current connection: {connection.label}</Text>
              <Text style={styles.modalDetail}>{connection.detail}</Text>
              <Text style={styles.modalHintText}>Hosted server: {DEFAULT_CLOUD_SERVER_URL}</Text>
              <Text style={styles.modalHintText}>Manual gateway: {DEFAULT_MANUAL_GATEWAY_URL}</Text>

              {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}

              <View style={styles.buttonStack}>
                <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={() => runDiscovery()} disabled={connectionBusy}>
                  <Text style={styles.actionPrimaryText}>Check Hosted Server</Text>
                </Pressable>
              </View>

              <View style={styles.setupSection}>
                <Text style={styles.setupTitle}>First-time base station setup</Text>
                <Text style={styles.modalBodyText}>
                  Connect your phone to <Text style={styles.inlineStrong}>SaltRobot_Base</Text>, then save the normal Wi-Fi. The backend stays fixed to your hosted server automatically.
                </Text>

                <Text style={styles.inputLabel}>Setup AP address</Text>
                <TextInput
                  style={styles.input}
                  value={baseStationUrl}
                  onChangeText={(value) => setBaseStationUrl(normalizeBaseStationUrl(value))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="http://192.168.4.1"
                  placeholderTextColor="#8aa0b7"
                />

                <Text style={styles.inputLabel}>Wi-Fi name to join</Text>
                <TextInput
                  style={styles.input}
                  value={baseStationWifiSsid}
                  onChangeText={setBaseStationWifiSsid}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Customer or hotspot Wi-Fi"
                  placeholderTextColor="#8aa0b7"
                />

                <Text style={styles.inputLabel}>Wi-Fi password</Text>
                <TextInput
                  style={styles.input}
                  value={baseStationWifiPassword}
                  onChangeText={setBaseStationWifiPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  placeholder="Enter Wi-Fi password"
                  placeholderTextColor="#8aa0b7"
                />

                <Text style={styles.inputLabel}>Backend address for the base station</Text>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyFieldText}>{DEFAULT_CLOUD_SERVER_URL}</Text>
                </View>

                {baseStationSetupStatus ? (
                  <View style={styles.setupStatusCard}>
                    <Text style={styles.setupStatusTitle}>{baseStationSetupStage}</Text>
                    <Text style={styles.setupStatusText}>Mode: {baseStationSetupStatus.mode ?? 'unknown'} | Wi-Fi state: {baseStationSetupStatus.wifiLinkState ?? 'unknown'}</Text>
                    <Text style={styles.setupStatusText}>Saved Wi-Fi: {baseStationSetupStatus.savedSsid || 'none yet'}</Text>
                    <Text style={styles.setupStatusText}>Backend: {baseStationSetupStatus.backendUrl || DEFAULT_CLOUD_SERVER_URL}</Text>
                    <Text style={styles.setupStatusText}>{baseStationSetupDetail}</Text>
                  </View>
                ) : null}

                {baseStationSetupInfo ? <Text style={styles.infoText}>{baseStationSetupInfo}</Text> : null}
                {baseStationSetupError ? <Text style={styles.errorText}>{baseStationSetupError}</Text> : null}

                <View style={styles.buttonStack}>
                  <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={inspectBaseStationSetup} disabled={baseStationSetupBusy}>
                    <Text style={styles.actionPrimaryText}>Check Setup Network</Text>
                  </Pressable>
                  <Pressable style={styles.actionButton} onPress={saveBaseStationSetup} disabled={baseStationSetupBusy}>
                    <Text style={styles.actionSecondaryText}>Save Setup to Base Station</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
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
    maxHeight: '88%',
  },
  modalScrollContent: {
    paddingBottom: 6,
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
  modalHintText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: '#5f7893',
  },
  modalStepRow: {
    marginTop: 14,
    gap: 10,
  },
  modalStepCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dce6f0',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    backgroundColor: '#2f76c1',
    lineHeight: 24,
  },
  modalStepText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#35506a',
    fontWeight: '700',
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
  readOnlyField: {
    borderWidth: 1,
    borderColor: '#d7e2ee',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#eef4fb',
  },
  readOnlyFieldText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#21466d',
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
  setupSection: {
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#dce6f0',
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#213c5a',
  },
  inlineStrong: {
    fontWeight: '800',
    color: '#315781',
  },
  setupStatusCard: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#f4f8fc',
    borderWidth: 1,
    borderColor: '#d7e2ee',
  },
  setupStatusTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#21466d',
  },
  setupStatusText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#5f7893',
  },
  infoText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: '#2d8a65',
  },
});














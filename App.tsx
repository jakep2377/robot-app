import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
        label: 'Field backend',
        status: 'connected' as const,
        detail: `Connected to field backend in ${local.success.latencyMs} ms`,
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
        label: 'Remote fallback',
        status: 'fallback' as const,
        detail: `Using remote backend in ${cloud.latencyMs} ms`,
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

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [connection, setConnection] = useState<ConnectionState>({
    serverUrl: DEFAULT_CLOUD_SERVER_URL,
    mode: 'discovering',
    label: 'Finding field backend',
    status: 'connecting',
    detail: 'Looking for a nearby field backend first.',
  });
  const [manualServerUrl, setManualServerUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [connectionModalVisible, setConnectionModalVisible] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [baseStationUrl, setBaseStationUrl] = useState('http://192.168.4.1');
  const [baseStationWifiSsid, setBaseStationWifiSsid] = useState('');
  const [baseStationWifiPassword, setBaseStationWifiPassword] = useState('');
  const [baseStationBackendUrl, setBaseStationBackendUrl] = useState(DEFAULT_CLOUD_SERVER_URL);
  const [baseStationSetupBusy, setBaseStationSetupBusy] = useState(false);
  const [baseStationSetupError, setBaseStationSetupError] = useState<string | null>(null);
  const [baseStationSetupInfo, setBaseStationSetupInfo] = useState<string | null>(null);
  const [baseStationSetupStatus, setBaseStationSetupStatus] = useState<BaseStationSetupStatus | null>(null);
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

    setBaseStationSetupBusy(true);
    setBaseStationSetupError(null);
    setBaseStationSetupInfo(null);
    try {
      const response = await configureBaseStationSetup(baseStationUrl, {
        ssid: baseStationWifiSsid.trim(),
        password: baseStationWifiPassword,
        backendUrl: baseStationBackendUrl.trim() || serverUrl,
      });
      setBaseStationSetupInfo(response.message ?? 'Wi-Fi saved. The base station is restarting into normal mode.');
      setBaseStationSetupStatus((previous) => ({
        ...(previous ?? {}),
        configured: true,
        savedSsid: baseStationWifiSsid.trim(),
        backendUrl: baseStationBackendUrl.trim() || serverUrl,
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
      label: 'Manual backend',
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
      setConnectionError(result.error ?? 'Remote fallback is not reachable.');
      return;
    }

    setServerUrl(result.serverUrl);
    setManualServerUrl(result.serverUrl);
    setConnection({
      serverUrl: result.serverUrl,
      mode: 'cloud',
      label: 'Remote fallback',
      status: 'fallback',
      detail: `Using remote backend in ${result.latencyMs} ms`,
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
    ? 'Join SaltRobot_Base, then tap Check Setup AP.'
    : baseStationSetupInfo
      ? 'Reconnect your phone to the normal network, then tap Find Field Backend.'
      : baseStationSetupStatus
        ? 'The base station AP is responding. Save Wi-Fi to move it onto your normal network.'
        : 'Use this section only while your phone is connected to SaltRobot_Base.';
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
                  connectionLabel={connection.label}
                  connectionStatus={connection.status}
                  connectionDetail={connection.detail}
                  connectionMode={connection.mode}
                  connectionBusy={connectionBusy}
                  onOpenConnection={() => setConnectionModalVisible(true)}
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

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.modalBodyText}>
                The app connects to the backend server only. The backend server is responsible for talking to the base station.
              </Text>
              <Text style={styles.modalStatus}>Current: {connection.label}</Text>
              <Text style={styles.modalDetail}>{connection.detail}</Text>

              <Text style={styles.inputLabel}>Manual backend URL</Text>
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
                  <Text style={styles.actionPrimaryText}>Find Field Backend</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={saveManualServer} disabled={connectionBusy}>
                  <Text style={styles.actionSecondaryText}>Use Manual Address</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={useCloudFallback} disabled={connectionBusy}>
                  <Text style={styles.actionSecondaryText}>Use Remote Fallback</Text>
                </Pressable>
              </View>

              <View style={styles.setupSection}>
                <Text style={styles.setupTitle}>Base Station Setup</Text>
                <Text style={styles.modalBodyText}>
                  Connect your phone to <Text style={styles.inlineStrong}>SaltRobot_Base</Text>, then use this section to save the Wi-Fi and backend that the base station should use automatically.
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

                <Text style={styles.inputLabel}>Wi-Fi name</Text>
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

                <Text style={styles.inputLabel}>Backend URL for the base station</Text>
                <TextInput
                  style={styles.input}
                  value={baseStationBackendUrl}
                  onChangeText={setBaseStationBackendUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://robot-lora-server.onrender.com"
                  placeholderTextColor="#8aa0b7"
                />

                {baseStationSetupStatus ? (
                  <View style={styles.setupStatusCard}>
                    <Text style={styles.setupStatusTitle}>Setup AP detected</Text>
                    <Text style={styles.setupStatusText}>Mode: {baseStationSetupStatus.mode ?? 'unknown'} | Saved Wi-Fi: {baseStationSetupStatus.savedSsid || 'none yet'}</Text>
                    <Text style={styles.setupStatusText}>Backend: {baseStationSetupStatus.backendUrl || 'default'}</Text>
                  </View>
                ) : null}

                {baseStationSetupInfo ? <Text style={styles.infoText}>{baseStationSetupInfo}</Text> : null}
                {baseStationSetupError ? <Text style={styles.errorText}>{baseStationSetupError}</Text> : null}

                <View style={styles.buttonStack}>
                  <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={inspectBaseStationSetup} disabled={baseStationSetupBusy}>
                    <Text style={styles.actionPrimaryText}>Check Setup AP</Text>
                  </Pressable>
                  <Pressable style={styles.actionButton} onPress={saveBaseStationSetup} disabled={baseStationSetupBusy}>
                    <Text style={styles.actionSecondaryText}>Save Wi-Fi to Base Station</Text>
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














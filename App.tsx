import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ControllerScreen from './App/screens/ControllerScreen';
import AreaMapScreen from './App/screens/AreaMapScreen';
import WeatherScreen from './App/screens/WeatherScreen';
import HelpPane from './App/components/common/HelpPane';

const Tab = createBottomTabNavigator();
const DEFAULT_SERVER_URL = 'https://robot-lora-server.onrender.com';

// Bottom tabs
export default function App() {
  const [serverUrl] = useState(DEFAULT_SERVER_URL);
  const [saltPct, setSaltPct] = useState(100);
  const [brinePct, setBrinePct] = useState(100);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#1f5f9f',
          tabBarInactiveTintColor: '#6b7f93',
          tabBarIconStyle: {
            marginTop: 2,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '700',
          },
          tabBarStyle: {
            backgroundColor: '#f8fbff',
            borderTopColor: '#d7e2ee',
            borderTopWidth: 1,
            height: 64,
            paddingTop: 6,
            paddingBottom: 8,
          },
        }}
      >
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
            )
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
    </SafeAreaProvider>
  );
}

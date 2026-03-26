import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

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
  const darkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar style={darkMode ? 'light' : 'dark'} translucent backgroundColor="transparent" />
      <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: darkMode ? '#9fd0ff' : '#1f5f9f',
          tabBarInactiveTintColor: darkMode ? '#7f97b2' : '#6b7f93',
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '700',
          },
          tabBarStyle: {
            backgroundColor: darkMode ? '#142233' : '#f8fbff',
            borderTopColor: darkMode ? '#2b3e54' : '#d7e2ee',
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
              <Text style={{ color, fontSize: size }}>🎮</Text>
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
              darkMode={darkMode}
            />
          )}
        </Tab.Screen>
        <Tab.Screen
          name="Area Map"
          options={{
            tabBarLabel: 'Area Map',
            tabBarIcon: ({ color, size }) => (
              <Text style={{ color, fontSize: size }}>🗺️</Text>
            )
          }}
        >
          {() => <AreaMapScreen serverUrl={serverUrl} saltPct={saltPct} brinePct={brinePct} darkMode={darkMode} />}
        </Tab.Screen>
        <Tab.Screen
          name="Weather"
          options={{
            tabBarLabel: 'Weather',
            tabBarIcon: ({ color, size }) => (
              <Text style={{ color, fontSize: size }}>❄️</Text>
            ),
          }}
        >
          {() => (
            <WeatherScreen
              saltPct={saltPct}
              brinePct={brinePct}
              setSaltPct={setSaltPct}
              setBrinePct={setBrinePct}
              darkMode={darkMode}
            />
          )}
        </Tab.Screen>
        <Tab.Screen
          name="Help"
          options={{
            tabBarLabel: 'Help',
            tabBarIcon: ({ color, size }) => (
              <Text style={{ color, fontSize: size }}>❓</Text>
            ),
          }}
        >
          {() => <HelpPane visible={true} onClose={() => {}} darkMode={darkMode} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
    </SafeAreaProvider>
  );
}

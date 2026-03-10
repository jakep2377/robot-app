import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View, Text } from 'react-native';  

import ControllerScreen from './App/screens/ControllerScreen';
import AreaMapScreen from './App/screens/AreaMapScreen';
import WeatherScreen from './App/screens/WeatherScreen';

const Tab = createBottomTabNavigator();

// Bottom tabs
export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tab.Screen name="Controller" component={ControllerScreen}
        options={{
          tabBarLabel: 'Controller',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size }}>🎮</Text>
          ),
        }} />
        <Tab.Screen name="Area Map" component={AreaMapScreen}
        options={{
          tabBarLabel: 'Area Map',
          tabBarIcon: ({color, size}) => (
            <Text style={{ color, fontSize: size }}>🗺️</Text>
          )
        }} />
        <Tab.Screen name="Weather" component={WeatherScreen}
        options={{
          tabBarLabel: 'Weather',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size }}>❄️</Text>
          ),
        }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

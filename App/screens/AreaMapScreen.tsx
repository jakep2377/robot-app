import {View, Text} from 'react-native';
import React from 'react';
import GoogleMapView from '../components/home/GoogleMapView';

export default function AreaMapScreen() {
  return (
    <View style={{ flex: 1 }}>
      <GoogleMapView />
    </View>
  );
}
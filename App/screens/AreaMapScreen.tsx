import {View} from 'react-native';
import React from 'react';
import GoogleMapView from '../components/home/GoogleMapView';

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  darkMode: boolean;
};

export default function AreaMapScreen({ serverUrl, saltPct, brinePct, darkMode }: Props) {
  return (
    <View style={{ flex: 1 }}>
      <GoogleMapView serverUrl={serverUrl} saltPct={saltPct} brinePct={brinePct} darkMode={darkMode} />
    </View>
  );
}
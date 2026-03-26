import {View} from 'react-native';
import React from 'react';
import GoogleMapView from '../components/home/GoogleMapView';

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
};

export default function AreaMapScreen({ serverUrl, saltPct, brinePct }: Props) {
  return (
    <View style={{ flex: 1 }}>
      <GoogleMapView serverUrl={serverUrl} saltPct={saltPct} brinePct={brinePct} />
    </View>
  );
}
import { StyleSheet, View } from 'react-native';
import React from 'react';
import GoogleMapView from '../components/home/GoogleMapView';

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  demoPathPoints?: unknown[];
};

export default function AreaMapScreen({ serverUrl, saltPct, brinePct, demoPathPoints = [] }: Props) {
  return (
    <View style={styles.container}>
      <GoogleMapView serverUrl={serverUrl} saltPct={saltPct} brinePct={brinePct} demoPathPoints={demoPathPoints} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
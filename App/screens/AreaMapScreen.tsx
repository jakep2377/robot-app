/**
 * Thin screen wrapper around the map/planner view.
 * The heavy lifting stays in GoogleMapView so navigation stays simple.
 */
import { StyleSheet, View } from 'react-native';
import React from 'react';
import GoogleMapView from '../components/home/GoogleMapView';
import type { DemoPathPoint } from '../lib/plannerTypes';

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  demoPathPoints?: DemoPathPoint[];
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

import React, { useRef, useState } from 'react';
import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { MapPressEvent, PROVIDER_GOOGLE, Polygon, LatLng, Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { postJson } from '../../lib/serverApi';

type RectangleSelection = {
  baseStation: LatLng;
  goal: LatLng;
  boundary: LatLng[];
};

type PlannedPoint = {
  lat: number;
  lon: number;
};

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
};

function GoogleMapView({ serverUrl, saltPct, brinePct }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [firstPoint, setFirstPoint] = useState<LatLng | null>(null);
  const [selection, setSelection] = useState<RectangleSelection | null>(null);
  const [plannedPath, setPlannedPath] = useState<LatLng[]>([]);
  const [plannedPathDistanceM, setPlannedPathDistanceM] = useState(0);
  const [areaSubmitted, setAreaSubmitted] = useState(false);
  const [message, setMessage] = useState('Tap Draw Area, then choose the first corner and opposite corner.');
  const [busy, setBusy] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');

  const theme = {
    overlayBg: 'rgba(248,251,255,0.95)',
    overlayBorder: '#d9e4f0',
    text: '#16324f',
    muted: '#35506a',
  };

  const resetPlanningState = () => {
    setAreaSubmitted(false);
    setPlannedPath([]);
    setPlannedPathDistanceM(0);
  };

  const haversineDistanceMeters = (a: LatLng, b: LatLng) => {
    const earthRadiusM = 6371000;
    const lat1 = a.latitude * (Math.PI / 180);
    const lat2 = b.latitude * (Math.PI / 180);
    const dLat = (b.latitude - a.latitude) * (Math.PI / 180);
    const dLon = (b.longitude - a.longitude) * (Math.PI / 180);

    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const aCalc = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
    const c = 2 * Math.atan2(Math.sqrt(aCalc), Math.sqrt(1 - aCalc));
    return earthRadiusM * c;
  };

  const computePathDistanceMeters = (points: LatLng[]) => {
    if (points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineDistanceMeters(points[i - 1], points[i]);
    }
    return total;
  };

  const updateSelectionFromBoundary = (boundary: LatLng[]) => {
    if (boundary.length !== 4) return;
    setSelection({
      boundary,
      baseStation: boundary[0],
      goal: boundary[2],
    });
    resetPlanningState();
  };

  const applyCorner = (corner: LatLng) => {
    if (!drawingMode) return;

    if (!firstPoint) {
      setFirstPoint(corner);
      setMessage('First corner captured. Set the opposite corner to finish the area.');
      return;
    }

    const secondPoint = corner;

    const rect = [
      { latitude: firstPoint.latitude, longitude: firstPoint.longitude },
      { latitude: firstPoint.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: firstPoint.longitude },
    ];

    const nextSelection = {
      baseStation: firstPoint,
      goal: secondPoint,
      boundary: rect,
    };

    setSelection(nextSelection);
    resetPlanningState();
    setMessage('Area captured. Submit the boundary, then plan a path to the opposite corner.');
    setDrawingMode(false);
    setFirstPoint(null);

    requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(nextSelection.boundary, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    });
  };

  const handleMapPress = (e: MapPressEvent) => {
    if (!drawingMode) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    applyCorner({ latitude, longitude });
  };

  const zoomBy = async (delta: number) => {
    if (!mapRef.current) return;
    try {
      const camera = await mapRef.current.getCamera();
      const currentZoom = typeof camera.zoom === 'number' ? camera.zoom : 18;
      const nextZoom = Math.max(2, Math.min(22, currentZoom + delta));
      mapRef.current.animateCamera({ ...camera, zoom: nextZoom }, { duration: 180 });
    } catch {
      setMessage('Zoom update failed. Try panning and pressing + / - again.');
    }
  };

  const moveBoundaryCorner = (index: number, nextCoordinate: LatLng) => {
    if (!selection) return;
    const nextBoundary = selection.boundary.map((point, pointIndex) => (
      pointIndex === index ? nextCoordinate : point
    ));
    updateSelectionFromBoundary(nextBoundary);
    setMessage('Corner adjusted. Submit area or plan path when ready.');
  };

  const toggleMapType = () => {
    setMapType((prevType) => {
      const nextType = prevType === 'standard' ? 'satellite' : 'standard';
      setMessage(`Map type switched to ${nextType}.`);
      return nextType;
    });
  };

  const submitArea = async () => {
    if (!selection) {
      return;
    }

    setBusy('area');
    try {
      await postJson(serverUrl, '/api/input-area', {
        baseStation: {
          lat: selection.baseStation.latitude,
          lon: selection.baseStation.longitude,
        },
        boundary: selection.boundary.map((point) => ({
          lat: point.latitude,
          lon: point.longitude,
        })),
        cellSizeM: 2,
      });
      setAreaSubmitted(true);
      setMessage('Area uploaded to the server. You can plan the mission path now.');
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Failed to submit area.');
    } finally {
      setBusy(null);
    }
  };

  const planPath = async () => {
    if (!selection) {
      return;
    }
    if (!areaSubmitted) {
      setMessage('Submit Area first, then plan path.');
      return;
    }

    setBusy('path');
    try {
      const result = await postJson<{ ok: boolean; points: PlannedPoint[] }>(serverUrl, '/api/path/plan', {
        start: {
          lat: selection.baseStation.latitude,
          lon: selection.baseStation.longitude,
        },
        goal: {
          lat: selection.goal.latitude,
          lon: selection.goal.longitude,
        },
        saltPct,
        brinePct,
      });

      const points = (result?.points ?? []).map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
      }));

      setPlannedPath(points);
      const totalDistanceM = computePathDistanceMeters(points);
      setPlannedPathDistanceM(totalDistanceM);

      if (points.length > 1) {
        requestAnimationFrame(() => {
          mapRef.current?.fitToCoordinates(points, {
            edgePadding: { top: 110, right: 90, bottom: 220, left: 90 },
            animated: true,
          });
        });
      }

      setMessage(`Path planned (${points.length} points, ${(totalDistanceM / 1000).toFixed(2)} km) with salt ${Math.round(saltPct)}% and brine ${Math.round(brinePct)}%.`);
    } catch (requestError) {
      setPlannedPath([]);
      setPlannedPathDistanceM(0);
      setMessage(requestError instanceof Error ? requestError.message : 'Failed to plan path.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        mapType={mapType}
        initialRegion={{
          latitude: 41.0731,
          longitude: -81.5171,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        maxZoomLevel={22}
        minZoomLevel={2}
        onPress={handleMapPress}
        zoomEnabled={true}
        scrollEnabled={true}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {selection && (
          <>
            <Polygon
              coordinates={selection.boundary}
              strokeColor="blue"
              fillColor="rgba(0,0,255,0.3)"
              strokeWidth={2}
            />
            {selection.boundary.map((point, index) => (
              <Marker
                key={`corner-${index}`}
                coordinate={point}
                draggable
                pinColor={index === 0 ? '#2d8a65' : index === 2 ? '#b63d3d' : '#2c6fb7'}
                title={index === 0 ? 'Base Corner' : index === 2 ? 'Goal Corner' : 'Boundary Corner'}
                onDragEnd={(event) => moveBoundaryCorner(index, event.nativeEvent.coordinate)}
              />
            ))}
            {plannedPath.length > 1 ? (
              <Polyline
                coordinates={plannedPath}
                strokeColor="#8a3dd1"
                strokeWidth={4}
              />
            ) : null}
          </>
        )}
      </MapView>

      <View style={[styles.zoomStack, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}> 
        <Button title="+" onPress={() => zoomBy(1)} />
        <View style={styles.smallGap}>
          <Button title="-" onPress={() => zoomBy(-1)} />
        </View>
      </View>

      <View style={[styles.mapTypeToggle, { top: insets.top + 70 }]}> 
        <Pressable onPress={toggleMapType} style={styles.mapTypeAction}>
          <Text style={styles.mapTypeActionText}>{mapType === 'standard' ? 'Satellite' : 'Standard'}</Text>
        </Pressable>
      </View>

      <View style={[styles.modeChip, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}> 
        <Text style={[styles.modeChipText, { color: drawingMode ? '#1d7f4a' : theme.muted }]}> 
          {drawingMode ? '\u270f Drawing' : (selection ? '\u2713 Area Set' : '\u25cf Browse')}
        </Text>
        <Text style={[styles.modeChipSub, { color: theme.muted }]}>
          🧂{saltPct}% · 💧{brinePct}%
        </Text>
      </View>

      <View style={[styles.overlay, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, bottom: insets.bottom + 14 }]}> 
        <Text style={[styles.overlayText, { color: theme.text }]}>{message}</Text>
        <Text style={styles.stepText}>1) Draw area  2) Submit area  3) Plan path</Text>
        {plannedPath.length > 1 ? (
          <Text style={styles.pathMetaText}>Planned path: {plannedPath.length} points • {(plannedPathDistanceM / 1000).toFixed(2)} km</Text>
        ) : null}
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => {
              setSelection(null);
              resetPlanningState();
              setDrawingMode(true);
              setFirstPoint(null);
              setMessage('Tap the base-station corner first, then the opposite corner.');
            }}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>{drawingMode ? 'Drawing…' : 'Draw Area'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setSelection(null);
              resetPlanningState();
              setFirstPoint(null);
              setDrawingMode(false);
              setMessage('Area cleared. Draw a new boundary when ready.');
            }}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Clear</Text>
          </Pressable>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={submitArea}
            disabled={!selection || busy !== null}
            style={[
              styles.statefulButton,
              styles.actionFill,
              !selection || busy !== null
                ? styles.buttonDisabled
                : areaSubmitted
                  ? styles.buttonDone
                  : styles.buttonReady,
            ]}
          >
            <Text style={styles.statefulButtonText}>
              {busy === 'area'
                ? 'Submitting Area...'
                : areaSubmitted
                  ? 'Area Submitted'
                  : 'Submit Area'}
            </Text>
          </Pressable>
          <Pressable
            onPress={planPath}
            disabled={!selection || !areaSubmitted || busy !== null}
            style={[
              styles.statefulButton,
              styles.actionFill,
              !selection || !areaSubmitted || busy !== null
                ? styles.buttonDisabled
                : styles.buttonPlan,
            ]}
          >
            <Text style={styles.statefulButtonText}>
              {busy === 'path' ? 'Planning Path...' : 'Plan Path'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default GoogleMapView;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    backgroundColor: 'rgba(248,251,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 14,
    padding: 14,
  },
  zoomStack: {
    position: 'absolute',
    right: 16,
    top: 70,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 12,
    padding: 8,
  },
  modeChip: {
    position: 'absolute',
    left: 16,
    top: 64,
    width: 120,
    backgroundColor: 'rgba(248,251,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 2,
  },
  mapTypeToggle: {
    position: 'absolute',
    left: 16,
    width: 120,
    borderRadius: 10,
    zIndex: 20,
  },
  mapTypeAction: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b8c5d3',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7fafc',
    paddingHorizontal: 8,
  },
  mapTypeActionText: {
    color: '#1f3550',
    fontWeight: '700',
    fontSize: 11,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#35506a',
  },
  modeChipSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6a87a2',
  },
  smallGap: {
    marginTop: 8,
  },
  overlayText: {
    marginBottom: 6,
    color: '#16324f',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  stepText: {
    color: '#4f6275',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionFill: {
    flex: 1,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#b8c5d3',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7fafc',
  },
  secondaryActionText: {
    color: '#1f3550',
    fontWeight: '700',
  },
  coordinateText: {
    color: '#1f3550',
    fontWeight: '700',
    marginBottom: 6,
    fontSize: 12,
  },
  pathMetaText: {
    color: '#6a3a9f',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '600',
  },
  buttonGap: {
    marginTop: 10,
  },
  statefulButton: {
    borderRadius: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  statefulButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  buttonReady: {
    backgroundColor: '#2d8a65',
  },
  buttonDone: {
    backgroundColor: '#1e6d4f',
  },
  buttonPlan: {
    backgroundColor: '#2c6fb7',
  },
  buttonDisabled: {
    backgroundColor: '#9eabb8',
  },
});

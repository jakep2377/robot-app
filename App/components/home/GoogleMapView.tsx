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
  darkMode: boolean;
};

function GoogleMapView({ serverUrl, saltPct, brinePct, darkMode }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [centerPickMode, setCenterPickMode] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [nudgeTarget, setNudgeTarget] = useState<'box' | 'map'>('box');
  const [firstPoint, setFirstPoint] = useState<LatLng | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng>({ latitude: 41.0731, longitude: -81.5171 });
  const [mapDelta, setMapDelta] = useState({ latitudeDelta: 0.01, longitudeDelta: 0.01 });
  const [selection, setSelection] = useState<RectangleSelection | null>(null);
  const [plannedPath, setPlannedPath] = useState<LatLng[]>([]);
  const [plannedPathDistanceM, setPlannedPathDistanceM] = useState(0);
  const [areaSubmitted, setAreaSubmitted] = useState(false);
  const [message, setMessage] = useState('Tap Draw Area, then choose a base corner and opposite corner.');
  const [busy, setBusy] = useState<string | null>(null);
  const theme = darkMode
    ? {
        overlayBg: 'rgba(19,30,43,0.95)',
        overlayBorder: '#2b3d52',
        text: '#d7e7f8',
        muted: '#9db4cc',
        panelBg: '#142233',
        panelBorder: '#2a3c53',
        toggleBg: '#213246',
        toggleText: '#d2e5f9',
      }
    : {
        overlayBg: 'rgba(248,251,255,0.95)',
        overlayBorder: '#d9e4f0',
        text: '#16324f',
        muted: '#35506a',
        panelBg: '#f8fbff',
        panelBorder: '#d8e0ea',
        toggleBg: '#e9eff5',
        toggleText: '#1f3550',
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
    setCenterPickMode(false);
    setFirstPoint(null);

    requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(nextSelection.boundary, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    });
  };

  const handleMapPress = (e: MapPressEvent) => {
    if (!drawingMode || centerPickMode) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    applyCorner({ latitude, longitude });
  };

  const setCornerFromCenter = () => {
    applyCorner(mapCenter);
  };

  const isPrecisionPanelActive = showAdvancedControls && drawingMode && centerPickMode;

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

  // Note: Pinch zoom is now enabled on MapView with zoomEnabled={true}
  // Users can pinch on Android/iOS to zoom; single finger drag to pan
  const nudgeCenter = async (latDirection: number, lonDirection: number) => {
    const latStep = Math.max(0.000001, mapDelta.latitudeDelta * 0.08);
    const lonStep = Math.max(0.000001, mapDelta.longitudeDelta * 0.08);
    const shouldNudgeBox = nudgeTarget === 'box';

    if (shouldNudgeBox && selection) {
      const nextBoundary = selection.boundary.map((point) => ({
        latitude: point.latitude + latDirection * latStep,
        longitude: point.longitude + lonDirection * lonStep,
      }));
      updateSelectionFromBoundary(nextBoundary);
      setMessage('Boundary nudged. Submit area or plan path when ready.');
      return;
    }

    if (shouldNudgeBox && firstPoint) {
      const nextFirstPoint = {
        latitude: firstPoint.latitude + latDirection * latStep,
        longitude: firstPoint.longitude + lonDirection * lonStep,
      };
      setFirstPoint(nextFirstPoint);
      setMessage('First corner nudged. Set the opposite corner when ready.');
      return;
    }

    if (!mapRef.current) return;

    const nextCenter = {
      latitude: mapCenter.latitude + latDirection * latStep,
      longitude: mapCenter.longitude + lonDirection * lonStep,
    };

    setMapCenter(nextCenter);
    mapRef.current.animateCamera({ center: nextCenter }, { duration: 140 });
  };

  const moveBoundaryCorner = (index: number, nextCoordinate: LatLng) => {
    if (!selection) return;
    const nextBoundary = selection.boundary.map((point, pointIndex) => (
      pointIndex === index ? nextCoordinate : point
    ));
    updateSelectionFromBoundary(nextBoundary);
    setMessage('Corner adjusted. Submit area or plan path when ready.');
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
        initialRegion={{
          latitude: 41.0731,
          longitude: -81.5171,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        maxZoomLevel={22}
        minZoomLevel={2}
        onRegionChangeComplete={(region) => {
          setMapCenter({ latitude: region.latitude, longitude: region.longitude });
          setMapDelta({ latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta });
        }}
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
              fillColor={isPrecisionPanelActive ? 'rgba(0,0,255,0.14)' : 'rgba(0,0,255,0.3)'}
              strokeWidth={isPrecisionPanelActive ? 1.5 : 2}
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
            {plannedPath.length > 1 && !isPrecisionPanelActive ? (
              <Polyline
                coordinates={plannedPath}
                strokeColor="#8a3dd1"
                strokeWidth={4}
              />
            ) : null}
          </>
        )}
      </MapView>

      {centerPickMode && drawingMode ? (
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <View style={styles.crosshairHorizontal} />
          <View style={styles.crosshairVertical} />
        </View>
      ) : null}

      <View style={[styles.zoomStack, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}> 
        <Button title="+" onPress={() => zoomBy(1)} />
        <View style={styles.smallGap}>
          <Button title="-" onPress={() => zoomBy(-1)} />
        </View>
      </View>

      <View style={[styles.modeChip, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}>
        <Text style={[styles.modeChipText, { color: drawingMode ? '#1d7f4a' : theme.muted }]}>
          {drawingMode
            ? (centerPickMode ? '\u271b Precision' : '\u270f Drawing')
            : (selection ? '\u2713 Area Set' : '\u25cf Browse')}
        </Text>
        <Text style={[styles.modeChipSub, { color: theme.muted }]}>
          🧂{saltPct}% · 💧{brinePct}%
        </Text>
      </View>

      <View style={[styles.overlay, isPrecisionPanelActive ? styles.overlayCompact : null, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, bottom: insets.bottom + 14 }]}>
        <Text style={[styles.overlayText, { color: theme.text }]}>{message}</Text>
        {!isPrecisionPanelActive ? (
          <>
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
                  setCenterPickMode(false);
                  setShowAdvancedControls(false);
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
                  setCenterPickMode(false);
                  setShowAdvancedControls(false);
                  setMessage('Area cleared. Draw a new boundary when ready.');
                }}
                style={styles.secondaryAction}
              >
                <Text style={styles.secondaryActionText}>Clear</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={[styles.compactHintText, { color: theme.muted }]}>
            Precision mode active: nudge target is {nudgeTarget === 'box' ? 'Boundary Box' : 'Map Center'}.
          </Text>
        )}

        <View style={styles.buttonGapCompact}>
          <Pressable
            onPress={() => {
              if (!drawingMode) {
                setDrawingMode(true);
                setFirstPoint(null);
              }
              setShowAdvancedControls((current) => !current);
            }}
            style={[styles.advancedToggle, { backgroundColor: theme.toggleBg }]}
          >
            <Text style={[styles.advancedToggleText, { color: theme.toggleText }]}>
              {showAdvancedControls ? 'Hide Precision Tools' : 'Show Precision Tools'}
            </Text>
          </Pressable>
        </View>

        {showAdvancedControls ? (
          <View style={[styles.advancedPanel, { backgroundColor: theme.panelBg, borderColor: theme.panelBorder }]}>
            <Text style={[styles.coordinateText, { color: theme.text }]}>
              Center: {mapCenter.latitude.toFixed(7)}, {mapCenter.longitude.toFixed(7)}
            </Text>
            <View style={styles.nudgeTargetRow}>
              <Pressable
                onPress={() => {
                  setNudgeTarget('box');
                  setMessage('Nudge target set to boundary box.');
                }}
                style={[styles.nudgeTargetButton, nudgeTarget === 'box' ? styles.nudgeTargetButtonActive : null]}
              >
                <Text style={[styles.nudgeTargetButtonText, nudgeTarget === 'box' ? styles.nudgeTargetButtonTextActive : null]}>
                  Nudge Box
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setNudgeTarget('map');
                  setMessage('Nudge target set to map center.');
                }}
                style={[styles.nudgeTargetButton, nudgeTarget === 'map' ? styles.nudgeTargetButtonActive : null]}
              >
                <Text style={[styles.nudgeTargetButtonText, nudgeTarget === 'map' ? styles.nudgeTargetButtonTextActive : null]}>
                  Nudge Map
                </Text>
              </Pressable>
            </View>
            <View style={styles.buttonGapCompact}>
              <Button
                title={centerPickMode ? 'Tap Mode (Finger)' : 'Precision Mode (Crosshair)'}
                onPress={() => {
                  if (!drawingMode) {
                    setDrawingMode(true);
                    setFirstPoint(null);
                  }
                  setCenterPickMode((current) => !current);
                  setMessage('Precision mode uses map center crosshair. Pan/zoom, then set corner.');
                }}
              />
            </View>
            {drawingMode && centerPickMode ? (
              <>
                <View style={styles.buttonGapCompact}>
                  <Button title={firstPoint ? 'Set Opposite Corner (Center)' : 'Set First Corner (Center)'} onPress={setCornerFromCenter} />
                </View>
                <View style={styles.nudgeGrid}>
                  <View style={styles.nudgeRowCenter}>
                    <Button title="Up" onPress={() => nudgeCenter(1, 0)} />
                  </View>
                  <View style={styles.nudgeRowSides}>
                    <Button title="Left" onPress={() => nudgeCenter(0, -1)} />
                    <Button title="Right" onPress={() => nudgeCenter(0, 1)} />
                  </View>
                  <View style={styles.nudgeRowCenter}>
                    <Button title="Down" onPress={() => nudgeCenter(-1, 0)} />
                  </View>
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {!isPrecisionPanelActive ? (
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
                    : 'Submit Area (Ready)'}
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
        ) : null}
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
  overlayCompact: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    padding: 10,
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
    top: 70,
    backgroundColor: 'rgba(248,251,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 2,
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
  crosshairWrap: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 34,
    height: 2,
    backgroundColor: '#d11f1f',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 34,
    backgroundColor: '#d11f1f',
  },
  overlayText: {
    marginBottom: 6,
    color: '#16324f',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  compactHintText: {
    color: '#35506a',
    fontSize: 12,
    marginBottom: 4,
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
  buttonGapCompact: {
    marginTop: 8,
  },
  advancedToggle: {
    minHeight: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e9eff5',
  },
  advancedToggleText: {
    color: '#1f3550',
    fontWeight: '700',
    fontSize: 12,
  },
  advancedPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#d8e0ea',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#f8fbff',
  },
  nudgeTargetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  nudgeTargetButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfd0e2',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff4fa',
  },
  nudgeTargetButtonActive: {
    borderColor: '#2c6fb7',
    backgroundColor: '#dceaf8',
  },
  nudgeTargetButtonText: {
    color: '#33516d',
    fontWeight: '700',
    fontSize: 12,
  },
  nudgeTargetButtonTextActive: {
    color: '#1d4f86',
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
  nudgeGrid: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#d8e0ea',
    borderRadius: 10,
    padding: 8,
    gap: 8,
  },
  nudgeRowCenter: {
    alignItems: 'center',
  },
  nudgeRowSides: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 10,
  },
});

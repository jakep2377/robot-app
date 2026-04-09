import React, { useRef, useState } from 'react';
import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { LatLng, MapPressEvent, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getJson, postJson } from '../../lib/serverApi';
import AppButton from '../common/AppButton';

type RectangleSelection = {
  baseStation: LatLng;
  goal: LatLng;
  boundary: LatLng[];
};

type PlannedPoint = {
  lat: number;
  lon: number;
  headingDeg?: number | null;
};

type PlannedCoordinate = {
  latitude: number;
  longitude: number;
  headingDeg?: number | null;
};

type CoverageCell = {
  row: number;
  col: number;
  covered: boolean;
  hits: number;
  lastSeenMs: number;
  polygon: LatLng[];
};

type CoverageResponse = {
  ok: boolean;
  grid: {
    width: number;
    height: number;
    cellSizeM: number;
    cells: Array<{
      row: number;
      col: number;
      covered: boolean;
      hits: number;
      lastSeenMs: number;
      polygon: Array<{ lat: number; lon: number }>;
    }>;
  };
};

type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
};

export default function GoogleMapView({ serverUrl, saltPct, brinePct }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [firstPoint, setFirstPoint] = useState<LatLng | null>(null);
  const [selection, setSelection] = useState<RectangleSelection | null>(null);
  const [plannedPath, setPlannedPath] = useState<PlannedCoordinate[]>([]);
  const [plannedPathDistanceM, setPlannedPathDistanceM] = useState(0);
  const [coverageCells, setCoverageCells] = useState<CoverageCell[]>([]);
  const [areaSubmitted, setAreaSubmitted] = useState(false);
  const [message, setMessage] = useState('Tap Draw Area, then pick two corners.');
  const [busy, setBusy] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');

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
    setCoverageCells([]);
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

  const computePathDistanceMeters = (points: Array<LatLng | PlannedCoordinate>) => {
    if (points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineDistanceMeters(points[i - 1], points[i]);
    }
    return total;
  };

  const getSelectionMetrics = () => {
    if (!selection) return { widthM: 0, heightM: 0, areaM2: 0 };
    const widthA = haversineDistanceMeters(selection.boundary[0], selection.boundary[1]);
    const widthB = haversineDistanceMeters(selection.boundary[2], selection.boundary[3]);
    const heightA = haversineDistanceMeters(selection.boundary[1], selection.boundary[2]);
    const heightB = haversineDistanceMeters(selection.boundary[3], selection.boundary[0]);
    const widthM = (widthA + widthB) / 2;
    const heightM = (heightA + heightB) / 2;
    return { widthM, heightM, areaM2: widthM * heightM };
  };

  const buildPathArrowPoints = (points: PlannedCoordinate[]) => {
    const arrows: PlannedCoordinate[] = [];
    const headingToleranceDeg = 12;
    const { areaM2 } = getSelectionMetrics();
    const arrowSpacingM = areaM2 > 12000 ? 36 : areaM2 > 4000 ? 24 : areaM2 > 1600 ? 16 : 10;
    const minSegmentLengthM = arrowSpacingM * 0.9;
    let segmentStart = 0;

    const flushSegment = (startIndex: number, endIndex: number) => {
      if (endIndex <= startIndex) return;

      const cumulativeDistances = [0];
      let segmentLengthM = 0;
      for (let i = startIndex + 1; i <= endIndex; i++) {
        segmentLengthM += haversineDistanceMeters(points[i - 1], points[i]);
        cumulativeDistances.push(segmentLengthM);
      }
      if (segmentLengthM < minSegmentLengthM) return;

      const arrowCount = Math.max(1, Math.floor(segmentLengthM / arrowSpacingM));
      const spacing = segmentLengthM / arrowCount;

      for (let arrowIndex = 0; arrowIndex < arrowCount; arrowIndex++) {
        const targetDistance = spacing * (arrowIndex + 0.5);
        let bestPoint: PlannedCoordinate | null = null;
        let bestDistanceDelta = Number.POSITIVE_INFINITY;

        for (let offset = 0; offset < cumulativeDistances.length; offset++) {
          const candidate = points[startIndex + offset];
          if (typeof candidate.headingDeg !== 'number') continue;
          const delta = Math.abs(cumulativeDistances[offset] - targetDistance);
          if (delta < bestDistanceDelta) {
            bestDistanceDelta = delta;
            bestPoint = candidate;
          }
        }

        if (bestPoint) {
          const lastArrow = arrows[arrows.length - 1];
          const isDuplicate = lastArrow
            && lastArrow.latitude === bestPoint.latitude
            && lastArrow.longitude === bestPoint.longitude;
          if (!isDuplicate) arrows.push(bestPoint);
        }
      }
    };

    for (let i = 1; i < points.length; i++) {
      const previousHeading = typeof points[i - 1].headingDeg === 'number' ? points[i - 1].headingDeg : null;
      const currentHeading = typeof points[i].headingDeg === 'number' ? points[i].headingDeg : previousHeading;
      if (previousHeading == null || currentHeading == null) continue;
      const headingDelta = Math.abs((((currentHeading - previousHeading) + 540) % 360) - 180);
      if (headingDelta > headingToleranceDeg) {
        flushSegment(segmentStart, i - 1);
        segmentStart = i;
      }
    }

    flushSegment(segmentStart, points.length - 1);
    return arrows;
  };
  const diagonalCross = (base: LatLng, goal: LatLng, point: LatLng) => (
    (goal.longitude - base.longitude) * (point.latitude - base.latitude) -
    (goal.latitude - base.latitude) * (point.longitude - base.longitude)
  );

  const orderBoundaryPoints = (base: LatLng, goal: LatLng, sideA: LatLng, sideB: LatLng): LatLng[] => {
    const crossA = diagonalCross(base, goal, sideA);
    const crossB = diagonalCross(base, goal, sideB);
    if (crossA === 0 && crossB === 0) return [base, sideA, goal, sideB];
    if (crossA * crossB < 0) return crossA > 0 ? [base, sideA, goal, sideB] : [base, sideB, goal, sideA];
    return [base, sideA, goal, sideB];
  };

  const cornerLabels = ['Base Corner', 'Boundary Corner', 'Goal Corner', 'Boundary Corner'];

  const updateSelectionFromBoundary = (boundary: LatLng[]) => {
    if (boundary.length !== 4) return;
    setSelection({ boundary, baseStation: boundary[0], goal: boundary[2] });
    resetPlanningState();
  };

  const applyCorner = (corner: LatLng) => {
    if (!drawingMode) return;
    if (!firstPoint) {
      setFirstPoint(corner);
      setMessage('First corner set. Pick the opposite corner.');
      return;
    }
    const secondPoint = corner;
    const boundary = orderBoundaryPoints(
      firstPoint,
      secondPoint,
      { latitude: firstPoint.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: firstPoint.longitude },
    );
    const nextSelection = { baseStation: firstPoint, goal: secondPoint, boundary };
    setSelection(nextSelection);
    resetPlanningState();
    setMessage('Area set. Submit it, then plan the path.');
    setDrawingMode(false);
    setFirstPoint(null);
    requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(nextSelection.boundary, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    });
  };

  const handleMapPress = (event: MapPressEvent) => {
    if (!drawingMode) return;
    const { latitude, longitude } = event.nativeEvent.coordinate;
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
      setMessage('Zoom failed. Try again.');
    }
  };

  const moveBoundaryCorner = (index: number, nextCoordinate: LatLng) => {
    if (!selection) return;
    const nextBoundary = selection.boundary.map((point, pointIndex) => (
      pointIndex === index ? nextCoordinate : point
    ));
    updateSelectionFromBoundary(nextBoundary);
    setMessage(`${cornerLabels[index]} updated. Submit the area again before planning.`);
  };
  const toggleMapType = () => {
    setMapType((prevType) => {
      const nextType = prevType === 'standard' ? 'hybrid' : 'standard';
      setMessage(nextType === 'hybrid' ? 'Satellite view.' : 'Standard view.');
      return nextType;
    });
  };

  const loadCoverageGrid = async () => {
    try {
      const response = await getJson<CoverageResponse>(serverUrl, '/api/coverage');
      setCoverageCells(
        (response.grid?.cells ?? []).map((cell) => ({
          ...cell,
          polygon: (cell.polygon ?? []).map((point) => ({
            latitude: point.lat,
            longitude: point.lon,
          })),
        })),
      );
      return true;
    } catch {
      setCoverageCells([]);
      return false;
    }
  };

  const submitArea = async () => {
    if (!selection) return;
    setBusy('area');
    try {
      await postJson(serverUrl, '/api/input-area', {
        baseStation: { lat: selection.baseStation.latitude, lon: selection.baseStation.longitude },
        homePoint: { lat: selection.baseStation.latitude, lon: selection.baseStation.longitude },
        boundary: selection.boundary.map((point) => ({ lat: point.latitude, lon: point.longitude })),
        cellSizeM: 2,
      });
      setAreaSubmitted(true);
      const gridLoaded = await loadCoverageGrid();
      setMessage(gridLoaded ? 'Area submitted. You can plan the path now.' : 'Area submitted. Grid preview is unavailable right now.');
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Area submit failed.');
    } finally {
      setBusy(null);
    }
  };

  const planPath = async () => {
    if (!selection) return;
    if (!areaSubmitted) {
      setMessage('Submit the area first.');
      return;
    }
    setBusy('path');
    try {
      const result = await postJson<{ ok: boolean; points: PlannedPoint[] }>(serverUrl, '/api/path/plan', {
        mode: 'coverage',
        start: { lat: selection.baseStation.latitude, lon: selection.baseStation.longitude },
        goal: { lat: selection.goal.latitude, lon: selection.goal.longitude },
        coverageWidthM: 0.5,
        returnToBase: true,
        saltPct,
        brinePct,
      });
      const points = (result?.points ?? []).map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
        headingDeg: point.headingDeg ?? null,
      }));
      setPlannedPath(points);
      const totalDistance = computePathDistanceMeters(points);
      setPlannedPathDistanceM(totalDistance);
      await loadCoverageGrid();
      if (points.length > 1) {
        requestAnimationFrame(() => {
          mapRef.current?.fitToCoordinates(points.map((point) => ({
            latitude: point.latitude,
            longitude: point.longitude,
          })), {
            edgePadding: { top: 110, right: 90, bottom: 220, left: 90 },
            animated: true,
          });
        });
      }
      if (saltPct === 0 && brinePct === 0) {
        setMessage('Path ready, but warning: 0% salt and 0% brine cannot be started.');
      } else {
        setMessage(`Path ready: ${points.length} points, ${(totalDistance / 1000).toFixed(2)} km.`);
      }
    } catch (requestError) {
      setPlannedPath([]);
      setPlannedPathDistanceM(0);
      setMessage(requestError instanceof Error ? requestError.message : 'Path planning failed.');
    } finally {
      setBusy(null);
    }
  };

  const { widthM, heightM, areaM2 } = getSelectionMetrics();
  const arrowSize = areaM2 > 4000 ? 22 : areaM2 > 1600 ? 18 : 14;
  const pathArrowPoints = buildPathArrowPoints(plannedPath);

  return (
    <View style={styles.container}>
      <View style={styles.mapFrame}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          mapType={mapType}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
          initialRegion={{
            latitude: 41.0731,
            longitude: -81.5171,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          maxZoomLevel={22}
          minZoomLevel={2}
          onPress={handleMapPress}
          zoomEnabled
          scrollEnabled
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {selection ? (
            <>
              {coverageCells.map((cell) => (
                <Polygon
                  key={`grid-${cell.row}-${cell.col}`}
                  coordinates={cell.polygon}
                  strokeColor={cell.covered ? 'rgba(45,138,101,0.30)' : 'rgba(31,95,159,0.24)'}
                  fillColor="transparent"
                  strokeWidth={1}
                />
              ))}
              <Polygon
                coordinates={selection.boundary}
                strokeColor="#2c6fb7"
                fillColor="rgba(44,111,183,0.12)"
                strokeWidth={2}
              />
              {selection.boundary.map((point, index) => (
                <Marker
                  key={`corner-${index}`}
                  coordinate={point}
                  draggable
                  pinColor={index === 0 ? '#2d8a65' : index === 2 ? '#b63d3d' : '#2c6fb7'}
                  title={cornerLabels[index]}
                  description={'Press and hold, then drag to adjust this corner'}
                  onDragEnd={(event) => moveBoundaryCorner(index, event.nativeEvent.coordinate)}
                />
              ))}
              {plannedPath.length > 1 ? (
                <>
                  <Polyline
                    coordinates={plannedPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))}
                    strokeColor="#ffffff"
                    strokeWidth={8}
                    geodesic
                  />
                  <Polyline
                    coordinates={plannedPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))}
                    strokeColor="#1f5f9f"
                    strokeWidth={4}
                    geodesic
                  />
                  {pathArrowPoints.map((point, index) => (
                    <Marker
                      key={`path-arrow-${index}`}
                      coordinate={point}
                      anchor={{ x: 0.5, y: 0.5 }}
                      flat
                      tracksViewChanges={false}
                    >
                      <View
                        style={[
                          styles.pathArrow,
                          { width: arrowSize, height: arrowSize },
                          { transform: [{ rotate: `${point.headingDeg ?? 0}deg` }] },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="navigation"
                          size={Math.max(12, arrowSize - 4)}
                          color="#1f5f9f"
                        />
                      </View>
                    </Marker>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </MapView>
      </View>

      <View style={[styles.zoomStack, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}>
        <Button title="+" onPress={() => zoomBy(1)} />
        <View style={styles.smallGap}>
          <Button title="-" onPress={() => zoomBy(-1)} />
        </View>
      </View>

      <View style={[styles.modeChip, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}>
        <View style={styles.modeChipTextBlock}>
          <View style={styles.modeChipRow}>
            <Text style={[styles.modeChipText, { color: drawingMode ? '#1d7f4a' : theme.muted }]}>
              {drawingMode ? 'Drawing' : (selection ? 'Area Set' : 'Browse')}
            </Text>
            <MaterialCommunityIcons
              name={drawingMode ? 'vector-polyline-edit' : selection ? 'selection-drag' : 'map-search-outline'}
              size={16}
              color="#2c6fb7"
            />
          </View>
          <Text style={[styles.modeChipSub, { color: theme.muted }]} numberOfLines={1}>
            {`Salt ${saltPct}% • Brine ${brinePct}%`}
          </Text>
        </View>
        <View style={styles.modeChipActions}>
          <AppButton label={mapType === 'standard' ? 'Satellite' : 'Standard'} onPress={toggleMapType} variant="outline" style={styles.mapTypeAction}>
            <MaterialCommunityIcons
              name={mapType === 'standard' ? 'layers-outline' : 'map-outline'}
              size={16}
              color="#2c6fb7"
            />
          </AppButton>
        </View>
      </View>

      <View style={[styles.overlay, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, bottom: insets.bottom + 14 }]}>
        <Text style={[styles.overlayText, { color: theme.text }]}>{message}</Text>
        <Text style={styles.stepText}>Draw area • Submit area • Plan path</Text>
        {plannedPath.length > 1 ? (
          <Text style={styles.pathMetaText}>Path: {plannedPath.length} points • {(plannedPathDistanceM / 1000).toFixed(2)} km • Grid {Math.round(widthM)}m x {Math.round(heightM)}m</Text>
        ) : null}
        <View style={styles.actionRow}>
          <AppButton
            label={drawingMode ? 'Drawing...' : 'Draw Area'}
            onPress={() => {
              setSelection(null);
              resetPlanningState();
              setDrawingMode(true);
              setFirstPoint(null);
              setMessage('Pick the first corner, then the opposite corner.');
            }}
            variant="outline"
            style={styles.secondaryAction}
          />
          <AppButton
            label="Clear"
            onPress={() => {
              setSelection(null);
              resetPlanningState();
              setFirstPoint(null);
              setDrawingMode(false);
              setMessage('Area cleared.');
            }}
            variant="outline"
            style={styles.secondaryAction}
          />
        </View>

        <View style={styles.actionRow}>
          <AppButton
            label={busy === 'area' ? 'Submitting Area...' : areaSubmitted ? 'Area Submitted' : 'Submit Area'}
            onPress={submitArea}
            disabled={!selection || busy !== null}
            variant={!selection || busy !== null ? 'primary' : areaSubmitted ? 'success' : 'success'}
            style={[
              styles.statefulButton,
              styles.actionFill,
              !selection || busy !== null ? styles.buttonDisabled : areaSubmitted ? styles.buttonDone : styles.buttonReady,
            ]}
          />
          <AppButton
            label={busy === 'path' ? 'Planning Path...' : 'Plan Path'}
            onPress={planPath}
            disabled={!selection || !areaSubmitted || busy !== null}
            variant="primary"
            style={[
              styles.statefulButton,
              styles.actionFill,
              !selection || !areaSubmitted || busy !== null ? styles.buttonDisabled : styles.buttonPlan,
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f5f8',
  },
  mapFrame: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 18,
    backgroundColor: 'rgba(248,251,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    width: 160,
    backgroundColor: 'rgba(248,251,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  modeChipTextBlock: {
    gap: 3,
  },
  modeChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeChipActions: {
    gap: 8,
  },
  mapTypeAction: {
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 10,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#35506a',
  },
  modeChipSub: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6a87a2',
  },
  smallGap: {
    marginTop: 8,
  },
  overlayText: {
    marginBottom: 4,
    color: '#16324f',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  stepText: {
    color: '#4f6275',
    fontSize: 11,
    marginBottom: 6,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  actionFill: {
    flex: 1,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 34,
  },
  pathMetaText: {
    color: '#1f5f9f',
    fontSize: 11,
    marginBottom: 6,
    fontWeight: '600',
  },
  pathArrow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pathArrowText: {
    color: '#1f5f9f',
    fontWeight: '800',
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowRadius: 3,
  },
  statefulButton: {
    minHeight: 36,
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















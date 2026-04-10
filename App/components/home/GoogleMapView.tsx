import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { LatLng, MapPressEvent, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Defs, LinearGradient, Path as SvgPath, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getJson, postJson } from '../../lib/serverApi';
import AppButton from '../common/AppButton';
import AppNoticeModal from '../common/AppNoticeModal';

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

type PlanningCacheState = {
  drawingMode: boolean;
  firstPoint: LatLng | null;
  selection: RectangleSelection | null;
  baseStation: LatLng | null;
  plannedPath: PlannedCoordinate[];
  plannedPathDistanceM: number;
  coverageCells: CoverageCell[];
  areaSubmitted: boolean;
  message: string;
  mapType: 'standard' | 'satellite';
};

const DEFAULT_PLANNING_MESSAGE = 'Set the base station, then outline the service area.';
let planningCache: PlanningCacheState = {
  drawingMode: false,
  firstPoint: null,
  selection: null,
  baseStation: null,
  plannedPath: [],
  plannedPathDistanceM: 0,
  coverageCells: [],
  areaSubmitted: false,
  message: DEFAULT_PLANNING_MESSAGE,
  mapType: 'standard',
};

function CornerPin({ index, tone }: { index: number; tone: 'start' | 'goal' | 'edge' }) {
  const palette = tone === 'start'
    ? { top: '#45c486', bottom: '#2d8a65', edge: '#1f6a4d' }
    : tone === 'goal'
      ? { top: '#5d8fd4', bottom: '#315781', edge: '#223d5b' }
      : { top: '#5fa8ef', bottom: '#2c6fb7', edge: '#1f548a' };

  return (
    <View style={styles.pinMarkerWrap}>
      <Svg width={34} height={42} viewBox="0 0 34 42">
        <Defs>
          <LinearGradient id={`pinGradient-${tone}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.top} />
            <Stop offset="1" stopColor={palette.bottom} />
          </LinearGradient>
        </Defs>
        <SvgPath
          d="M17 2C9.82 2 4 7.82 4 15c0 8.86 9.06 18.11 11.64 20.57a1.9 1.9 0 0 0 2.72 0C20.94 33.11 30 23.86 30 15 30 7.82 24.18 2 17 2Z"
          fill={`url(#pinGradient-${tone})`}
          stroke={palette.edge}
          strokeWidth={1.4}
        />
        <Circle cx="17" cy="15" r="6.6" fill="#ffffff" fillOpacity="0.96" />
      </Svg>
      <View style={styles.pinMarkerBadge}>
        <Text style={styles.pinMarkerBadgeText}>{index + 1}</Text>
      </View>
    </View>
  );
}

function DirectionArrow({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <SvgPath
        d="M12 2L20 22L12 17.5L4 22L12 2Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function GoogleMapView({ serverUrl, saltPct, brinePct }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const [drawingMode, setDrawingMode] = useState(planningCache.drawingMode);
  const [firstPoint, setFirstPoint] = useState<LatLng | null>(planningCache.firstPoint);
  const [selection, setSelection] = useState<RectangleSelection | null>(planningCache.selection);
  const [baseStationPoint, setBaseStationPoint] = useState<LatLng | null>(planningCache.baseStation);
  const [placingBaseStation, setPlacingBaseStation] = useState(false);
  const [plannedPath, setPlannedPath] = useState<PlannedCoordinate[]>(planningCache.plannedPath);
  const [plannedPathDistanceM, setPlannedPathDistanceM] = useState(planningCache.plannedPathDistanceM);
  const [coverageCells, setCoverageCells] = useState<CoverageCell[]>(planningCache.coverageCells);
  const [areaSubmitted, setAreaSubmitted] = useState(planningCache.areaSubmitted);
  const [message, setMessage] = useState(planningCache.message);
  const [busy, setBusy] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>(planningCache.mapType);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const locationPromptedRef = useRef(false);

  const theme = {
    overlayBg: 'rgba(248,251,255,0.95)',
    overlayBorder: '#d9e4f0',
    text: '#16324f',
    muted: '#35506a',
  };

  const getLocationModule = () => {
    try {
      return require('expo-location');
    } catch {
      return null;
    }
  };

  const centerOnCoordinate = (coordinate: LatLng, zoom = 18) => {
    requestAnimationFrame(() => {
      mapRef.current?.animateCamera({ center: coordinate, zoom }, { duration: 280 });
    });
  };

  const applyBaseStationPoint = (coordinate: LatLng, nextMessage = 'Base station location saved. Now mark the work area.') => {
    setBaseStationPoint(coordinate);
    setPlacingBaseStation(false);
    setMessage(nextMessage);
    centerOnCoordinate(coordinate);
  };

  const usePhoneLocationForBaseStation = async () => {
    const Location = getLocationModule();
    if (!Location) {
      setPlacingBaseStation(true);
      setMessage('Phone location is unavailable here. Tap Mark Base Station and then tap the map.');
      return;
    }

    setBusy('locate');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPlacingBaseStation(true);
        setMessage('Location permission was denied. Tap Mark Base Station and choose it on the map.');
        return;
      }

      const lastKnown = await Location.getLastKnownPositionAsync();
      const current = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      applyBaseStationPoint(
        { latitude: current.coords.latitude, longitude: current.coords.longitude },
        'Base station set from your phone location. Now mark the work area.',
      );
    } catch {
      setPlacingBaseStation(true);
      setMessage('Could not read the phone location. Tap Mark Base Station and choose it on the map.');
    } finally {
      setBusy(null);
    }
  };

  const resetPlanningState = () => {
    setAreaSubmitted(false);
    setPlannedPath([]);
    setPlannedPathDistanceM(0);
    setCoverageCells([]);
  };

  useEffect(() => {
    planningCache = {
      drawingMode,
      firstPoint,
      selection,
      baseStation: baseStationPoint,
      plannedPath,
      plannedPathDistanceM,
      coverageCells,
      areaSubmitted,
      message,
      mapType,
    };
  }, [drawingMode, firstPoint, selection, baseStationPoint, plannedPath, plannedPathDistanceM, coverageCells, areaSubmitted, message, mapType]);


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

  const normalizeHeadingDeg = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  };

  const computeHeadingBetweenPoints = (from: LatLng | PlannedCoordinate, to: LatLng | PlannedCoordinate) => {
    const avgLatRad = ((from.latitude + to.latitude) * Math.PI) / 360;
    const dNorth = to.latitude - from.latitude;
    const dEast = (to.longitude - from.longitude) * Math.cos(avgLatRad);
    const angle = (Math.atan2(dEast, dNorth) * 180) / Math.PI;
    return normalizeHeadingDeg(angle);
  };

  const resolveHeadingForPoint = (points: PlannedCoordinate[], index: number) => {
    const point = points[index];
    if (!point) return null;

    const directHeading = normalizeHeadingDeg(point.headingDeg);
    if (directHeading != null) return directHeading;

    const nextPoint = points[index + 1];
    if (nextPoint) {
      const forwardHeading = computeHeadingBetweenPoints(point, nextPoint);
      if (forwardHeading != null) return forwardHeading;
    }

    const previousPoint = points[index - 1];
    if (previousPoint) {
      return computeHeadingBetweenPoints(previousPoint, point);
    }

    return null;
  };

  const buildPathArrowPoints = (points: PlannedCoordinate[]) => {
    if (points.length < 2) return [];

    const arrows: PlannedCoordinate[] = [];
    const headingToleranceDeg = 12;
    const { areaM2 } = getSelectionMetrics();
    const arrowSpacingM = areaM2 > 12000 ? 36 : areaM2 > 4000 ? 24 : areaM2 > 1600 ? 16 : 10;
    const minSegmentLengthM = arrowSpacingM * 0.9;
    let segmentStart = 0;

    const pushArrow = (candidate: PlannedCoordinate) => {
      const lastArrow = arrows[arrows.length - 1];
      if (!lastArrow || haversineDistanceMeters(lastArrow, candidate) >= Math.max(1, arrowSpacingM * 0.35)) {
        arrows.push(candidate);
      }
    };

    const flushSegment = (startIndex: number, endIndex: number) => {
      if (endIndex <= startIndex) return;

      const segmentDistances: number[] = [];
      let segmentLengthM = 0;
      for (let i = startIndex; i < endIndex; i++) {
        const legLengthM = haversineDistanceMeters(points[i], points[i + 1]);
        segmentDistances.push(legLengthM);
        segmentLengthM += legLengthM;
      }
      if (segmentLengthM < minSegmentLengthM) return;

      const arrowCount = Math.max(1, Math.floor(segmentLengthM / arrowSpacingM));
      const spacing = segmentLengthM / arrowCount;

      for (let arrowIndex = 0; arrowIndex < arrowCount; arrowIndex++) {
        const targetDistance = spacing * (arrowIndex + 0.5);
        let traversedM = 0;

        for (let offset = 0; offset < segmentDistances.length; offset++) {
          const legLengthM = segmentDistances[offset];
          if (legLengthM <= 0) continue;

          if (traversedM + legLengthM < targetDistance) {
            traversedM += legLengthM;
            continue;
          }

          const startPoint = points[startIndex + offset];
          const endPoint = points[startIndex + offset + 1];
          const ratio = Math.max(0, Math.min(1, (targetDistance - traversedM) / legLengthM));
          const headingDeg = computeHeadingBetweenPoints(startPoint, endPoint) ?? resolveHeadingForPoint(points, startIndex + offset);

          if (headingDeg == null) {
            break;
          }

          pushArrow({
            latitude: startPoint.latitude + ((endPoint.latitude - startPoint.latitude) * ratio),
            longitude: startPoint.longitude + ((endPoint.longitude - startPoint.longitude) * ratio),
            headingDeg,
          });
          break;
        }
      }
    };

    for (let i = 1; i < points.length; i++) {
      const previousHeading = resolveHeadingForPoint(points, i - 1);
      const currentHeading = resolveHeadingForPoint(points, i);
      if (previousHeading == null || currentHeading == null) continue;
      const headingDelta = Math.abs((((currentHeading - previousHeading) + 540) % 360) - 180);
      if (headingDelta > headingToleranceDeg) {
        flushSegment(segmentStart, i);
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
    setSelection({ boundary, baseStation: baseStationPoint ?? boundary[0], goal: boundary[2] });
    resetPlanningState();
  };

  const applyCorner = (corner: LatLng) => {
    if (!drawingMode) return;
    if (!firstPoint) {
      setFirstPoint(corner);
      setMessage('First corner saved. Tap the opposite corner to finish the work zone.');
      return;
    }
    const secondPoint = corner;
    const boundary = orderBoundaryPoints(
      firstPoint,
      secondPoint,
      { latitude: firstPoint.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: firstPoint.longitude },
    );
    const nextSelection = { baseStation: baseStationPoint ?? firstPoint, goal: secondPoint, boundary };
    setSelection(nextSelection);
    resetPlanningState();
    setMessage('Work zone ready. Send it to the planner, then build the route.');
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
    const { latitude, longitude } = event.nativeEvent.coordinate;
    if (placingBaseStation) {
      applyBaseStationPoint({ latitude, longitude }, 'Base station pinned. Now mark the work area.');
      return;
    }
    if (!drawingMode) return;
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
      setMessage('Zoom adjustment failed. Try again.');
    }
  };

  const moveBoundaryCorner = (index: number, nextCoordinate: LatLng) => {
    if (!selection) return;
    const nextBoundary = selection.boundary.map((point, pointIndex) => (
      pointIndex === index ? nextCoordinate : point
    ));
    updateSelectionFromBoundary(nextBoundary);
    setMessage(`${cornerLabels[index]} updated. Send the area again before building a route.`);
  };
  const toggleMapType = () => {
    setMapType((prevType) => {
      const nextType = prevType === 'standard' ? 'satellite' : 'standard';
      setMessage(nextType === 'satellite' ? 'Satellite view enabled.' : 'Standard map view enabled.');
      return nextType;
    });
  };

  useEffect(() => {
    if (locationPromptedRef.current || baseStationPoint) return;
    locationPromptedRef.current = true;
    setLocationPromptVisible(true);
  }, [baseStationPoint]);

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
    const resolvedBaseStation = baseStationPoint ?? selection.baseStation ?? null;
    if (!resolvedBaseStation) {
      setMessage('Set the base station location first so the route knows where to start and return.');
      return;
    }
    setBusy('area');
    try {
      await postJson(serverUrl, '/api/input-area', {
        baseStation: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        boundary: selection.boundary.map((point) => ({ lat: point.latitude, lon: point.longitude })),
        cellSizeM: 2,
      });
      setAreaSubmitted(true);
      const gridLoaded = await loadCoverageGrid();
      setMessage(gridLoaded ? 'Work area sent. You can build the route now.' : 'Work area sent, but the grid preview is unavailable right now.');
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Could not send the work area.');
    } finally {
      setBusy(null);
    }
  };

  const planPath = async () => {
    if (!selection) return;
    const resolvedBaseStation = baseStationPoint ?? selection.baseStation ?? null;
    if (!resolvedBaseStation) {
      setMessage('Set the base station location first so the route knows where to start and return.');
      return;
    }
    if (!areaSubmitted) {
      setMessage('Send the area to the planner first.');
      return;
    }
    setBusy('path');
    try {
      const result = await postJson<{ ok: boolean; points: PlannedPoint[] }>(serverUrl, '/api/path/plan', {
        mode: 'coverage',
        start: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        goal: { lat: selection.goal.latitude, lon: selection.goal.longitude },
        homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
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
        setMessage('Route ready, but warning: 0% salt and 0% brine cannot be started.');
      } else {
        setMessage(`Route ready: ${points.length} points over ${(totalDistance / 1000).toFixed(2)} km.`);
      }
    } catch (requestError) {
      setPlannedPath([]);
      setPlannedPathDistanceM(0);
      setMessage(requestError instanceof Error ? requestError.message : 'Route planning failed.');
    } finally {
      setBusy(null);
    }
  };

  const { widthM, heightM, areaM2 } = getSelectionMetrics();
  const arrowSize = areaM2 > 4000 ? 22 : areaM2 > 1600 ? 18 : 14;
  const pathArrowPoints = buildPathArrowPoints(plannedPath);
  const activeBaseStation = baseStationPoint ?? selection?.baseStation ?? null;

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
          {activeBaseStation ? (
            <Marker
              coordinate={activeBaseStation}
              anchor={{ x: 0.5, y: 1 }}
              title="Base station"
              description="Autonomy starts and returns here"
            >
              <View style={styles.baseStationMarker}>
                <MaterialCommunityIcons name="radio-tower" size={16} color="#ffffff" />
              </View>
            </Marker>
          ) : null}
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
                  anchor={{ x: 0.5, y: 0.5 }}
                  title={cornerLabels[index]}
                  description={'Press and hold, then drag to adjust this corner'}
                  onDragEnd={(event) => moveBoundaryCorner(index, event.nativeEvent.coordinate)}
                >
                  <CornerPin
                    index={index}
                    tone={index === 0 ? 'start' : index === 2 ? 'goal' : 'edge'}
                  />
                </Marker>
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
                        <DirectionArrow size={Math.max(14, arrowSize)} color="#1f5f9f" />
                      </View>
                    </Marker>
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </MapView>
      </View>

      <View pointerEvents="box-none" style={[styles.zoomStack, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}>
        <AppButton
          label="+"
          onPress={() => zoomBy(1)}
          variant="outline"
          compact
          style={styles.zoomButton}
          textStyle={styles.zoomButtonText}
        />
        <View style={styles.smallGap}>
          <AppButton
            label="−"
            onPress={() => zoomBy(-1)}
            variant="outline"
            compact
            style={styles.zoomButton}
            textStyle={styles.zoomButtonText}
          />
        </View>
      </View>

      <View pointerEvents="box-none" style={[styles.modeChip, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, top: insets.top + 14 }]}>
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
              name={mapType === 'standard' ? 'satellite-variant' : 'map-outline'}
              size={16}
              color="#2c6fb7"
            />
          </AppButton>
        </View>
      </View>

      <View pointerEvents="box-none" style={[styles.overlay, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, bottom: insets.bottom + 14 }]}>
        <Text style={[styles.overlayText, { color: theme.text }]} numberOfLines={2}>{message}</Text>

        {activeBaseStation ? (
          <View style={styles.baseStationSummaryRow}>
            <View style={styles.baseStationSummaryCard}>
              <View style={styles.baseStationSummaryIcon}>
                <MaterialCommunityIcons name="radio-tower" size={14} color="#ffffff" />
              </View>
              <View style={styles.baseStationSummaryText}>
                <Text style={styles.baseStationSummaryTitle}>Base station ready</Text>
                <Text style={styles.baseStationSummaryMeta}>
                  {activeBaseStation.latitude.toFixed(5)}, {activeBaseStation.longitude.toFixed(5)}
                </Text>
              </View>
            </View>
            <AppButton
              label={placingBaseStation ? 'Tap Map' : 'Move Pin'}
              onPress={() => {
                setPlacingBaseStation(true);
                setDrawingMode(false);
                setFirstPoint(null);
                setMessage('Tap the map to move the base station pin.');
              }}
              variant="outline"
              compact
              style={styles.summaryActionButton}
            />
          </View>
        ) : (
          <View style={styles.actionRow}>
            <AppButton
              label={busy === 'locate' ? 'Locating...' : 'Use My Location'}
              onPress={() => { void usePhoneLocationForBaseStation(); }}
              disabled={busy !== null}
              variant="outline"
              style={styles.secondaryAction}
            />
            <AppButton
              label={placingBaseStation ? 'Tap Map For Pin' : 'Mark on Map'}
              onPress={() => {
                setPlacingBaseStation(true);
                setDrawingMode(false);
                setFirstPoint(null);
                setMessage('Tap the map where the base station is parked.');
              }}
              variant="outline"
              style={styles.secondaryAction}
            />
          </View>
        )}

        {plannedPath.length > 1 ? (
          <Text style={styles.pathMetaText}>
            Route: {plannedPath.length} points • {(plannedPathDistanceM / 1000).toFixed(2)} km • Area {Math.round(areaM2)} m²
          </Text>
        ) : selection ? (
          <Text style={styles.pathMetaText}>
            Area: {Math.round(widthM)}m × {Math.round(heightM)}m • {Math.round(areaM2)} m²
          </Text>
        ) : null}

        <View style={styles.actionRow}>
          <AppButton
            label={drawingMode ? 'Marking...' : 'Outline Area'}
            onPress={() => {
              setSelection(null);
              resetPlanningState();
              setDrawingMode(true);
              setPlacingBaseStation(false);
              setFirstPoint(null);
              setMessage('Pick two opposite corners to outline the service area.');
            }}
            variant="outline"
            style={styles.secondaryAction}
          />
          <AppButton
            label="Clear Plan"
            onPress={() => {
              setSelection(null);
              resetPlanningState();
              setFirstPoint(null);
              setDrawingMode(false);
              setPlacingBaseStation(false);
              setMessage(baseStationPoint ? 'Service area cleared. Outline a new area when ready.' : DEFAULT_PLANNING_MESSAGE);
            }}
            variant="outline"
            style={styles.secondaryAction}
          />
        </View>

        <View style={styles.actionRow}>
          <AppButton
            label={busy === 'area' ? 'Saving Area...' : areaSubmitted ? 'Area Saved' : 'Save Area'}
            onPress={submitArea}
            disabled={!selection || busy !== null}
            variant={!selection || busy !== null ? 'primary' : 'success'}
            style={[
              styles.statefulButton,
              styles.actionFill,
              !selection || busy !== null ? styles.buttonDisabled : areaSubmitted ? styles.buttonDone : styles.buttonReady,
            ]}
          />
          <AppButton
            label={busy === 'path' ? 'Building Route...' : 'Build Route'}
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
      <AppNoticeModal
        visible={locationPromptVisible}
        title="Set base station location"
        message="Use your phone location for the base station, or tap the map to place it manually before planning the route."
        tone="info"
        primaryAction={{
          label: 'Use My Location',
          onPress: () => { void usePhoneLocationForBaseStation(); },
        }}
        secondaryAction={{
          label: 'Mark on Map',
          variant: 'outline',
          onPress: () => {
            setPlacingBaseStation(true);
            setMessage('Tap the map where the base station is parked, then mark the work area.');
          },
        }}
        onClose={() => setLocationPromptVisible(false)}
      />
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
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 30,
    elevation: 12,
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
    zIndex: 30,
    elevation: 12,
  },
  modeChip: {
    position: 'absolute',
    left: 16,
    top: 64,
    width: 144,
    backgroundColor: 'rgba(248,251,255,0.95)',
    borderWidth: 1,
    borderColor: '#d9e4f0',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    zIndex: 30,
    elevation: 12,
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
    minHeight: 34,
    minWidth: 0,
    paddingHorizontal: 8,
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
  zoomButton: {
    minWidth: 40,
    minHeight: 36,
    paddingHorizontal: 0,
  },
  zoomButtonText: {
    color: '#16324f',
    fontSize: 20,
    lineHeight: 20,
  },
  overlayText: {
    marginBottom: 2,
    color: '#16324f',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
    minHeight: 40,
  },
  baseStationSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  baseStationSummaryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#eef4fb',
    borderWidth: 1,
    borderColor: '#d7e4f2',
  },
  baseStationSummaryIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1f5f9f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  baseStationSummaryText: {
    flex: 1,
    gap: 1,
  },
  baseStationSummaryTitle: {
    color: '#16324f',
    fontSize: 11,
    fontWeight: '800',
  },
  baseStationSummaryMeta: {
    color: '#58708a',
    fontSize: 10,
    fontWeight: '600',
  },
  summaryActionButton: {
    minWidth: 86,
    minHeight: 40,
  },
  pathMetaText: {
    color: '#1f5f9f',
    fontSize: 10,
    marginTop: 6,
    marginBottom: 1,
    fontWeight: '600',
    lineHeight: 14,
  },
  pinMarkerWrap: {
    width: 34,
    height: 42,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  baseStationMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#16324f',
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pinMarkerBadge: {
    position: 'absolute',
    top: 8,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  pinMarkerBadgeText: {
    color: '#16324f',
    fontSize: 9,
    fontWeight: '900',
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
    minHeight: 40,
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















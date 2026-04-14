import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { Circle as MapCircle, LatLng, LongPressEvent, MapPressEvent, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Defs, LinearGradient, Path as SvgPath, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getJson, postJson, toWebSocketUrl } from '../../lib/serverApi';
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

type LatLonPayload = {
  lat?: number | null;
  lon?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  headingDeg?: number | null;
  state?: string | null;
  timestampMs?: number | null;
};

type PlannerPublicState = {
  baseStation?: LatLonPayload | null;
  remoteBaseStation?: LatLonPayload | null;
  homePoint?: LatLonPayload | null;
  boundary?: LatLonPayload[] | null;
  robot?: LatLonPayload | null;
  trail?: LatLonPayload[] | null;
  lastPath?: PlannedPoint[] | null;
};

type PlannerStateResponse = {
  ok: boolean;
  state?: PlannerPublicState | null;
};

type PlannerSocketMessage = {
  event?: string;
  payload?: {
    baseStation?: LatLonPayload | null;
    remoteBaseStation?: LatLonPayload | null;
    homePoint?: LatLonPayload | null;
    boundary?: LatLonPayload[] | null;
    robot?: LatLonPayload | null;
    trail?: LatLonPayload[] | null;
    points?: PlannedPoint[] | null;
  } | null;
  at?: number;
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
  robotPoint: LatLng | null;
  robotTrail: LatLng[];
};

const DEFAULT_MAP_CENTER: LatLng = {
  latitude: 41.0731,
  longitude: -81.5171,
};

const DEFAULT_PLANNING_MESSAGE = 'Set the base station, then outline the service area.';

function normalizeHeadingDeg(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function toLatLngPoint(point: unknown): LatLng | null {
  if (!point || typeof point !== 'object') return null;
  const candidate = point as LatLonPayload;
  const latitude = Number(candidate.lat ?? candidate.latitude);
  const longitude = Number(candidate.lon ?? candidate.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function toLatLngPoints(points: unknown): LatLng[] {
  if (!Array.isArray(points)) return [];
  return points.map((point) => toLatLngPoint(point)).filter((point): point is LatLng => Boolean(point));
}

function toPlannedCoordinates(points: unknown): PlannedCoordinate[] {
  if (!Array.isArray(points)) return [];
  return points.reduce<PlannedCoordinate[]>((coordinates, point) => {
    const coordinate = toLatLngPoint(point);
    if (!coordinate) return coordinates;
    coordinates.push({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      headingDeg: normalizeHeadingDeg((point as PlannedPoint)?.headingDeg ?? null),
    });
    return coordinates;
  }, []);
}

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
  robotPoint: null,
  robotTrail: [],
};

function CornerPin({ tone }: { tone: 'start' | 'goal' | 'edge' }) {
  const palette = tone === 'start'
    ? { top: '#45c486', bottom: '#2d8a65', edge: '#1f6a4d' }
    : tone === 'goal'
      ? { top: '#ef6a6a', bottom: '#c63d3d', edge: '#8f2424' }
      : { top: '#8b78ff', bottom: '#5b47c9', edge: '#43349a' };

  return (
    <View style={styles.pinMarkerWrap}>
      <Svg width={34} height={46} viewBox="0 0 34 46">
        <Defs>
          <LinearGradient id={`pinGradient-${tone}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.top} />
            <Stop offset="1" stopColor={palette.bottom} />
          </LinearGradient>
        </Defs>
        <SvgPath
          d="M17 2C9.82 2 4 7.82 4 15c0 8.52 7.86 17.92 11.07 22.04.96 1.23 2.83 1.23 3.79 0C22.14 32.92 30 23.52 30 15 30 7.82 24.18 2 17 2Z"
          fill={`url(#pinGradient-${tone})`}
          stroke={palette.edge}
          strokeWidth={1.2}
        />
        <Circle cx="17" cy="15" r="6.2" fill="#ffffff" fillOpacity="0.96" />
      </Svg>
    </View>
  );
}

function DirectionArrow({ size, color }: { size: number; color: string }) {
  const outlineSize = size;
  const fillSize = Math.max(12, size - 5);
  const outlineOffsets = [
    { x: -1.4, y: 0 },
    { x: 1.4, y: 0 },
    { x: 0, y: -1.4 },
    { x: 0, y: 1.4 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ];

  return (
    <View style={styles.pathArrowIcon}>
      {outlineOffsets.map((offset, index) => (
        <MaterialCommunityIcons
          key={`arrow-outline-${index}`}
          name="navigation"
          size={outlineSize}
          color="#ffffff"
          style={[
            styles.pathArrowOutline,
            { transform: [{ translateX: offset.x }, { translateY: offset.y }] },
          ]}
        />
      ))}
      <MaterialCommunityIcons name="navigation" size={fillSize} color={color} style={styles.pathArrowFill} />
    </View>
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
  const [robotPoint, setRobotPoint] = useState<LatLng | null>(planningCache.robotPoint);
  const [robotTrail, setRobotTrail] = useState<LatLng[]>(planningCache.robotTrail);
  const [busy, setBusy] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>(planningCache.mapType);
  const [mapCenter, setMapCenter] = useState<LatLng>(planningCache.baseStation ?? DEFAULT_MAP_CENTER);
  const [mapSpan, setMapSpan] = useState({ latitudeDelta: 0.01, longitudeDelta: 0.01 });
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const [plannerReady, setPlannerReady] = useState(false);
  const [baseStationControlsVisible, setBaseStationControlsVisible] = useState(false);
  const locationPromptedRef = useRef(false);
  const coverageRefreshAtRef = useRef(0);
  const coverageRequestRef = useRef<Promise<boolean> | null>(null);
  const plannerDraftRef = useRef(false);

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

  const fitMapToCoordinates = (coordinates: LatLng[], padding = { top: 96, right: 88, bottom: 196, left: 88 }) => {
    if (coordinates.length === 0) return;
    if (coordinates.length === 1) {
      centerOnCoordinate(coordinates[0]);
      return;
    }
    requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: padding,
        animated: true,
      });
    });
  };

  const applyBaseStationPoint = (coordinate: LatLng, nextMessage?: string) => {
    plannerDraftRef.current = true;
    setBaseStationPoint(coordinate);
    setSelection((current) => (current ? { ...current, baseStation: coordinate } : current));
    setPlacingBaseStation(false);
    setBaseStationControlsVisible(false);
    if (!selection) {
      setDrawingMode(true);
      setFirstPoint(null);
    }
    setMessage(
      nextMessage ?? (selection
        ? 'Base station updated. You can save the area and build the route when ready.'
        : 'Base station pinned. Now tap the first corner on the map to start the service area.'),
    );
    centerOnCoordinate(coordinate);
  };

  const usePhoneLocationForBaseStation = async () => {
    const Location = getLocationModule();
    if (!Location) {
      setPlacingBaseStation(true);
      setMessage('Phone location is unavailable here. Tap the map to place the base station manually.');
      return;
    }

    setBusy('locate');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPlacingBaseStation(true);
        setMessage('Location permission was denied. Tap the map to place the base station manually.');
        return;
      }

      const lastKnown = await Location.getLastKnownPositionAsync();
      const current = lastKnown ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      applyBaseStationPoint(
        { latitude: current.coords.latitude, longitude: current.coords.longitude },
        'Base station set from your phone location. Now tap the first corner on the map to start the service area.',
      );
    } catch {
      setPlacingBaseStation(true);
      setMessage('Could not read the phone location. Tap the map to place the base station manually.');
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
      robotPoint,
      robotTrail,
    };
  }, [drawingMode, firstPoint, selection, baseStationPoint, plannedPath, plannedPathDistanceM, coverageCells, areaSubmitted, message, mapType, robotPoint, robotTrail]);


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
    let minLat = selection.boundary[0]?.latitude ?? 0;
    let maxLat = minLat;
    let minLon = selection.boundary[0]?.longitude ?? 0;
    let maxLon = minLon;
    for (const point of selection.boundary) {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLon = Math.min(minLon, point.longitude);
      maxLon = Math.max(maxLon, point.longitude);
    }
    const widthM = haversineDistanceMeters(
      { latitude: minLat, longitude: minLon },
      { latitude: minLat, longitude: maxLon },
    );
    const heightM = haversineDistanceMeters(
      { latitude: minLat, longitude: minLon },
      { latitude: maxLat, longitude: minLon },
    );
    let areaAccumulator = 0;
    for (let i = 0; i < selection.boundary.length; i++) {
      const current = selection.boundary[i];
      const next = selection.boundary[(i + 1) % selection.boundary.length];
      areaAccumulator += (current.longitude * next.latitude) - (next.longitude * current.latitude);
    }
    const areaM2 = Math.abs(areaAccumulator) * 0.5 * 111_320 * 111_320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    return { widthM, heightM, areaM2 };
  };

  const resolvePlanningCellSizeM = () => {
    const { widthM, heightM } = getSelectionMetrics();
    const narrowSideM = Math.min(widthM, heightM);

    if (narrowSideM > 0 && narrowSideM <= 4) return 0.5;
    if (narrowSideM > 0 && narrowSideM <= 8) return 0.75;
    if (narrowSideM > 0 && narrowSideM <= 14) return 1.0;
    return 2.0;
  };

  const computeHeadingBetweenPoints = (from: LatLng | PlannedCoordinate, to: LatLng | PlannedCoordinate) => {
    const avgLatRad = ((from.latitude + to.latitude) * Math.PI) / 360;
    const dNorth = to.latitude - from.latitude;
    const dEast = (to.longitude - from.longitude) * Math.cos(avgLatRad);
    const angle = (Math.atan2(dEast, dNorth) * 180) / Math.PI;
    return normalizeHeadingDeg(angle);
  };

  const headingDeltaDeg = (from: number | null, to: number | null) => {
    if (from == null || to == null) return null;
    const raw = Math.abs(from - to) % 360;
    return raw > 180 ? 360 - raw : raw;
  };

  const buildPathArrowPoints = (points: PlannedCoordinate[]) => {
    if (points.length < 2) return [];

    const arrows: PlannedCoordinate[] = [];
    const stride = points.length > 220 ? 18 : points.length > 140 ? 12 : points.length > 80 ? 8 : points.length > 30 ? 4 : 2;
    const halfWindow = Math.max(1, Math.floor(stride / 2));

    for (let i = stride; i < points.length - stride; i += stride) {
      const anchorPoint = points[i];
      const startIndex = Math.max(0, i - halfWindow);
      const endIndex = Math.min(points.length - 1, i + halfWindow);
      const prevIndex = Math.max(0, startIndex - 1);
      const nextIndex = Math.min(points.length - 1, endIndex + 1);
      const startPoint = points[startIndex];
      const endPoint = points[endIndex];
      const legLengthM = haversineDistanceMeters(startPoint, endPoint);
      const headingDeg = computeHeadingBetweenPoints(startPoint, endPoint);
      const prevHeading = computeHeadingBetweenPoints(points[prevIndex], startPoint);
      const nextHeading = computeHeadingBetweenPoints(endPoint, points[nextIndex]);
      const turnIntoArrow = headingDeltaDeg(prevHeading, headingDeg);
      const turnOutOfArrow = headingDeltaDeg(headingDeg, nextHeading);

      // Skip arrows that would sit on a tight turn or reversal instead of the straight run.
      if (legLengthM < 0.25 || headingDeg == null) continue;
      if ((turnIntoArrow != null && turnIntoArrow > 45) || (turnOutOfArrow != null && turnOutOfArrow > 45)) continue;

      arrows.push({
        latitude: anchorPoint.latitude,
        longitude: anchorPoint.longitude,
        headingDeg,
      });
    }

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
    plannerDraftRef.current = true;
    const normalizedBoundary = orderBoundaryPoints(boundary[0], boundary[2], boundary[1], boundary[3]);
    setSelection({ boundary: normalizedBoundary, baseStation: baseStationPoint ?? normalizedBoundary[0], goal: normalizedBoundary[2] });
    resetPlanningState();
  };

  const applyCorner = (corner: LatLng) => {
    if (!drawingMode) return;
    if (!firstPoint) {
      plannerDraftRef.current = true;
      setFirstPoint(corner);
      setMessage('First corner saved. Tap the opposite corner on the map to finish the work zone.');
      return;
    }
    plannerDraftRef.current = true;
    const secondPoint = corner;
    const boundary = orderBoundaryPoints(
      firstPoint,
      secondPoint,
      { latitude: firstPoint.latitude, longitude: secondPoint.longitude },
      { latitude: secondPoint.latitude, longitude: firstPoint.longitude },
    );
    const nextSelection = { baseStation: baseStationPoint ?? firstPoint, goal: boundary[2], boundary };
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

  const handleCoordinateSelection = (coordinate: LatLng) => {
    const { latitude, longitude } = coordinate;
    setMapCenter({ latitude, longitude });
    if (placingBaseStation) {
      applyBaseStationPoint({ latitude, longitude }, 'Base station pinned. Now tap the map to outline the service area.');
      return;
    }
    if (!drawingMode) return;
    applyCorner({ latitude, longitude });
  };

  const handleMapPress = (event: MapPressEvent) => {
    handleCoordinateSelection(event.nativeEvent.coordinate);
  };

  const handleMapLongPress = (event: LongPressEvent) => {
    handleCoordinateSelection(event.nativeEvent.coordinate);
  };

  const beginBaseStationPlacement = () => {
    plannerDraftRef.current = true;
    setPlacingBaseStation(true);
    setBaseStationControlsVisible(true);
    setDrawingMode(false);
    setFirstPoint(null);
    setMessage('Tap directly on the map where the base station should be placed.');
  };

  const beginAreaSelection = () => {
    plannerDraftRef.current = true;
    setSelection(null);
    resetPlanningState();
    setDrawingMode(true);
    setPlacingBaseStation(false);
    setFirstPoint(null);
    setMessage('Tap the first corner on the map, then tap the opposite corner to finish the area.');
  };

  const zoomBy = async (delta: number) => {
    if (!mapRef.current) return;
    try {
      const camera = await mapRef.current.getCamera();
      const currentZoom = typeof camera.zoom === 'number' ? camera.zoom : 18;
      const nextZoom = Math.max(2, Math.min(22, currentZoom + delta));
      mapRef.current.animateCamera({ ...camera, zoom: nextZoom }, { duration: 180 });
    } catch {
      const zoomFactor = delta > 0 ? 0.5 : 2;
      mapRef.current.animateToRegion({
        latitude: mapCenter.latitude,
        longitude: mapCenter.longitude,
        latitudeDelta: Math.max(0.0005, Math.min(40, mapSpan.latitudeDelta * zoomFactor)),
        longitudeDelta: Math.max(0.0005, Math.min(40, mapSpan.longitudeDelta * zoomFactor)),
      }, 180);
    }
  };

  const moveBoundaryCorner = (index: number, nextCoordinate: LatLng) => {
    if (!selection) return;
    plannerDraftRef.current = true;
    const nextBoundary = selection.boundary.map((point, pointIndex) => (
      pointIndex === index ? nextCoordinate : point
    ));
    updateSelectionFromBoundary(nextBoundary);
    setMessage(`${cornerLabels[index]} updated. Send the area again before building a route.`);
  };

  const toggleMapMode = () => {
    const nextType: 'standard' | 'satellite' = mapType === 'standard' ? 'satellite' : 'standard';
    setMapType(nextType);
    setMessage(nextType === 'satellite' ? 'Satellite view enabled.' : 'Standard map view enabled.');
  };

  useEffect(() => {
    if (!plannerReady || locationPromptedRef.current || baseStationPoint) return;
    locationPromptedRef.current = true;
    setLocationPromptVisible(true);
  }, [baseStationPoint, plannerReady]);

  useEffect(() => {
    if (!baseStationPoint) return;
    setLocationPromptVisible(false);
  }, [baseStationPoint]);

  const loadCoverageGrid = async (force = false) => {
    if (!force && coverageRequestRef.current) {
      return coverageRequestRef.current;
    }
    if (!force && coverageRefreshAtRef.current > 0 && Date.now() - coverageRefreshAtRef.current < 1200) {
      return coverageCells.length > 0;
    }

    const request = (async () => {
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
        coverageRefreshAtRef.current = Date.now();
        return true;
      } catch {
        if (force) {
          setCoverageCells([]);
        }
        return false;
      }
    })();

    coverageRequestRef.current = request;
    try {
      return await request;
    } finally {
      coverageRequestRef.current = null;
    }
  };

  const appendRobotTrailPoint = (coordinate: LatLng) => {
    setRobotTrail((current) => {
      const lastPoint = current[current.length - 1];
      if (lastPoint && haversineDistanceMeters(lastPoint, coordinate) < 0.25) {
        return current;
      }
      const nextTrail = [...current, coordinate];
      return nextTrail.slice(-240);
    });
  };

  const applyRemotePlannerState = async (
    remoteState: PlannerPublicState | null | undefined,
    fitToState = false,
    includePlanningState = true,
  ) => {
    if (!remoteState) return;
    const preserveLocalPlanning = plannerDraftRef.current && !includePlanningState;

    const remoteBaseStation = toLatLngPoint(remoteState.baseStation)
      ?? toLatLngPoint(remoteState.remoteBaseStation)
      ?? toLatLngPoint(remoteState.homePoint);
    const nextBaseStation = preserveLocalPlanning ? baseStationPoint : remoteBaseStation;
    const nextBoundary = preserveLocalPlanning
      ? (selection?.boundary ?? [])
      : (includePlanningState ? toLatLngPoints(remoteState.boundary).slice(0, 4) : []);
    const nextPlannedPath = preserveLocalPlanning
      ? plannedPath
      : (includePlanningState ? toPlannedCoordinates(remoteState.lastPath) : []);
    const nextRobotPoint = toLatLngPoint(remoteState.robot);
    const nextRobotTrail = toLatLngPoints(remoteState.trail);

    if (!preserveLocalPlanning) {
      setDrawingMode(false);
      setFirstPoint(null);
      setPlacingBaseStation(false);
    }

    if (!preserveLocalPlanning) {
      setBaseStationPoint(nextBaseStation);
    }
    if (nextBaseStation) {
      setMapCenter(nextBaseStation);
    }

    if (nextBoundary.length === 4) {
      setSelection({
        boundary: nextBoundary,
        baseStation: nextBaseStation ?? nextBoundary[0],
        goal: nextBoundary[2],
      });
      setAreaSubmitted(true);
      void loadCoverageGrid(true);
    } else if (includePlanningState && !preserveLocalPlanning) {
      setSelection(null);
      setAreaSubmitted(false);
      setCoverageCells([]);
    }

    if (includePlanningState && !preserveLocalPlanning) {
      setPlannedPath(nextPlannedPath);
      setPlannedPathDistanceM(computePathDistanceMeters(nextPlannedPath));
    }
    setRobotPoint(nextRobotPoint);
    setRobotTrail(nextRobotTrail);

    if (!preserveLocalPlanning && includePlanningState && nextPlannedPath.length > 1) {
      setMessage(`Saved route loaded: ${nextPlannedPath.length} points over ${(computePathDistanceMeters(nextPlannedPath) / 1000).toFixed(2)} km.`);
    } else if (includePlanningState && nextBoundary.length === 4) {
      setMessage('Saved service area loaded. You can adjust it or build the route again.');
    } else if (nextBaseStation) {
      setMessage('Base station loaded. Tap the map to outline the service area.');
    } else {
      setMessage(DEFAULT_PLANNING_MESSAGE);
    }

    if (fitToState) {
      const focusPoints = nextPlannedPath.length > 1
        ? nextPlannedPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))
        : nextBoundary.length === 4
          ? nextBoundary
          : nextBaseStation
            ? [nextBaseStation]
            : nextRobotPoint
              ? [nextRobotPoint]
              : [];
      fitMapToCoordinates(focusPoints);
    }
  };

  const refreshPlannerState = async (fitToState = false, includePlanningState = true) => {
    try {
      const response = await getJson<PlannerStateResponse>(serverUrl, '/api/state');
      await applyRemotePlannerState(response.state, fitToState, includePlanningState);
    } catch {
      if (!planningCache.baseStation && !planningCache.selection) {
        setMessage(DEFAULT_PLANNING_MESSAGE);
      }
    } finally {
      setPlannerReady(true);
    }
  };

  useEffect(() => {
    locationPromptedRef.current = false;
    plannerDraftRef.current = false;
    setPlannerReady(false);
    setSelection(null);
    setPlannedPath([]);
    setPlannedPathDistanceM(0);
    setCoverageCells([]);
    setAreaSubmitted(false);
    setDrawingMode(false);
    setFirstPoint(null);
    void refreshPlannerState(true, false);
  }, [serverUrl]);

  useEffect(() => {
    const socket = new WebSocket(toWebSocketUrl(serverUrl));

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as PlannerSocketMessage;

        if (message.event === 'state.snapshot') {
          void applyRemotePlannerState(message.payload as PlannerPublicState, false, false);
          return;
        }

        if (message.event === 'area.updated') {
          void refreshPlannerState(false, true);
          return;
        }

        if (message.event === 'path.updated') {
          const nextPath = toPlannedCoordinates(message.payload?.points);
          setPlannedPath(nextPath);
          setPlannedPathDistanceM(computePathDistanceMeters(nextPath));
          if (nextPath.length > 1) {
            setMessage(`Route ready: ${nextPath.length} points over ${(computePathDistanceMeters(nextPath) / 1000).toFixed(2)} km.`);
          }
          void loadCoverageGrid(true);
          return;
        }

        if (message.event === 'telemetry.updated') {
          const nextRobotPoint = toLatLngPoint(message.payload?.robot);
          if (nextRobotPoint) {
            setRobotPoint(nextRobotPoint);
            appendRobotTrailPoint(nextRobotPoint);
          }
          void loadCoverageGrid(false);
        }
      } catch {
        // Ignore malformed socket messages and keep the planner interactive.
      }
    };

    return () => {
      socket.close();
    };
  }, [serverUrl]);

  const saveAreaToServer = async () => {
    if (!selection) {
      setMessage('Outline the service area first.');
      return false;
    }
    const resolvedBaseStation = baseStationPoint ?? selection.baseStation ?? null;
    if (!resolvedBaseStation) {
      setMessage('Set the base station location first so the route knows where to start and return.');
      return false;
    }

    try {
      const cellSizeM = resolvePlanningCellSizeM();
      await postJson(serverUrl, '/api/input-area', {
        baseStation: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        boundary: selection.boundary.map((point) => ({ lat: point.latitude, lon: point.longitude })),
        cellSizeM,
      });
      plannerDraftRef.current = false;
      setAreaSubmitted(true);
      const gridLoaded = await loadCoverageGrid(true);
      setMessage(
        gridLoaded
          ? `Service area saved at ${cellSizeM.toFixed(cellSizeM < 1 ? 2 : 1)}m grid resolution. You can build the route now.`
          : 'Service area saved, but the grid preview is unavailable right now.',
      );
      return true;
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Could not save the service area.');
      return false;
    }
  };

  const submitArea = async () => {
    setBusy('area');
    try {
      await saveAreaToServer();
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
    setBusy('path');
    try {
      if (!areaSubmitted) {
        const saved = await saveAreaToServer();
        if (!saved) return;
      }

      let result: { ok: boolean; points: PlannedPoint[]; mode?: string | null };
      let routeModeLabel = 'coverage route';
      try {
        result = await postJson<{ ok: boolean; points: PlannedPoint[]; mode?: string | null }>(serverUrl, '/api/path/plan', {
          mode: 'coverage',
          start: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          goal: { lat: selection.goal.latitude, lon: selection.goal.longitude },
          homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          coverageWidthM: 0.5,
          returnToBase: false,
          saltPct,
          brinePct,
        });
      } catch (coverageError) {
        result = await postJson<{ ok: boolean; points: PlannedPoint[]; mode?: string | null }>(serverUrl, '/api/path/plan', {
          mode: 'goal',
          start: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          goal: { lat: selection.goal.latitude, lon: selection.goal.longitude },
          homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          returnToBase: false,
          saltPct,
          brinePct,
        });
        routeModeLabel = 'travel route';
      }
      const points = (result?.points ?? []).map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
        headingDeg: point.headingDeg ?? null,
      }));
      plannerDraftRef.current = false;
      setPlannedPath(points);
      const totalDistance = computePathDistanceMeters(points);
      setPlannedPathDistanceM(totalDistance);
      await loadCoverageGrid(true);
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
        setMessage(`Route ready: ${points.length} points over ${(totalDistance / 1000).toFixed(2)} km (${routeModeLabel}).`);
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
  const arrowSize = areaM2 > 4000 ? 34 : areaM2 > 1600 ? 30 : 26;
  const pathArrowPoints = buildPathArrowPoints(plannedPath);
  const activeBaseStation = baseStationPoint ?? selection?.baseStation ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.mapFrame}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          mapType={mapType}
          showsPointsOfInterest={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          loadingEnabled
          loadingIndicatorColor="#2c6fb7"
          loadingBackgroundColor="#eef3f9"
          initialRegion={{
            latitude: mapCenter.latitude,
            longitude: mapCenter.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          maxZoomLevel={22}
          minZoomLevel={2}
          onPress={handleMapPress}
          onLongPress={handleMapLongPress}
          onRegionChangeComplete={(region) => {
            setMapCenter({ latitude: region.latitude, longitude: region.longitude });
            setMapSpan({ latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta });
          }}
          zoomEnabled
          scrollEnabled
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {activeBaseStation ? (
            <>
              <MapCircle
                center={activeBaseStation}
                radius={6}
                strokeColor="rgba(44,111,183,0.45)"
                fillColor="rgba(44,111,183,0.12)"
              />
              <Marker
                coordinate={activeBaseStation}
                anchor={{ x: 0.5, y: 1 }}
                title="Base station"
                description="Autonomy starts and returns here"
                tracksViewChanges={false}
                draggable
                onDragEnd={(event) => {
                  applyBaseStationPoint(event.nativeEvent.coordinate, 'Base station moved. Save the area again if you want the planner to use the new location.');
                }}
              >
                <View style={styles.baseStationMarkerWrap}>
                  <View style={styles.baseStationMarkerLabel}>
                    <Text style={styles.baseStationMarkerLabelText}>Base</Text>
                  </View>
                  <View style={styles.baseStationMarker}>
                    <MaterialCommunityIcons name="radio-tower" size={16} color="#ffffff" />
                  </View>
                </View>
              </Marker>
            </>
          ) : null}
          {robotTrail.length > 1 ? (
            <Polyline
              coordinates={robotTrail}
              strokeColor="rgba(22,50,79,0.28)"
              strokeWidth={3}
              geodesic
            />
          ) : null}
          {robotPoint ? (
            <Marker
              coordinate={robotPoint}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              title="Robot"
              description="Live position"
              tracksViewChanges={false}
            >
              <View style={styles.robotMarker}>
                <MaterialCommunityIcons name="robot-industrial" size={16} color="#ffffff" />
              </View>
            </Marker>
          ) : null}
          {drawingMode && firstPoint ? (
            <Marker
              coordinate={firstPoint}
              anchor={{ x: 0.5, y: 0.5 }}
              title="First corner"
              description="Tap the opposite corner to finish the area"
              tracksViewChanges={false}
            >
              <CornerPin tone="start" />
            </Marker>
          ) : null}
          {selection ? (
            <>
              {coverageCells.map((cell) => (
                <Polygon
                  key={`grid-${cell.row}-${cell.col}`}
                  coordinates={cell.polygon}
                  strokeColor={cell.covered ? 'rgba(42,116,215,0.36)' : 'rgba(42,116,215,0.22)'}
                  fillColor={cell.covered ? 'rgba(62,143,255,0.14)' : 'rgba(62,143,255,0.08)'}
                  strokeWidth={1.2}
                />
              ))}
              <Polygon
                coordinates={selection.boundary}
                strokeColor="#2a74d7"
                fillColor="rgba(62,143,255,0.16)"
                strokeWidth={3}
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
                  tracksViewChanges={false}
                >
                  <CornerPin
                    tone={index === 0 ? 'start' : index === 2 ? 'goal' : 'edge'}
                  />
                </Marker>
              ))}
              {plannedPath.length > 1 ? (
                <>
                  <Polyline
                    coordinates={plannedPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))}
                    strokeColor="rgba(255,255,255,0.96)"
                    strokeWidth={10}
                    geodesic
                  />
                  <Polyline
                    coordinates={plannedPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))}
                    strokeColor="#6f52ed"
                    strokeWidth={5}
                    geodesic
                  />
                  {pathArrowPoints.map((point, index) => (
                    <Marker
                      key={`path-arrow-${index}`}
                      coordinate={point}
                      anchor={{ x: 0.5, y: 0.5 }}
                      zIndex={30}
                      flat
                      tracksViewChanges
                    >
                      <View
                        style={[
                          styles.pathArrow,
                          { width: arrowSize, height: arrowSize },
                          { transform: [{ rotate: `${point.headingDeg ?? 0}deg` }] },
                        ]}
                      >
                        <DirectionArrow size={Math.max(18, arrowSize)} color="#6f52ed" />
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
          <AppButton
            label={mapType === 'standard' ? 'Satellite' : 'Standard'}
            onPress={toggleMapMode}
            variant={mapType === 'satellite' ? 'primary' : 'outline'}
            compact
            style={[styles.mapTypeAction, mapType === 'satellite' ? styles.mapTypeActionActive : null]}
          />
        </View>
      </View>

      <View pointerEvents="box-none" style={[styles.overlay, { backgroundColor: theme.overlayBg, borderColor: theme.overlayBorder, bottom: insets.bottom + 14 }]}>
        <Text style={[styles.overlayText, { color: theme.text }]} numberOfLines={2}>{message}</Text>

        {activeBaseStation ? (
          <View style={styles.baseStationSummaryBlock}>
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
                label={placingBaseStation ? 'Cancel' : (baseStationControlsVisible ? 'Hide Move' : 'Move Base')}
                onPress={() => {
                  if (placingBaseStation) {
                    setPlacingBaseStation(false);
                    setBaseStationControlsVisible(false);
                    setMessage('Base station placement canceled.');
                    return;
                  }
                  setBaseStationControlsVisible((current) => !current);
                }}
                variant="outline"
                compact
                style={styles.summaryActionButton}
              />
            </View>
            {baseStationControlsVisible ? (
              <View style={styles.actionRow}>
                <AppButton
                  label={busy === 'locate' ? 'Locating...' : 'Use My Location'}
                  onPress={() => { void usePhoneLocationForBaseStation(); }}
                  disabled={busy !== null}
                  variant="outline"
                  style={styles.secondaryAction}
                />
                <AppButton
                  label={placingBaseStation ? 'Tap to Place' : 'Tap on Map'}
                  onPress={() => {
                    if (placingBaseStation) {
                      setMessage('Tap directly on the map where the base station should be placed.');
                      return;
                    }
                    beginBaseStationPlacement();
                  }}
                  variant="outline"
                  style={styles.secondaryAction}
                />
              </View>
            ) : null}
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
              label={placingBaseStation ? 'Cancel' : 'Tap on Map'}
              onPress={() => {
                if (placingBaseStation) {
                  setPlacingBaseStation(false);
                  setMessage(DEFAULT_PLANNING_MESSAGE);
                  return;
                }
                beginBaseStationPlacement();
              }}
              variant="outline"
              style={styles.secondaryAction}
            />
          </View>
        )}

        {(placingBaseStation || drawingMode) ? (
          <Text style={styles.pathMetaText}>
            {placingBaseStation
              ? 'Tap once on the map to place the base station.'
              : (firstPoint
                  ? 'Tap the opposite corner on the map to finish the area.'
                  : 'Tap the first corner on the map to start the area.')}
          </Text>
        ) : null}

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
            label="Outline Area"
            onPress={() => {
              if (!drawingMode) {
                beginAreaSelection();
                return;
              }
              setMessage(
                firstPoint
                  ? 'Tap the opposite corner on the map to finish the area.'
                  : 'Tap the first corner on the map to start the area.',
              );
            }}
            variant={drawingMode ? 'primary' : 'outline'}
            style={[styles.secondaryAction, drawingMode ? styles.outlineAreaButtonActive : null]}
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
            disabled={!selection || busy !== null}
            variant="primary"
            style={[
              styles.statefulButton,
              styles.actionFill,
              !selection || busy !== null ? styles.buttonDisabled : styles.buttonPlan,
            ]}
          />
        </View>
      </View>
      <AppNoticeModal
        visible={locationPromptVisible}
        title="Set base station location"
        message="Use your phone location for the base station, or tap directly on the map to place it manually before planning the route."
        tone="info"
        primaryAction={{
          label: 'Use My Location',
          onPress: () => { void usePhoneLocationForBaseStation(); },
        }}
        secondaryAction={{
          label: 'Mark on Map',
          variant: 'outline',
          onPress: () => {
            beginBaseStationPlacement();
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
  crosshairWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -24,
    marginTop: -24,
    zIndex: 15,
    elevation: 8,
  },
  crosshairRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,251,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(31,95,159,0.22)',
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
    paddingVertical: 8,
    paddingHorizontal: 6,
    zIndex: 30,
    elevation: 12,
  },
  modeChip: {
    position: 'absolute',
    left: 16,
    top: 64,
    width: 196,
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
    flexDirection: 'row',
    gap: 6,
  },
  mapTypeAction: {
    flex: 1,
    minHeight: 34,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  mapTypeActionActive: {
    borderColor: '#1f5f9f',
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
    minWidth: 34,
    minHeight: 36,
    paddingHorizontal: 0,
  },
  zoomButtonText: {
    color: '#16324f',
    fontSize: 17,
    lineHeight: 17,
  },
  overlayText: {
    marginBottom: 2,
    color: '#16324f',
    fontSize: 11,
    lineHeight: 15,
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
  baseStationSummaryBlock: {
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
    fontSize: 9,
    marginTop: 6,
    marginBottom: 1,
    fontWeight: '600',
    lineHeight: 12,
  },
  pinMarkerWrap: {
    width: 34,
    height: 42,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  baseStationMarkerWrap: {
    alignItems: 'center',
    gap: 4,
  },
  baseStationMarkerLabel: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#16324f',
    borderWidth: 1,
    borderColor: '#2c6fb7',
  },
  baseStationMarkerLabelText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  baseStationMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
  robotMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2d8a65',
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
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
  pathArrowIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pathArrowOutline: {
    position: 'absolute',
  },
  pathArrowFill: {
    position: 'absolute',
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
  outlineAreaButtonActive: {
    backgroundColor: '#2a74d7',
    borderColor: '#1f5f9f',
  },
  buttonDisabled: {
    backgroundColor: '#9eabb8',
  },
});















/**
 * GoogleMapView.tsx
 *
 * Interactive planning surface for the operator. This component combines map
 * drafting, route visualization, live telemetry overlays, and demo-path state
 * because those experiences all need the same synchronized map state.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { Circle as MapCircle, LatLng, LongPressEvent, MapPressEvent, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Defs, LinearGradient, Path as SvgPath, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getGatewayJsonAllowError, getJson, postJson, toWebSocketUrl } from '../../lib/serverApi';
import type { DemoPathPoint, LatLonPayload, PlannerPublicState, PlannerStateResponse } from '../../lib/plannerTypes';
import AppButton from '../common/AppButton';
import AppNoticeModal from '../common/AppNoticeModal';

/** Operator-drawn rectangle that represents the service area on the map. */
type RectangleSelection = {
  baseStation: LatLng;
  goal: LatLng;
  boundary: LatLng[];
};

/** A single waypoint that may carry a pre-computed heading for arrow display. */
type PlannedCoordinate = {
  latitude: number;
  longitude: number;
  headingDeg?: number | null;
};

/** One cell of the backend's coverage grid, together with its map polygon. */
type CoverageCell = {
  row: number;
  col: number;
  covered: boolean;
  hits: number;
  lastSeenMs: number;
  polygon: LatLng[];
};

/** Shape of the `/api/coverage` response used to render the coverage grid. */
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

/** Snapshot of robot sensor data extracted from an incoming telemetry payload. */
type RobotLiveTelemetry = {
  headingDeg: number | null;
  gpsSat: number | null;
  gpsHdop: number | null;
  proxLeft: number | null;
  proxRight: number | null;
  state: string | null;
};

type BackendStatusResponse = {
  manual_command_url?: string | null;
};

type GatewayStatusResponse = {
  ok?: boolean;
  manualReady?: boolean;
  robotTelemetry?: LatLonPayload | null;
};

/** Shape of the planner WebSocket push messages we handle in this component. */
type PlannerSocketMessage = {
  event?: string;
  payload?: {
    baseStation?: LatLonPayload | null;
    remoteBaseStation?: LatLonPayload | null;
    homePoint?: LatLonPayload | null;
    boundary?: LatLonPayload[] | null;
    robot?: LatLonPayload | null;
    trail?: LatLonPayload[] | null;
    points?: DemoPathPoint[] | null;
    arrows?: DemoPathPoint[] | null;
  } | null;
  at?: number;
};

/** Props accepted by {@link GoogleMapView}. */
type Props = {
  serverUrl: string;
  saltPct: number;
  brinePct: number;
  demoPathPoints?: DemoPathPoint[];
};

type PlanningCacheState = {
  drawingMode: boolean;
  firstPoint: LatLng | null;
  selection: RectangleSelection | null;
  baseStation: LatLng | null;
  plannedPath: PlannedCoordinate[];
  plannedArrows: PlannedCoordinate[];
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
const COVERAGE_CELL_SIZE_M = 0.5;
const MAP_THEME = {
  overlayBg: 'rgba(248,251,255,0.95)',
  overlayBorder: '#d9e4f0',
  text: '#16324f',
  muted: '#35506a',
};
const MAX_ROBOT_TRAIL_POINTS = 240;
const MAX_ROBOT_JUMP_METERS = 35;
const MIN_ROBOT_POINT_SEPARATION_M = 1.5;

/**
 * Normalises any raw heading value to the [0, 360) range.
 * Returns null if the value is not a finite number so callers can distinguish
 * "no heading available" from a valid 0° reading.
 */
function normalizeHeadingDeg(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/**
 * Returns the first value in `values` that converts to a finite number.
 * Used to coerce loosely-typed telemetry payloads where a field may appear
 * under different key names depending on firmware version.
 */
function toFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const next = Number(value);
    if (Number.isFinite(next)) return next;
  }
  return null;
}

/**
 * Extracts the fields we care about from a raw telemetry payload.
 * Falls back to null for every field when the payload is absent or malformed
 * so the UI can safely check individual fields without extra null guards.
 */
function toRobotLiveTelemetry(point: unknown): RobotLiveTelemetry {
  if (!point || typeof point !== 'object') {
    return { headingDeg: null, gpsSat: null, gpsHdop: null, proxLeft: null, proxRight: null, state: null };
  }

  const candidate = point as LatLonPayload;
  return {
    // Accept several key name variants so we stay compatible with older firmware.
    headingDeg: normalizeHeadingDeg(toFiniteNumber(candidate.headingDeg, candidate.heading, candidate.yaw)),
    gpsSat: toFiniteNumber(candidate.gpsSat, candidate.sat),
    gpsHdop: toFiniteNumber(candidate.gpsHdop, candidate.hdop),
    proxLeft: toFiniteNumber(candidate.prox?.left, candidate.pl),
    proxRight: toFiniteNumber(candidate.prox?.right, candidate.pr),
    state: typeof candidate.state === 'string' ? candidate.state : null,
  };
}

/**
 * Converts a loosely-typed payload to a `LatLng` pair, returning null on
 * invalid or placeholder coordinates.  Both `{lat, lon}` and
 * `{latitude, longitude}` key conventions are supported.
 */
function toLatLngPoint(point: unknown): LatLng | null {
  if (!point || typeof point !== 'object') return null;
  const candidate = point as LatLonPayload;
  const latitude = Number(candidate.lat ?? candidate.latitude);
  const longitude = Number(candidate.lon ?? candidate.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // Ignore zero-ish placeholder coordinates that appear before the robot has a fix.
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) return null;
  return { latitude, longitude };
}

/** Maps an array of raw payloads to valid `LatLng` points, dropping bad entries. */
function toLatLngPoints(points: unknown): LatLng[] {
  if (!Array.isArray(points)) return [];
  return points.map((point) => toLatLngPoint(point)).filter((point): point is LatLng => Boolean(point));
}

/**
 * Converts a raw waypoint array to `PlannedCoordinate` objects, preserving any
 * per-point heading so the arrow overlay can use the server-computed direction
 * rather than deriving it from segment geometry.
 */
function toPlannedCoordinates(points: unknown): PlannedCoordinate[] {
  if (!Array.isArray(points)) return [];
  return points.reduce<PlannedCoordinate[]>((coordinates, point) => {
    const coordinate = toLatLngPoint(point);
    if (!coordinate) return coordinates;
    coordinates.push({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      headingDeg: normalizeHeadingDeg((point as DemoPathPoint)?.headingDeg ?? null),
    });
    return coordinates;
  }, []);
}

// Cache map-planning state at module scope so switching tabs does not discard an
// operator's in-progress draft before it has been saved to the backend.
let planningCache: PlanningCacheState = {
  drawingMode: false,
  firstPoint: null,
  selection: null,
  baseStation: null,
  plannedPath: [],
  plannedArrows: [],
  plannedPathDistanceM: 0,
  coverageCells: [],
  areaSubmitted: false,
  message: DEFAULT_PLANNING_MESSAGE,
  mapType: 'standard',
  robotPoint: null,
  robotTrail: [],
};

/**
 * Colored SVG map pin used to mark boundary corners.
 * `tone` drives the palette: green for the base/start corner, red for the goal
 * corner, and purple for the intermediate boundary corners.
 */
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

/**
 * Navigation arrow rendered at path waypoints to show travel direction.
 * A white outline is drawn behind the colored fill using multiple offset copies
 * so the arrow remains visible against both light and dark map tiles.
 */
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

/**
 * Interactive planning surface for the operator.
 *
 * Responsibilities include:
 * - base-station placement via phone GPS or tap-to-place
 * - two-corner rectangle selection that is normalised to a consistent CCW quad
 * - area submission and coverage-path planning via the backend
 * - live robot telemetry and trail rendering over a WebSocket connection
 * - demo-path preview overlay when `demoPathPoints` are provided by the parent
 */
export default function GoogleMapView({ serverUrl, saltPct, brinePct, demoPathPoints = [] }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const [drawingMode, setDrawingMode] = useState(planningCache.drawingMode);
  const [firstPoint, setFirstPoint] = useState<LatLng | null>(planningCache.firstPoint);
  const [selection, setSelection] = useState<RectangleSelection | null>(planningCache.selection);
  const [baseStationPoint, setBaseStationPoint] = useState<LatLng | null>(planningCache.baseStation);
  const [placingBaseStation, setPlacingBaseStation] = useState(false);
  const [plannedPath, setPlannedPath] = useState<PlannedCoordinate[]>(planningCache.plannedPath);
  const [plannedArrows, setPlannedArrows] = useState<PlannedCoordinate[]>(planningCache.plannedArrows);
  const [plannedPathDistanceM, setPlannedPathDistanceM] = useState(planningCache.plannedPathDistanceM);
  const [coverageCells, setCoverageCells] = useState<CoverageCell[]>(planningCache.coverageCells);
  const [areaSubmitted, setAreaSubmitted] = useState(planningCache.areaSubmitted);
  const [message, setMessage] = useState(planningCache.message);
  const [robotPoint, setRobotPoint] = useState<LatLng | null>(planningCache.robotPoint);
  const [robotTrail, setRobotTrail] = useState<LatLng[]>(planningCache.robotTrail);
  const [robotTelemetry, setRobotTelemetry] = useState<RobotLiveTelemetry>({
    headingDeg: null,
    gpsSat: null,
    gpsHdop: null,
    proxLeft: null,
    proxRight: null,
    state: null,
  });
  const [manualGatewayUrl, setManualGatewayUrl] = useState<string | null>(null);
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
  const robotPointRef = useRef<LatLng | null>(planningCache.robotPoint);

  const getLocationModule = () => {
    try {
      return require('expo-location');
    } catch {
      return null;
    }
  };

  const centerOnCoordinate = (coordinate: LatLng, zoom = 18) => {
    // Defer the camera animation to the next frame so any pending state updates
    // that change the map region have already been committed.
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
    // Let the native map SDK handle viewport fitting across device sizes.
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
    // Moving the base station invalidates the previously-saved area and path
    // because the planner uses the base station as the route start/return point.
    resetPlanningState();
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
    setPlannedArrows([]);
    setPlannedPathDistanceM(0);
    setCoverageCells([]);
  };

  // Keep the module-level cache in sync with React state so the planner
  // survives tab switches without losing the operator's in-progress draft.
  useEffect(() => {
    planningCache = {
      drawingMode,
      firstPoint,
      selection,
      baseStation: baseStationPoint,
      plannedPath,
      plannedArrows,
      plannedPathDistanceM,
      coverageCells,
      areaSubmitted,
      message,
      mapType,
      robotPoint,
      robotTrail,
    };
  }, [drawingMode, firstPoint, selection, baseStationPoint, plannedPath, plannedArrows, plannedPathDistanceM, coverageCells, areaSubmitted, message, mapType, robotPoint, robotTrail]);

  useEffect(() => {
    robotPointRef.current = robotPoint;
  }, [robotPoint]);

  // Discover the direct gateway URL from the backend; fall back to a
  // sensible default if the request fails or the field is absent.
  useEffect(() => {
    let cancelled = false;

    const refreshGatewayUrl = async () => {
      try {
        const status = await getJson<BackendStatusResponse>(serverUrl, '/status', 2500);
        const discovered = typeof status?.manual_command_url === 'string' && status.manual_command_url.trim()
          ? status.manual_command_url.trim()
          : 'http://172.20.10.2';
        if (!cancelled) {
          setManualGatewayUrl(discovered);
        }
      } catch {
        if (!cancelled) {
          setManualGatewayUrl((current) => current ?? 'http://172.20.10.2');
        }
      }
    };

    void refreshGatewayUrl();
    const timer = setInterval(() => {
      void refreshGatewayUrl();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [serverUrl]);

  /**
   * Haversine great-circle distance between two lat/lng points in metres.
   * Accurate enough for distances up to a few kilometres; the small-angle
   * approximation error is negligible for the planning areas we target.
   */
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

  /** Returns width, height, and area of the current selection using haversine distances. */
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
    // Shoelace formula on the boundary polygon to get signed area in
    // degree² units, then scale to m² using the cosine-corrected metre/degree
    // factor at the midpoint latitude.
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
    return COVERAGE_CELL_SIZE_M;
  };

  /**
   * Computes the forward bearing (degrees) from `from` to `to` using a
   * flat-earth approximation corrected for latitude compression on the
   * longitude axis.  Suitable for short segments (< ~5 km).
   */
  const computeHeadingBetweenPoints = (from: LatLng | PlannedCoordinate, to: LatLng | PlannedCoordinate) => {
    const avgLatRad = ((from.latitude + to.latitude) * Math.PI) / 360;
    const dNorth = to.latitude - from.latitude;
    const dEast = (to.longitude - from.longitude) * Math.cos(avgLatRad);
    const angle = (Math.atan2(dEast, dNorth) * 180) / Math.PI;
    return normalizeHeadingDeg(angle);
  };

  /**
   * Returns the smallest angular difference (0–180°) between two headings.
   * Handles wrap-around at the 0°/360° boundary so, e.g., 350° and 10° are
   * only 20° apart rather than 340°.
   */
  const headingDeltaDeg = (from: number | null, to: number | null) => {
    if (from == null || to == null) return null;
    const raw = Math.abs(from - to) % 360;
    return raw > 180 ? 360 - raw : raw;
  };

  /**
   * Generates evenly-spaced arrow waypoints along the planned path so the
   * operator can see the robot's intended travel direction without cluttering
   * the map.
   *
   * Key decisions:
   * - Spacing and size scale with the service-area size so large fields don't
   *   look sparse and small areas don't look crowded.
   * - Arrow headings are quantised to 5° to reduce re-renders of flat markers.
   * - The lane heading is derived from the first boundary edge, then forced
   *   toward east (90°) so arrows consistently point "forward" rather than
   *   "backward" on return passes.
   * - A minimum separation guard prevents arrows from stacking at tight curves.
   */
  const buildPathArrowPoints = (points: PlannedCoordinate[], areaM2 = 0) => {
    if (points.length < 2) return [];

    const arrows: PlannedCoordinate[] = [];
    const spacingM = areaM2 > 5000 ? 12 : areaM2 > 1600 ? 10 : 8;
    const minArrowSeparationM = Math.max(3.2, spacingM * 0.55);
    const quantizeHeadingDeg = (heading: number) => Math.round(heading / 5) * 5;

    const resolveLeftToRightHeadingDeg = () => {
      const boundary = selection?.boundary;
      if (!boundary || boundary.length < 2) return 90;
      const edgeHeading = computeHeadingBetweenPoints(boundary[0], boundary[1]);
      if (edgeHeading == null) return 90;
      const forward = normalizeHeadingDeg(edgeHeading) ?? 90;
      const reverse = normalizeHeadingDeg(forward + 180) ?? forward;
      // Pick whichever direction is closer to east (90°) so the majority of
      // arrows point roughly left-to-right across the service area.
      const forwardToEast = headingDeltaDeg(forward, 90) ?? 180;
      const reverseToEast = headingDeltaDeg(reverse, 90) ?? 180;
      return forwardToEast <= reverseToEast ? forward : reverse;
    };

    const laneHeadingDeg = resolveLeftToRightHeadingDeg();

    const segments: Array<{ from: PlannedCoordinate; to: PlannedCoordinate; lenM: number }> = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i];
      const to = points[i + 1];
      const lenM = haversineDistanceMeters(from, to);
      if (!Number.isFinite(lenM) || lenM <= 0.01) continue;
      segments.push({ from, to, lenM });
    }

    if (segments.length === 0) return [];

    const totalLenM = segments.reduce((sum, segment) => sum + segment.lenM, 0);
    const initialOffsetM = Math.min(0.8, spacingM * 0.2);

    // Walk the path at a fixed metre step, interpolating arrow positions
    // across segment boundaries to keep spacing uniform regardless of how
    // densely the planner samples the route.
    let segmentIndex = 0;
    let segmentStartDistM = 0;

    for (let targetDistM = initialOffsetM; targetDistM < totalLenM; targetDistM += spacingM) {
      while (
        segmentIndex < segments.length - 1
        && (segmentStartDistM + segments[segmentIndex].lenM) < targetDistM
      ) {
        segmentStartDistM += segments[segmentIndex].lenM;
        segmentIndex += 1;
      }

      const segment = segments[segmentIndex];
      const distIntoSegmentM = Math.max(0, targetDistM - segmentStartDistM);
      const t = Math.max(0, Math.min(1, distIntoSegmentM / segment.lenM));
      const arrowHeadingDeg = laneHeadingDeg;

      const nextArrow: PlannedCoordinate = {
        latitude: segment.from.latitude + ((segment.to.latitude - segment.from.latitude) * t),
        longitude: segment.from.longitude + ((segment.to.longitude - segment.from.longitude) * t),
        headingDeg: quantizeHeadingDeg(arrowHeadingDeg),
      };

      const touchesExisting = arrows.some((existing) => (
        haversineDistanceMeters(existing, nextArrow) < minArrowSeparationM
      ));
      if (touchesExisting) continue;

      arrows.push(nextArrow);
    }

    if (arrows.length === 0) {
      const from = points[0];
      const to = points[1];
      const headingDeg = normalizeHeadingDeg(from.headingDeg ?? to.headingDeg ?? computeHeadingBetweenPoints(from, to));
      if (headingDeg != null) {
        const arrowHeadingDeg = laneHeadingDeg;
        arrows.push({
          latitude: (from.latitude + to.latitude) * 0.5,
          longitude: (from.longitude + to.longitude) * 0.5,
          headingDeg: quantizeHeadingDeg(arrowHeadingDeg),
        });
      }
    }

    return arrows;
  };

  /**
   * Removes duplicate or near-duplicate points from a planned path and drops a
   * final "spike" segment when it is significantly longer than the preceding
   * leg and sharply changes direction.  Such spikes can appear when the planner
   * appends a home-return segment that is out of character with the coverage
   * lanes.
   */
  const sanitizePlannedPath = (points: PlannedCoordinate[]) => {
    if (points.length < 2) return points;

    const cleaned: PlannedCoordinate[] = [];
    for (const point of points) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
      const prev = cleaned[cleaned.length - 1];
      if (!prev) {
        cleaned.push(point);
        continue;
      }
      if (haversineDistanceMeters(prev, point) < 0.15) continue;
      cleaned.push(point);
    }

    if (cleaned.length < 4) return cleaned;

    const last = cleaned[cleaned.length - 1];
    const prev = cleaned[cleaned.length - 2];
    const prev2 = cleaned[cleaned.length - 3];
    const tailLenM = haversineDistanceMeters(prev, last);
    const prevLenM = haversineDistanceMeters(prev2, prev);
    const tailHeading = computeHeadingBetweenPoints(prev, last);
    const prevHeading = computeHeadingBetweenPoints(prev2, prev);
    const tailTurn = headingDeltaDeg(prevHeading, tailHeading) ?? 0;

    // Remove a final spike segment that is much longer than the preceding leg and sharply changes direction.
    if (tailLenM > Math.max(12, prevLenM * 3.5) && tailTurn > 55) {
      return cleaned.slice(0, -1);
    }

    return cleaned;
  };

  /**
   * Normalises a raw four-point boundary polygon so that:
   * 1. Duplicate and near-duplicate corners are removed.
   * 2. Points are sorted into counter-clockwise winding order using their
   *    centroid angles (so the Polygon component draws the correct shape).
   * 3. The sequence is rotated so the corner closest to `anchor` (the base
   *    station) comes first, making index 0 the consistent "start" corner.
   */
  const normalizeBoundaryPoints = (boundary: LatLng[], anchor: LatLng | null = null): LatLng[] => {
    if (boundary.length < 4) return boundary;

    const unique: LatLng[] = [];
    for (const point of boundary) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
      const duplicate = unique.some((candidate) => haversineDistanceMeters(candidate, point) < 0.2);
      if (!duplicate) unique.push(point);
    }

    if (unique.length < 4) return boundary.slice(0, 4);
    const quad = unique.slice(0, 4);

    const centroid = quad.reduce(
      (acc, point) => ({
        latitude: acc.latitude + point.latitude,
        longitude: acc.longitude + point.longitude,
      }),
      { latitude: 0, longitude: 0 },
    );
    centroid.latitude /= quad.length;
    centroid.longitude /= quad.length;

    // Sort corners by their polar angle relative to the centroid to obtain a
    // consistent CCW ordering before checking the signed-area winding.
    const sorted = [...quad].sort((a, b) => {
      const angleA = Math.atan2(a.latitude - centroid.latitude, a.longitude - centroid.longitude);
      const angleB = Math.atan2(b.latitude - centroid.latitude, b.longitude - centroid.longitude);
      return angleA - angleB;
    });

    // Shoelace signed-area: positive → CCW in standard (x=lon, y=lat) space.
    const signedArea = sorted.reduce((acc, point, index) => {
      const next = sorted[(index + 1) % sorted.length];
      return acc + ((point.longitude * next.latitude) - (next.longitude * point.latitude));
    }, 0);
    const ccw = signedArea > 0 ? sorted : [...sorted].reverse();

    // Rotate the CCW sequence so the corner closest to the anchor (base
    // station) is at index 0, making index 2 the diagonally opposite "goal".
    const reference = anchor ?? boundary[0] ?? ccw[0];
    let startIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ccw.length; i += 1) {
      const distance = haversineDistanceMeters(reference, ccw[i]);
      if (distance < minDistance) {
        minDistance = distance;
        startIndex = i;
      }
    }

    return [
      ccw[startIndex],
      ccw[(startIndex + 1) % ccw.length],
      ccw[(startIndex + 2) % ccw.length],
      ccw[(startIndex + 3) % ccw.length],
    ];
  };

  const cornerLabels = ['Base Corner', 'Boundary Corner', 'Goal Corner', 'Boundary Corner'];

  const updateSelectionFromBoundary = (boundary: LatLng[]) => {
    if (boundary.length !== 4) return;
    plannerDraftRef.current = true;
    const normalizedBoundary = normalizeBoundaryPoints(boundary, baseStationPoint ?? selection?.baseStation ?? null);
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
    // Expand the two diagonal corners into a four-point axis-aligned rectangle,
    // then normalise so the result has a consistent winding and the base-station
    // corner is first.
    const boundary = normalizeBoundaryPoints([
      firstPoint,
      { latitude: firstPoint.latitude, longitude: secondPoint.longitude },
      secondPoint,
      { latitude: secondPoint.latitude, longitude: firstPoint.longitude },
    ], baseStationPoint ?? firstPoint);
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

  // Show the base-station location prompt exactly once per server URL after the
  // planner state has loaded and only when no base station has been placed yet.
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
    // Coalesce concurrent callers: if a request is already in flight, return
    // the same promise rather than firing a duplicate HTTP call.
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

  /**
   * Filters raw robot trail points: drops points that are too close together
   * (duplicates from high-frequency telemetry), discards large jumps that
   * indicate a GPS glitch, and caps the total stored points to keep rendering
   * fast on long missions.
   */
  const sanitizeRobotTrail = (points: LatLng[]) => {
    if (points.length === 0) return [];
    const filtered: LatLng[] = [];
    for (const point of points) {
      const lastPoint = filtered[filtered.length - 1];
      if (!lastPoint) {
        filtered.push(point);
        continue;
      }
      const jumpMeters = haversineDistanceMeters(lastPoint, point);
      if (jumpMeters < MIN_ROBOT_POINT_SEPARATION_M) {
        continue;
      }
      if (jumpMeters > MAX_ROBOT_JUMP_METERS) {
        continue;
      }
      filtered.push(point);
    }
    return filtered.slice(-MAX_ROBOT_TRAIL_POINTS);
  };

  const appendRobotTrailPoint = (coordinate: LatLng) => {
    setRobotTrail((current) => sanitizeRobotTrail([...current, coordinate]));
  };

  // Poll the manual gateway directly when a URL is available so robot telemetry
  // stays live even when the main server WebSocket is not reachable.
  useEffect(() => {
    if (!manualGatewayUrl) return;
    let cancelled = false;

    const refreshDirectGatewayTelemetry = async () => {
      try {
        const response = await getGatewayJsonAllowError<GatewayStatusResponse>(manualGatewayUrl, '/status', 1500);
        const nextTelemetry = response.data?.robotTelemetry ?? null;
        if (!response.ok || !nextTelemetry || cancelled) return;

        const parsedTelemetry = toRobotLiveTelemetry(nextTelemetry);
        setRobotTelemetry((current) => ({
          headingDeg: parsedTelemetry.headingDeg ?? current.headingDeg,
          gpsSat: parsedTelemetry.gpsSat ?? current.gpsSat,
          gpsHdop: parsedTelemetry.gpsHdop ?? current.gpsHdop,
          proxLeft: parsedTelemetry.proxLeft ?? current.proxLeft,
          proxRight: parsedTelemetry.proxRight ?? current.proxRight,
          state: parsedTelemetry.state ?? current.state,
        }));

        const nextRobotPoint = toLatLngPoint(nextTelemetry);
        if (nextRobotPoint) {
          const lastPoint = robotPointRef.current;
          const jumpMeters = lastPoint ? haversineDistanceMeters(lastPoint, nextRobotPoint) : 0;
          if (!lastPoint || jumpMeters <= MAX_ROBOT_JUMP_METERS) {
            setRobotPoint(nextRobotPoint);
            appendRobotTrailPoint(nextRobotPoint);
          }
        }
      } catch {
        // Ignore direct gateway polling failures and keep existing telemetry visible.
      }
    };

    void refreshDirectGatewayTelemetry();
    const timer = setInterval(() => {
      void refreshDirectGatewayTelemetry();
    }, 350);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [manualGatewayUrl]);

  /**
   * Merges a remote planner state snapshot into local UI state.
   *
   * `preserveLocalPlanning` is true when the operator has unsaved local edits
   * and `includePlanningState` is false; in that case we only update telemetry
   * (robot position/trail/heading) and leave the draft area and path intact.
   */
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
    const normalizedRemoteBoundary = nextBoundary.length === 4
      ? normalizeBoundaryPoints(nextBoundary, nextBaseStation ?? null)
      : nextBoundary;
    const nextPlannedPath = preserveLocalPlanning
      ? plannedPath
      : (includePlanningState
          ? sanitizePlannedPath(toPlannedCoordinates(remoteState.lastPath))
          : []);
    const nextPlannedArrows = preserveLocalPlanning
      ? plannedArrows
      : (includePlanningState
          ? toPlannedCoordinates(remoteState.lastArrows)
          : []);
    const nextRobotPoint = toLatLngPoint(remoteState.robot);
    const nextRobotTrail = sanitizeRobotTrail(toLatLngPoints(remoteState.trail));

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

    if (normalizedRemoteBoundary.length === 4) {
      setSelection({
        boundary: normalizedRemoteBoundary,
        baseStation: nextBaseStation ?? normalizedRemoteBoundary[0],
        goal: normalizedRemoteBoundary[2],
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
      setPlannedArrows(nextPlannedArrows);
      setPlannedPathDistanceM(computePathDistanceMeters(nextPlannedPath));
    }
    setRobotPoint(nextRobotPoint);
    setRobotTrail(nextRobotTrail);
    setRobotTelemetry(toRobotLiveTelemetry(remoteState.robot));

    if (!preserveLocalPlanning && includePlanningState && nextPlannedPath.length > 1) {
      setMessage(`Saved route loaded: ${nextPlannedPath.length} points over ${(computePathDistanceMeters(nextPlannedPath) / 1000).toFixed(2)} km.`);
    } else if (includePlanningState && normalizedRemoteBoundary.length === 4) {
      setMessage('Saved service area loaded. You can adjust it or build the route again.');
    } else if (nextBaseStation) {
      setMessage('Base station loaded. Tap the map to outline the service area.');
    } else {
      setMessage(DEFAULT_PLANNING_MESSAGE);
    }

    if (fitToState) {
      const focusPoints = nextPlannedPath.length > 1
        ? nextPlannedPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))
        : normalizedRemoteBoundary.length === 4
          ? normalizedRemoteBoundary
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

  // Reset all local planning state on server URL change and reload the saved
  // planner state from scratch; `fitToState = true` centres the map on it.
  useEffect(() => {
    locationPromptedRef.current = false;
    plannerDraftRef.current = false;
    setPlannerReady(false);
    setSelection(null);
    setPlannedPath([]);
    setPlannedArrows([]);
    setPlannedPathDistanceM(0);
    setCoverageCells([]);
    setAreaSubmitted(false);
    setDrawingMode(false);
    setFirstPoint(null);
    setRobotPoint(null);
    setRobotTrail([]);
    void refreshPlannerState(true, false);
  }, [serverUrl]);

  // WebSocket listener for live planner events.  Only telemetry snapshots and
  // coverage/path updates come through here; area changes trigger a full REST
  // reload so the boundary is always authoritative.
  useEffect(() => {
    const socket = new WebSocket(toWebSocketUrl(serverUrl));

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as PlannerSocketMessage;

        if (message.event === 'state.snapshot') {
          // Lightweight telemetry push: preserve any unsaved local planning draft.
          void applyRemotePlannerState(message.payload as PlannerPublicState, false, false);
          return;
        }

        if (message.event === 'area.updated') {
          // A different client saved an area; do a full reload so the boundary
          // reflects what the backend considers authoritative.
          void refreshPlannerState(false, true);
          return;
        }

        if (message.event === 'path.updated') {
          const nextPath = sanitizePlannedPath(toPlannedCoordinates(message.payload?.points));
          const nextArrows = toPlannedCoordinates(message.payload?.arrows);
          setPlannedPath(nextPath);
          setPlannedArrows(nextArrows);
          setPlannedPathDistanceM(computePathDistanceMeters(nextPath));
          if (nextPath.length > 1) {
            setMessage(`Route ready: ${nextPath.length} points over ${(computePathDistanceMeters(nextPath) / 1000).toFixed(2)} km.`);
          }
          void loadCoverageGrid(true);
          return;
        }

        if (message.event === 'telemetry.updated') {
          const nextRobotPoint = toLatLngPoint(message.payload?.robot);
          setRobotTelemetry(toRobotLiveTelemetry(message.payload?.robot));
          if (nextRobotPoint) {
            const lastPoint = robotPointRef.current;
            const jumpMeters = lastPoint ? haversineDistanceMeters(lastPoint, nextRobotPoint) : 0;
            if (!lastPoint || jumpMeters <= MAX_ROBOT_JUMP_METERS) {
              setRobotPoint(nextRobotPoint);
              appendRobotTrailPoint(nextRobotPoint);
            }
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
      const normalizedBoundary = normalizeBoundaryPoints(selection.boundary, resolvedBaseStation);
      await postJson(serverUrl, '/api/input-area', {
        baseStation: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
        boundary: normalizedBoundary.map((point) => ({ lat: point.latitude, lon: point.longitude })),
        cellSizeM,
      });
      plannerDraftRef.current = false;
      setAreaSubmitted(true);
      const gridLoaded = await loadCoverageGrid(true);
      setMessage(
        gridLoaded
          ? 'Service area saved at 0.5m grid resolution. You can build the route now.'
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
      const normalizedBoundary = normalizeBoundaryPoints(selection.boundary, resolvedBaseStation);
      const normalizedGoal = normalizedBoundary[2] ?? selection.goal;

      if (!areaSubmitted) {
        const saved = await saveAreaToServer();
        if (!saved) return;
      }

      let result: { ok: boolean; points: DemoPathPoint[]; arrows?: DemoPathPoint[]; mode?: string | null };
      let routeModeLabel = 'coverage route';
      try {
        result = await postJson<{ ok: boolean; points: DemoPathPoint[]; arrows?: DemoPathPoint[]; mode?: string | null }>(serverUrl, '/api/path/plan', {
          mode: 'coverage',
          sweepDirection: 'leftToRight',
          start: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          goal: { lat: normalizedGoal.latitude, lon: normalizedGoal.longitude },
          homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          coverageWidthM: 0.5,
          returnToBase: false,
          saltPct,
          brinePct,
        });
      } catch (coverageError) {
        const errorMessage = String((coverageError as Error)?.message ?? '');
        const normalizedError = errorMessage.toLowerCase();
        // Older backends may not support coverage mode; fall back to a simple
        // goal-to-goal path so the operator can still test the flow.
        const allowGoalFallback =
          normalizedError.includes('coverage not supported') ||
          normalizedError.includes('unsupported mode') ||
          normalizedError.includes('mode must be') ||
          normalizedError.includes('422');

        if (!allowGoalFallback) {
          throw coverageError;
        }

        result = await postJson<{ ok: boolean; points: DemoPathPoint[]; arrows?: DemoPathPoint[]; mode?: string | null }>(serverUrl, '/api/path/plan', {
          mode: 'goal',
          start: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          goal: { lat: normalizedGoal.latitude, lon: normalizedGoal.longitude },
          homePoint: { lat: resolvedBaseStation.latitude, lon: resolvedBaseStation.longitude },
          returnToBase: false,
          saltPct,
          brinePct,
        });
        routeModeLabel = 'travel route';
      }
      const points = sanitizePlannedPath((result?.points ?? []).map((point) => ({
        latitude: point.lat,
        longitude: point.lon,
        headingDeg: point.headingDeg ?? null,
      })));
      const arrows = toPlannedCoordinates(result?.arrows);

      if (points.length < 2) {
        throw new Error('Planner returned too few points to build a usable route.');
      }

      plannerDraftRef.current = false;
      setPlannedPath(points);
      setPlannedArrows(arrows);
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
      setPlannedArrows([]);
      setPlannedPathDistanceM(0);
      setMessage(requestError instanceof Error ? requestError.message : 'Route planning failed.');
    } finally {
      setBusy(null);
    }
  };

  // Scale route rendering constants based on the service-area size so the
  // polyline and arrows look proportional at every zoom level.
  const { widthM, heightM, areaM2 } = getSelectionMetrics();
  const routeStrokeWidth = areaM2 > 5000 ? 3.4 : areaM2 > 1600 ? 3.0 : 2.6;
  const routeHaloWidth = routeStrokeWidth + 1.8;
  const arrowSize = areaM2 > 5000 ? 20 : areaM2 > 1600 ? 17 : 15;
  // Show the demo preview path (teal) in place of the planned path (purple)
  // when the parent has pushed demo waypoints for the operator to review.
  const demoPreviewPath = sanitizePlannedPath(toPlannedCoordinates(demoPathPoints));
  const showingDemoPreview = demoPreviewPath.length > 1;
  const displayPath = showingDemoPreview ? demoPreviewPath : plannedPath;
  const pathArrowPoints = showingDemoPreview
    ? demoPreviewPath.filter((point) => point.headingDeg != null)
    : plannedArrows;
  const activeBaseStation = baseStationPoint ?? selection?.baseStation ?? null;
  const displayRouteColor = showingDemoPreview ? '#00a88f' : '#6f52ed';

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
              <View style={[
                styles.robotMarker,
                robotTelemetry.headingDeg != null ? { transform: [{ rotate: `${robotTelemetry.headingDeg}deg` }] } : null,
              ]}>
                <MaterialCommunityIcons name="navigation" size={16} color="#ffffff" />
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
          {displayPath.length > 1 ? (
            <>
              <Polyline
                coordinates={displayPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))}
                strokeColor="rgba(255,255,255,0.96)"
                strokeWidth={routeHaloWidth}
                geodesic
              />
              <Polyline
                coordinates={displayPath.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))}
                strokeColor={displayRouteColor}
                strokeWidth={routeStrokeWidth}
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
                    <DirectionArrow size={Math.max(12, arrowSize - 1)} color={displayRouteColor} />
                  </View>
                </Marker>
              ))}
            </>
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
            </>
          ) : null}
        </MapView>
      </View>

      <View pointerEvents="box-none" style={[styles.zoomStack, { backgroundColor: MAP_THEME.overlayBg, borderColor: MAP_THEME.overlayBorder, top: insets.top + 14 }]}> 
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

      <View pointerEvents="box-none" style={[styles.modeChip, { backgroundColor: MAP_THEME.overlayBg, borderColor: MAP_THEME.overlayBorder, top: insets.top + 14 }]}> 
        <View style={styles.modeChipTextBlock}>
          <View style={styles.modeChipRow}>
            <Text style={[styles.modeChipText, { color: drawingMode ? '#1d7f4a' : MAP_THEME.muted }]}> 
              {drawingMode ? 'Drawing' : (selection ? 'Area Set' : 'Browse')}
            </Text>
            <MaterialCommunityIcons
              name={drawingMode ? 'vector-polyline-edit' : selection ? 'selection-drag' : 'map-search-outline'}
              size={16}
              color="#2c6fb7"
            />
          </View>
          <Text style={[styles.modeChipSub, { color: MAP_THEME.muted }]} numberOfLines={1}>
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

      <View pointerEvents="box-none" style={[styles.overlay, { backgroundColor: MAP_THEME.overlayBg, borderColor: MAP_THEME.overlayBorder, bottom: insets.bottom + 14 }]}> 
        <Text style={[styles.overlayText, { color: MAP_THEME.text }]} numberOfLines={2}>{message}</Text>

        {(robotTelemetry.state || robotTelemetry.headingDeg != null || robotTelemetry.gpsSat != null || robotTelemetry.proxLeft != null || robotTelemetry.proxRight != null) ? (
          <View style={styles.liveTelemetryRow}>
            {robotTelemetry.state ? (
              <View style={styles.liveTelemetryChip}>
                <Text style={styles.liveTelemetryText}>State {robotTelemetry.state}</Text>
              </View>
            ) : null}
            {robotTelemetry.headingDeg != null ? (
              <View style={styles.liveTelemetryChip}>
                <Text style={styles.liveTelemetryText}>Heading {robotTelemetry.headingDeg.toFixed(1)}°</Text>
              </View>
            ) : null}
            {(robotTelemetry.gpsSat != null || robotTelemetry.gpsHdop != null) ? (
              <View style={styles.liveTelemetryChip}>
                <Text style={styles.liveTelemetryText}>GPS {robotTelemetry.gpsSat ?? '--'} sat • HDOP {robotTelemetry.gpsHdop != null ? robotTelemetry.gpsHdop.toFixed(1) : '--'}</Text>
              </View>
            ) : null}
            {(robotTelemetry.proxLeft != null || robotTelemetry.proxRight != null) ? (
              <View style={styles.liveTelemetryChip}>
                <Text style={styles.liveTelemetryText}>Prox L {robotTelemetry.proxLeft ?? '--'} • R {robotTelemetry.proxRight ?? '--'} cm</Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
  liveTelemetryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  liveTelemetryChip: {
    borderRadius: 999,
    backgroundColor: '#eef4fb',
    borderWidth: 1,
    borderColor: '#d7e4f2',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  liveTelemetryText: {
    color: '#16324f',
    fontSize: 10,
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















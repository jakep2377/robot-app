/**
 * Shared planner/map payload types used by multiple screens and components.
 * Keeping them here avoids subtle drift between the map, weather, and app
 * shell when backend planner responses evolve.
 */
export type DemoPathPoint = {
  lat: number;
  lon: number;
  salt?: number;
  brine?: number;
  headingDeg?: number | null;
};

export type LatLonPayload = {
  lat?: number | null;
  lon?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  headingDeg?: number | null;
  heading?: number | null;
  yaw?: number | null;
  state?: string | null;
  timestampMs?: number | null;
  gpsSat?: number | null;
  gpsHdop?: number | null;
  sat?: number | null;
  hdop?: number | null;
  prox?: {
    left?: number | null;
    right?: number | null;
  } | null;
  pl?: number | null;
  pr?: number | null;
};

export type PlannerPublicState = {
  baseStation?: LatLonPayload | null;
  remoteBaseStation?: LatLonPayload | null;
  homePoint?: LatLonPayload | null;
  boundary?: LatLonPayload[] | null;
  robot?: LatLonPayload | null;
  trail?: LatLonPayload[] | null;
  lastPath?: DemoPathPoint[] | null;
  lastArrows?: DemoPathPoint[] | null;
};

export type PlannerStateResponse = {
  ok?: boolean;
  state?: PlannerPublicState | null;
};

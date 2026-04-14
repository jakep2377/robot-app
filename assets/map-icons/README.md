# Map Icon Pack

These SVGs are extracted to match the app's custom map visuals in `App/components/home/GoogleMapView.tsx`.

Files:
- `corner-pin-start.svg`
- `corner-pin-goal.svg`
- `corner-pin-edge.svg`
- `direction-arrow.svg`
- `base-station-marker.svg`
- `robot-marker.svg`

Notes:
- These are presentation/reuse assets and are not currently wired into runtime rendering.
- Geometry/colors were matched against `GoogleMapView.tsx` marker styles and components.
- Runtime map visuals are still component-drawn (React Native + SVG + icons).

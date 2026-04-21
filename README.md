# Robot App

React Native / Expo operator app for the robot system.

## Overview

- connects to the hosted `robot-lora-server`
- shows planning, supervision, weather, and manual-control workflows
- renders the service area, route, robot position, and telemetry-derived status
- provides operator actions for demo mode, route commit, mission control, and recovery

## Main Structure

- `App.tsx` - app shell, navigation, shared connection/discovery flow
- `App/screens` - operator screens such as planning, weather, and controller views
- `App/components` - reusable UI for cards, buttons, joystick, sliders, map helpers
- `App/lib` - server API helpers, planner payload types, treatment/weather logic

## Development

```bash
npm install
npm run start
```

Useful commands:

- `npm run android`
- `npm run web`
- `npm run typecheck`
- `npm run test:weather`

## Notes

- The app is designed around the hosted server flow rather than direct peer-to-peer control.
- `App/screens/ControllerScreen.tsx` is the main operator cockpit for manual control, readiness, and demo workflows.
- Shared planner response types live in `App/lib/plannerTypes.ts` so map/weather/controller views stay in sync with backend payloads.

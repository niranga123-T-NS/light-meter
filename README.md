# Light Meter

A cross-platform (iPhone + Android) app that measures ambient light level in **lux** (or foot-candles), built with Expo / React Native.

## How it measures light

| Platform | Source | Notes |
|---|---|---|
| Android | Hardware ambient light sensor (`expo-sensors` `LightSensor`) | True lux reading. The sensor is usually next to the front camera. |
| iPhone | Camera auto-exposure (custom native module in `modules/camera-light-meter`) | Apple does not let apps read the iPhone's light sensor, so the app reads the camera's shutter speed, ISO and aperture, computes EV₁₀₀, and converts it to lux (`lux ≈ 2.5 · 2^EV₁₀₀`). This is how professional iOS light-meter apps work. |

## Features

- **Meter** — live smoothed reading, lighting category (Dark → Direct sun), log-scale meter bar, 30-second live graph, min/avg/max, EV₁₀₀, hold, lux ⇄ foot-candle toggle, front/back camera on iPhone, calibration multiplier.
- **History** — tap *Save reading* to record the current level. Saved readings persist on the device (up to 500) with a chart, summary stats, per-item delete and clear-all.
- **Photo** — pick an ISO and get the shutter speed for each aperture (f/1.4–f/22), rounded to standard full stops. Green = handheld-safe (≥ 1/60s), yellow = use a tripod, faded = outside 30s–1/8000s.

## Project layout

```
App.tsx                         Main screen + tabs
src/useLightLevel.ts            Picks the platform source, smooths readings
src/history.ts                  Saved readings (JSON file via expo-file-system)
src/exposure.ts                 Photography exposure calculations
src/components/                 LiveChart, HistoryPanel, PhotoPanel, shared UI
modules/camera-light-meter/     Local Expo native module (iOS, Swift/AVFoundation)
app.json                        App config, including the camera permission text
eas.json                        Cloud build profiles
```

## Running it

> **Expo Go won't work on iPhone**, because the camera meter is custom native code. Use a development build.

```bash
npm install

# Local builds (needs Xcode on a Mac for iOS, Android Studio for Android)
npm run ios        # expo run:ios  (use a real iPhone — the simulator has no camera)
npm run android    # expo run:android

# Or build in the cloud with EAS (no Mac required)
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform all
npx expo start --dev-client
```

Installable test builds: `eas build --profile preview` (Android APK / iOS ad-hoc).
Store builds: `eas build --profile production`, then `eas submit`.

Before publishing, change `ios.bundleIdentifier` and `android.package` in `app.json` (currently `com.lightmeter.app`) to your own identifiers.

## Accuracy

Phone readings are approximate (typically ±10–20%, more at extremes). Use **Calibration** to match a known lux meter. On iPhone, use the **front** camera facing the light source for incident readings (like a light meter dome); the **back** camera meters the light reflected from what it's pointed at.

## Checks

```bash
npx tsc --noEmit
npm run lint
```

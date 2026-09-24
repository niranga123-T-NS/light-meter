import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { LightSensor } from 'expo-sensors';
import CameraLightMeter from '../modules/camera-light-meter';

export type LightSource = 'sensor' | 'camera';
export type CameraPosition = 'front' | 'back';

export type LightState = {
  status: 'starting' | 'running' | 'paused' | 'unavailable' | 'denied' | 'error';
  lux: number | null;
  source: LightSource | null;
  message?: string;
};

// Exponential moving average factor; lower = smoother but slower.
const SMOOTHING = 0.3;

export function useLightLevel(opts: {
  paused: boolean;
  cameraPosition: CameraPosition;
  calibration: number;
}): LightState {
  const { paused, cameraPosition, calibration } = opts;
  const [state, setState] = useState<LightState>({ status: 'starting', lux: null, source: null });
  const smoothed = useRef<number | null>(null);

  useEffect(() => {
    if (paused) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    smoothed.current = null;

    const push = (rawLux: number, source: LightSource) => {
      if (cancelled || !Number.isFinite(rawLux)) return;
      const prev = smoothed.current;
      const next = prev == null ? rawLux : prev + SMOOTHING * (rawLux - prev);
      smoothed.current = next;
      setState({ status: 'running', lux: next, source });
    };

    (async () => {
      try {
        if (Platform.OS === 'android') {
          if (!(await LightSensor.isAvailableAsync())) {
            setState({ status: 'unavailable', lux: null, source: null, message: 'This device has no ambient light sensor.' });
            return;
          }
          LightSensor.setUpdateInterval(200);
          const sub = LightSensor.addListener(({ illuminance }) => push(illuminance, 'sensor'));
          cleanup = () => sub.remove();
        } else if (Platform.OS === 'ios') {
          if (!CameraLightMeter) {
            setState({
              status: 'unavailable', lux: null, source: null,
              message: 'Camera meter needs a development build (not Expo Go).',
            });
            return;
          }
          if (!(await CameraLightMeter.requestPermissionAsync())) {
            setState({
              status: 'denied', lux: null, source: null,
              message: 'Camera access is needed to measure light on iPhone. Enable it in Settings.',
            });
            return;
          }
          const meter = CameraLightMeter;
          const sub = meter.addListener('onReading', (r) => push(r.lux, 'camera'));
          cleanup = () => {
            sub.remove();
            meter.stop();
          };
          await meter.start(cameraPosition);
        } else {
          setState({ status: 'unavailable', lux: null, source: null, message: 'Light metering is only supported on iOS and Android.' });
          return;
        }
        if (cancelled) cleanup?.();
      } catch (e) {
        if (!cancelled) {
          setState({ status: 'error', lux: null, source: null, message: String((e as Error)?.message ?? e) });
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [paused, cameraPosition]);

  // Held readings stay on screen while paused; calibration applies instantly.
  return {
    ...state,
    status: paused && state.status === 'running' ? 'paused' : state.status,
    lux: state.lux != null ? state.lux * calibration : null,
  };
}

export type LightCategory = { label: string; hint: string; color: string };

// Rough reference bands for everyday lighting.
export function categorize(lux: number): LightCategory {
  if (lux < 10) return { label: 'Dark', hint: 'Night / unlit room', color: '#5b6cff' };
  if (lux < 100) return { label: 'Dim', hint: 'Hallway, living room', color: '#7c8cff' };
  if (lux < 500) return { label: 'Indoor', hint: 'Home or office lighting', color: '#35c2a1' };
  if (lux < 1000) return { label: 'Bright indoor', hint: 'Task lighting, studio', color: '#8fd14f' };
  if (lux < 10000) return { label: 'Overcast', hint: 'Cloudy daylight, shade', color: '#f5c542' };
  if (lux < 30000) return { label: 'Daylight', hint: 'Full daylight', color: '#f59e42' };
  return { label: 'Direct sun', hint: 'Bright sunlight', color: '#f5624a' };
}

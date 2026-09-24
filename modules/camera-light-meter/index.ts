import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type CameraReading = {
  ev100: number;
  lux: number;
  iso: number;
  exposureDuration: number;
  aperture: number;
  timestamp: number;
};

type Events = {
  onReading: (reading: CameraReading) => void;
};

declare class CameraLightMeterModule extends NativeModule<Events> {
  isAvailableAsync(): Promise<boolean>;
  requestPermissionAsync(): Promise<boolean>;
  start(position: 'front' | 'back'): Promise<void>;
  stop(): Promise<void>;
}

// Null on Android, on web, and in Expo Go (which lacks this custom native code).
export default requireOptionalNativeModule<CameraLightMeterModule>('CameraLightMeter');

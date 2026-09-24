import AVFoundation
import ExpoModulesCore

private let EVENT_READING = "onReading"

// iOS does not expose the ambient light sensor to third-party apps, so we
// estimate scene brightness from the camera's continuous auto-exposure:
//   EV100 = log2(N² / t) - log2(ISO / 100) + exposureTargetOffset
//   lux  ≈ 2.5 · 2^EV100   (incident-light calibration constant C = 250)
public final class CameraLightMeterModule: Module {
  private let sessionQueue = DispatchQueue(label: "camera-light-meter.session")
  private let sampleQueue = DispatchQueue(label: "camera-light-meter.samples")
  private var session: AVCaptureSession?
  private var device: AVCaptureDevice?
  private var sampler: FrameSampler?

  public func definition() -> ModuleDefinition {
    Name("CameraLightMeter")

    Events(EVENT_READING)

    AsyncFunction("isAvailableAsync") { () -> Bool in
      return AVCaptureDevice.default(for: .video) != nil
    }

    AsyncFunction("requestPermissionAsync") { (promise: Promise) in
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized:
        promise.resolve(true)
      case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in
          promise.resolve(granted)
        }
      default:
        promise.resolve(false)
      }
    }

    // position: "front" (face the light source, like an incident meter) or "back"
    AsyncFunction("start") { (position: String, promise: Promise) in
      self.sessionQueue.async {
        do {
          try self.startSession(front: position == "front")
          promise.resolve(nil)
        } catch {
          promise.reject("E_CAMERA", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stop") {
      self.sessionQueue.async { self.stopSession() }
    }

    OnDestroy {
      self.sessionQueue.async { self.stopSession() }
    }
  }

  private func startSession(front: Bool) throws {
    stopSession()

    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      throw NSError(domain: "CameraLightMeter", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Camera permission not granted"
      ])
    }
    guard let device = AVCaptureDevice.default(
      .builtInWideAngleCamera, for: .video, position: front ? .front : .back
    ) else {
      throw NSError(domain: "CameraLightMeter", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "No camera available"
      ])
    }

    try device.lockForConfiguration()
    if device.isExposureModeSupported(.continuousAutoExposure) {
      device.exposureMode = .continuousAutoExposure
    }
    // Meter the whole frame evenly, not a face or focus point.
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
    }
    device.setExposureTargetBias(0, completionHandler: nil)
    device.unlockForConfiguration()

    let session = AVCaptureSession()
    session.beginConfiguration()
    session.sessionPreset = .low
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw NSError(domain: "CameraLightMeter", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "Cannot use camera input"
      ])
    }
    session.addInput(input)

    // A video output is needed for auto-exposure to run; frames are used only
    // as a clock to sample the exposure settings.
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    let sampler = FrameSampler { [weak self] in self?.emitReading() }
    output.setSampleBufferDelegate(sampler, queue: sampleQueue)
    if session.canAddOutput(output) {
      session.addOutput(output)
    }
    session.commitConfiguration()
    session.startRunning()

    self.session = session
    self.device = device
    self.sampler = sampler
  }

  private func stopSession() {
    session?.stopRunning()
    session = nil
    device = nil
    sampler = nil
  }

  private func emitReading() {
    guard let device else { return }
    let t = CMTimeGetSeconds(device.exposureDuration)
    let iso = Double(device.iso)
    let aperture = Double(device.lensAperture)
    guard t > 0, iso > 0, aperture > 0 else { return }

    // Positive offset means the image is brighter than AE's target, i.e. the
    // scene is brighter than the current settings imply (happens at AE limits).
    let offset = max(-8, min(8, Double(device.exposureTargetOffset)))
    let ev100 = log2(aperture * aperture / t) - log2(iso / 100) + offset
    let lux = 2.5 * pow(2, ev100)

    sendEvent(EVENT_READING, [
      "ev100": ev100,
      "lux": lux,
      "iso": iso,
      "exposureDuration": t,
      "aperture": aperture,
      "timestamp": Date().timeIntervalSince1970 * 1000
    ])
  }
}

private final class FrameSampler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let onSample: () -> Void
  private var lastSample = Date.distantPast

  init(onSample: @escaping () -> Void) {
    self.onSample = onSample
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    // ~5 readings per second is plenty for a meter display.
    let now = Date()
    guard now.timeIntervalSince(lastSample) >= 0.2 else { return }
    lastSample = now
    onSample()
  }
}

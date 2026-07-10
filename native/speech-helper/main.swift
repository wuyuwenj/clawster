import Foundation
import AVFoundation
import whisper

// Local speech-to-text helper.
//
// Captures microphone audio, resamples it to the 16 kHz mono float PCM that
// whisper.cpp expects, and transcribes it entirely on-device. No audio ever
// leaves the machine.
//
// Protocol (unchanged from the previous SFSpeechRecognizer helper):
//   stdin  : "start" | "stop" | "quit"
//   stdout : one JSON object per line
//            {"type":"status","state":"ready"|"recording"|"transcribing"|"stopped"}
//            {"type":"partial","text":...} / {"type":"final","text":...}
//            {"type":"error","message":...}

// MARK: - Constants

let kSampleRate: Double = 16000
// Whisper pads short inputs poorly; keep at least one second of audio.
let kMinSamples = Int(kSampleRate)
// Root-mean-square level above which a chunk counts as speech rather than room tone.
let kVoiceRMSThreshold: Float = 0.01
// Stop automatically once the user has been quiet for this long (matches the old helper).
let kSilenceTimeout: TimeInterval = 1.5
// Re-transcribe the buffer this often to produce interim results.
let kPartialInterval: TimeInterval = 0.9
// Hard cap so a stuck session cannot grow the buffer without bound.
let kMaxRecordingSeconds: Double = 120

// MARK: - JSON Output Helpers

let stdoutLock = NSLock()

func emit(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let str = String(data: data, encoding: .utf8) else { return }
    stdoutLock.lock()
    print(str)
    fflush(stdout)
    stdoutLock.unlock()
}

func emitStatus(_ state: String) {
    emit(["type": "status", "state": state])
}

func emitPartial(_ text: String) {
    emit(["type": "partial", "text": text])
}

func emitFinal(_ text: String) {
    emit(["type": "final", "text": text])
}

func emitError(_ message: String) {
    emit(["type": "error", "message": message])
}

// MARK: - Permission Check

func checkPermissions() {
    let micStatus: String
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: micStatus = "granted"
    case .denied: micStatus = "denied"
    case .restricted: micStatus = "restricted"
    case .notDetermined: micStatus = "not-determined"
    @unknown default: micStatus = "not-determined"
    }

    // Transcription runs locally, so macOS speech-recognition authorization no
    // longer applies. Reported as granted to keep the JSON shape stable.
    emit(["mic": micStatus, "speech": "granted"])
}

// MARK: - Whisper

final class WhisperEngine {
    private var ctx: OpaquePointer?
    private let language = strdup("en")
    private let threads: Int32

    init?(modelPath: String) {
        guard FileManager.default.fileExists(atPath: modelPath) else { return nil }

        var cparams = whisper_context_default_params()
        cparams.use_gpu = true

        guard let ctx = whisper_init_from_file_with_params(modelPath, cparams) else { return nil }
        self.ctx = ctx
        self.threads = Int32(max(1, min(8, ProcessInfo.processInfo.activeProcessorCount - 2)))
    }

    /// Releases the whisper context. ggml's Metal backend asserts during its own
    /// static teardown if a context is still alive, so this must run before exit().
    func shutdown() {
        guard let ctx = ctx else { return }
        whisper_free(ctx)
        self.ctx = nil
        free(language)
    }

    /// Transcribes 16 kHz mono float samples. Must not be called concurrently.
    func transcribe(_ samples: [Float]) -> String {
        guard let ctx = ctx else { return "" }

        var padded = samples
        if padded.count < kMinSamples {
            padded.append(contentsOf: [Float](repeating: 0, count: kMinSamples - padded.count))
        }

        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.print_realtime = false
        params.print_progress = false
        params.print_timestamps = false
        params.print_special = false
        params.translate = false
        params.no_timestamps = true
        params.suppress_blank = true
        params.no_context = true
        params.single_segment = false
        params.language = UnsafePointer(language)
        params.n_threads = threads
        // Disable temperature fallback: retries double worst-case latency and
        // rarely help on short push-to-talk utterances.
        params.temperature_inc = 0

        let status = padded.withUnsafeBufferPointer { buf in
            whisper_full(ctx, params, buf.baseAddress, Int32(buf.count))
        }
        guard status == 0 else { return "" }

        var text = ""
        for i in 0..<whisper_full_n_segments(ctx) {
            guard let segment = whisper_full_get_segment_text(ctx, i) else { continue }
            text += String(cString: segment)
        }
        return text
    }

    deinit {
        shutdown()
    }
}

// MARK: - Speech Manager

final class SpeechManager {
    private let engine: WhisperEngine
    private let audioEngine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: kSampleRate, channels: 1, interleaved: false)!

    // Transcription runs off the main queue; whisper contexts are not reentrant,
    // so every call is serialized here.
    private let transcribeQueue = DispatchQueue(label: "com.clawster.whisper.transcribe")
    private let samplesLock = NSLock()
    private var samples: [Float] = []

    private var isRecording = false
    private var pendingStartSequence: Int?
    private var nextStartSequence = 0
    private var partialInFlight = false
    private var partialTimer: DispatchSourceTimer?
    private var silenceTimer: DispatchWorkItem?
    private var heardVoice = false

    init(engine: WhisperEngine) {
        self.engine = engine
    }

    func requestMicPermission(completion: @escaping (Bool) -> Void) {
        if AVCaptureDevice.authorizationStatus(for: .audio) == .authorized {
            completion(true)
            return
        }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    func startRecording() {
        guard !isRecording && pendingStartSequence == nil else {
            emitError("Already recording")
            return
        }

        nextStartSequence += 1
        let startSequence = nextStartSequence
        pendingStartSequence = startSequence

        requestMicPermission { [weak self] granted in
            guard let self = self else { return }
            guard self.pendingStartSequence == startSequence else { return }
            self.pendingStartSequence = nil
            if !granted {
                emitError("Microphone permission denied. Please enable in System Settings > Privacy & Security > Microphone.")
                return
            }
            self.beginRecording()
        }
    }

    private func beginRecording() {
        samplesLock.lock()
        samples.removeAll(keepingCapacity: true)
        samplesLock.unlock()
        heardVoice = false

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        guard recordingFormat.sampleRate > 0 else {
            emitError("No microphone input is available")
            return
        }

        guard let converter = AVAudioConverter(from: recordingFormat, to: targetFormat) else {
            emitError("Failed to configure audio converter")
            return
        }
        self.converter = converter

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: recordingFormat) { [weak self] buffer, _ in
            self?.appendBuffer(buffer, using: converter)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
            emitStatus("recording")
            startPartialTimer()
        } catch {
            emitError("Failed to start audio engine: \(error.localizedDescription)")
            cleanupRecording()
        }
    }

    /// Resamples one tap buffer into the whisper input buffer and tracks voice activity.
    private func appendBuffer(_ buffer: AVAudioPCMBuffer, using converter: AVAudioConverter) {
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }

        guard error == nil, out.frameLength > 0, let channel = out.floatChannelData?[0] else { return }
        let chunk = Array(UnsafeBufferPointer(start: channel, count: Int(out.frameLength)))

        var sumSquares: Float = 0
        for sample in chunk { sumSquares += sample * sample }
        let rms = (sumSquares / Float(chunk.count)).squareRoot()

        samplesLock.lock()
        let overCap = samples.count >= Int(kSampleRate * kMaxRecordingSeconds)
        if !overCap { samples.append(contentsOf: chunk) }
        samplesLock.unlock()

        if overCap {
            DispatchQueue.main.async { [weak self] in self?.stopRecording() }
            return
        }

        if rms > kVoiceRMSThreshold {
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.isRecording else { return }
                self.heardVoice = true
                self.resetSilenceTimer()
            }
        }
    }

    private func snapshotSamples() -> [Float] {
        samplesLock.lock()
        defer { samplesLock.unlock() }
        return samples
    }

    // MARK: Interim results

    private func startPartialTimer() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + kPartialInterval, repeating: kPartialInterval)
        timer.setEventHandler { [weak self] in self?.emitPartialIfIdle() }
        partialTimer = timer
        timer.resume()
    }

    private func stopPartialTimer() {
        partialTimer?.cancel()
        partialTimer = nil
    }

    /// Best-effort interim transcript. Skipped whenever the previous pass is
    /// still running so a slow machine degrades to fewer partials, not a backlog.
    private func emitPartialIfIdle() {
        guard isRecording, !partialInFlight, heardVoice else { return }
        let snapshot = snapshotSamples()
        guard snapshot.count >= kMinSamples else { return }

        partialInFlight = true
        transcribeQueue.async { [weak self] in
            guard let self = self else { return }
            let text = self.engine.transcribe(snapshot)
            DispatchQueue.main.async {
                self.partialInFlight = false
                guard self.isRecording else { return }
                emitPartial(text)
            }
        }
    }

    // MARK: Silence detection

    private func resetSilenceTimer() {
        cancelSilenceTimer()
        let timer = DispatchWorkItem { [weak self] in
            guard let self = self, self.isRecording else { return }
            self.stopRecording()
        }
        silenceTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + kSilenceTimeout, execute: timer)
    }

    private func cancelSilenceTimer() {
        silenceTimer?.cancel()
        silenceTimer = nil
    }

    // MARK: Stop

    func stopRecording() {
        if pendingStartSequence != nil {
            pendingStartSequence = nil
            emitStatus("stopped")
            return
        }

        guard isRecording else { return }

        isRecording = false
        cancelSilenceTimer()
        stopPartialTimer()
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        converter = nil

        let snapshot = snapshotSamples()
        let sawVoice = heardVoice

        // Whisper hallucinates confident phrases ("Thank you.") from pure room
        // tone, so a session with no voice activity resolves to empty text.
        guard sawVoice, snapshot.count >= kMinSamples / 2 else {
            emitFinal("")
            emitStatus("stopped")
            return
        }

        emitStatus("transcribing")
        transcribeQueue.async { [weak self] in
            guard let self = self else { return }
            let text = self.engine.transcribe(snapshot)
            emitFinal(text)
            emitStatus("stopped")
        }
    }

    private func cleanupRecording() {
        cancelSilenceTimer()
        stopPartialTimer()
        pendingStartSequence = nil
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        converter = nil
        isRecording = false
    }

    /// Waits for any in-flight transcription so `quit` cannot truncate a final result.
    func drain() {
        transcribeQueue.sync {}
    }
}

// MARK: - Offline transcription (used by tests; needs no microphone)

func transcribeFile(_ engine: WhisperEngine, path: String) -> Never {
    func fail(_ message: String) -> Never {
        emitError(message)
        engine.shutdown()
        exit(1)
    }

    guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)) else {
        fail("Could not read audio file: \(path)")
    }
    let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: kSampleRate, channels: 1, interleaved: false)!

    guard let converter = AVAudioConverter(from: file.processingFormat, to: targetFormat),
          let input = AVAudioPCMBuffer(pcmFormat: file.processingFormat,
                                       frameCapacity: AVAudioFrameCount(file.length)),
          (try? file.read(into: input)) != nil else {
        fail("Could not decode audio file: \(path)")
    }

    let ratio = targetFormat.sampleRate / file.processingFormat.sampleRate
    let capacity = AVAudioFrameCount(Double(input.frameLength) * ratio) + 1024
    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
        fail("Could not allocate conversion buffer")
    }

    var consumed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
        if consumed {
            status.pointee = .noDataNow
            return nil
        }
        consumed = true
        status.pointee = .haveData
        return input
    }
    guard error == nil, let channel = out.floatChannelData?[0] else {
        fail("Could not resample audio file: \(path)")
    }

    let samples = Array(UnsafeBufferPointer(start: channel, count: Int(out.frameLength)))
    emitFinal(engine.transcribe(samples))
    engine.shutdown()
    exit(0)
}

// MARK: - Main

func argumentValue(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name),
          index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}

if CommandLine.arguments.contains("--check-permissions") {
    checkPermissions()
    exit(0)
}

// whisper.cpp and ggml log to stderr by default; silence them so the parent
// process only sees real failures.
whisper_log_set({ _, _, _ in }, nil)
ggml_log_set({ _, _, _ in }, nil)

guard let modelPath = argumentValue("--model") else {
    emitError("Missing --model <path> argument")
    exit(1)
}

guard let engine = WhisperEngine(modelPath: modelPath) else {
    emitError("Failed to load the speech model at \(modelPath)")
    exit(1)
}

if let audioPath = argumentValue("--transcribe-file") {
    transcribeFile(engine, path: audioPath)
}

let manager = SpeechManager(engine: engine)
emitStatus("ready")

/// Finishes any in-flight transcription, then tears whisper down before exiting.
func shutdownAndExit() -> Never {
    manager.stopRecording()
    manager.drain()
    engine.shutdown()
    exit(0)
}

// Read commands from stdin on a background thread
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        let command = line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        DispatchQueue.main.async {
            switch command {
            case "start":
                manager.startRecording()
            case "stop":
                manager.stopRecording()
            case "quit", "exit":
                shutdownAndExit()
            default:
                emitError("Unknown command: \(command)")
            }
        }
    }
    // stdin closed (parent process died) — exit cleanly
    DispatchQueue.main.async {
        shutdownAndExit()
    }
}

// Keep the main run loop alive
dispatchMain()

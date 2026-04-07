import Foundation
import Speech
import AVFoundation

// MARK: - JSON Output Helpers

func emit(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let str = String(data: data, encoding: .utf8) else { return }
    print(str)
    fflush(stdout)
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

    let speechStatus: String
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: speechStatus = "granted"
    case .denied: speechStatus = "denied"
    case .restricted: speechStatus = "restricted"
    case .notDetermined: speechStatus = "not-determined"
    @unknown default: speechStatus = "not-determined"
    }

    emit(["mic": micStatus, "speech": speechStatus])
}

// MARK: - Speech Recognition Manager

class SpeechManager {
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer: SFSpeechRecognizer?
    private var isRecording = false
    private var silenceTimer: DispatchWorkItem?
    private let silenceTimeout: TimeInterval = 1.5

    init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    func requestPermissions(completion: @escaping (Bool) -> Void) {
        var micGranted = false
        var speechGranted = false
        let group = DispatchGroup()

        // Request microphone permission
        group.enter()
        if AVCaptureDevice.authorizationStatus(for: .audio) == .authorized {
            micGranted = true
            group.leave()
        } else {
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                micGranted = granted
                group.leave()
            }
        }

        // Request speech recognition permission
        group.enter()
        if SFSpeechRecognizer.authorizationStatus() == .authorized {
            speechGranted = true
            group.leave()
        } else {
            SFSpeechRecognizer.requestAuthorization { status in
                speechGranted = (status == .authorized)
                group.leave()
            }
        }

        group.notify(queue: .main) {
            completion(micGranted && speechGranted)
        }
    }

    func startRecording() {
        guard !isRecording else {
            emitError("Already recording")
            return
        }

        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            emitError("Speech recognizer is not available")
            return
        }

        requestPermissions { [weak self] granted in
            guard let self = self else { return }
            if !granted {
                emitError("Microphone or speech recognition permission denied. Please enable in System Settings > Privacy & Security.")
                return
            }
            self.beginRecording()
        }
    }

    private func beginRecording() {
        // Cancel any existing task
        recognitionTask?.cancel()
        recognitionTask = nil

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else {
            emitError("Failed to create recognition request")
            return
        }

        recognitionRequest.shouldReportPartialResults = true

        // Prefer on-device recognition if available
        if #available(macOS 13.0, *) {
            recognitionRequest.requiresOnDeviceRecognition = false
            if speechRecognizer?.supportsOnDeviceRecognition == true {
                recognitionRequest.requiresOnDeviceRecognition = true
            }
        }

        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    self.cancelSilenceTimer()
                    emitFinal(text)
                    self.cleanupRecording()
                } else {
                    emitPartial(text)
                    self.resetSilenceTimer()
                }
            }

            if let error = error {
                // Don't emit error if we intentionally stopped
                if self.isRecording {
                    emitError("Recognition error: \(error.localizedDescription)")
                    self.cleanupRecording()
                }
            }
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
            emitStatus("recording")
        } catch {
            emitError("Failed to start audio engine: \(error.localizedDescription)")
            cleanupRecording()
        }
    }

    private func resetSilenceTimer() {
        cancelSilenceTimer()
        let timer = DispatchWorkItem { [weak self] in
            guard let self = self, self.isRecording else { return }
            self.stopRecording()
        }
        silenceTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + silenceTimeout, execute: timer)
    }

    private func cancelSilenceTimer() {
        silenceTimer?.cancel()
        silenceTimer = nil
    }

    func stopRecording() {
        guard isRecording else { return }

        cancelSilenceTimer()
        // End the recognition request — this triggers the final result
        recognitionRequest?.endAudio()
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        isRecording = false
        emitStatus("stopped")
    }

    private func cleanupRecording() {
        cancelSilenceTimer()
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
    }
}

// MARK: - Main

if CommandLine.arguments.contains("--check-permissions") {
    checkPermissions()
    exit(0)
}

let manager = SpeechManager()
emitStatus("ready")

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
                manager.stopRecording()
                exit(0)
            default:
                emitError("Unknown command: \(command)")
            }
        }
    }
    // stdin closed (parent process died) — exit cleanly
    DispatchQueue.main.async {
        manager.stopRecording()
        exit(0)
    }
}

// Keep the main run loop alive
dispatchMain()

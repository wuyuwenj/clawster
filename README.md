# Clawster — AI Desktop Pet for macOS

**Clawster is a free, open-source AI desktop pet for macOS.** A screen-aware AI companion — a cute animated lobster that lives on your desktop, watches what you're doing, and helps you get things done.

Clawster uses a fine-tuned local model for fast tool classification and a cloud proxy for natural conversation. All personal data stays on your machine.

**[Website](https://clawster.pet)** · **[Download for Mac (Apple Silicon)](https://github.com/wuyuwenj/clawster/releases/latest)** · **[Download for Mac (Intel)](https://github.com/wuyuwenj/clawster/releases/latest)**

![Clawster Demo](https://img.shields.io/badge/status-beta-orange) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)

https://github.com/wuyuwenj/clawster/raw/main/assets/demo.mp4

## What is Clawster?

Clawster is an AI desktop pet that sits on your macOS screen as an animated lobster. It watches your screen, answers questions, analyzes screenshots, runs shell commands, controls system settings, and provides context-aware assistance for any app or website.

**Key highlights:**
- **AI desktop pet** that lives on your screen with 14 animated moods
- **Screen-aware AI companion** — knows what app you're using
- **Hybrid architecture** — fast local model for tools, cloud AI for conversation
- **Privacy-first** — personal data (memories, preferences) stored locally in `~/.clawster/`
- **Not just for developers** — helps with any app, website, or task
- Won **2nd Place at the humans& hackathon**

## Features

| Feature | Description | Shortcut |
|---------|-------------|----------|
| **Quick Chat** | Summon Clawster anywhere for context-aware help | `Cmd+Shift+Space` |
| **Screenshot Questions** | Snap any part of your screen and ask about it | `Cmd+Shift+/` |
| **Full Assistant Panel** | Open the full assistant for longer conversations | `Cmd+Shift+A` or right-click pet |
| **Chat Sessions** | Keep conversations separate — create, switch, and delete chats from the assistant panel | — |
| **14 Animated Moods** | Expressive animations that react to interactions | — |
| **Screen Awareness** | Detects your active app and window for contextual help | — |
| **Tool Calling** | Open apps, run commands, set timers, send messages, control volume | — |
| **Memory** | Remembers facts and emotional context across conversations | — |
| **Focus Mode** | Block distracting apps for a set time period | — |
| **Voice Input** | Talk to Clawster with your voice (speech recognition) | — |
| **Auto-Update** | In-app banner when a new version is available | — |
| **Customizable Personality** | Edit IDENTITY.md and SOUL.md to shape behavior | — |
| **Attention Seeking** | Scuttles toward your cursor when feeling lonely | — |
| **Guided Onboarding** | Setup wizard with permission grants, no terminal required | — |

## Animations

This AI desktop pet expresses itself through 14 animated moods:

| Idle | Happy | Sleep | Startle |
|:----:|:-----:|:-----:|:-------:|
| <img src="assets/animations/idle.svg" width="80"> | <img src="assets/animations/happy.svg" width="80"> | <img src="assets/animations/sleep.svg" width="80"> | <img src="assets/animations/startle.svg" width="80"> |
| Breathing & blinking | Bouncing with joy | Zzz... | Surprised! |

| Doze | Side-Eye | Crossed | Huff |
|:----:|:--------:|:-------:|:----:|
| <img src="assets/animations/doze.svg" width="80"> | <img src="assets/animations/side-eye.svg" width="80"> | <img src="assets/animations/crossed.svg" width="80"> | <img src="assets/animations/huff.svg" width="80"> |
| Getting sleepy... | Judging you | Arms crossed | Steaming mad |

| Proud | Peek | Spin | Walking |
|:-----:|:----:|:----:|:-------:|
| <img src="assets/animations/proud.svg" width="80"> | <img src="assets/animations/peek.svg" width="80"> | <img src="assets/animations/spin.svg" width="80"> | <img src="assets/animations/walking.svg" width="80"> |
| Feeling accomplished | Curious peek | Celebratory spin | Scuttling around |

## Screenshots

| Chat Popup | Quick Chat Bar | Assistant Panel |
|:----------:|:--------------:|:---------------:|
| ![Clawster AI desktop pet chat popup](assets/screenshots/chat-popup.png) | ![Clawster AI pet quick chat bar](assets/screenshots/quick-chat.png) | ![Clawster desktop pet assistant panel](assets/screenshots/assistant.png) |
| Clawster pops up with contextual tips | Press `Cmd+Shift+Space` to chat anywhere | Right-click the pet for the full assistant |

## Download

**For most users:** Download the app directly — no terminal needed.

- **[Download Clawster for Mac](https://github.com/wuyuwenj/clawster/releases/latest)**

Open the DMG, drag Clawster to Applications, and launch. The onboarding wizard guides you through everything.

> **Not sure which Mac you have?** Click  > About This Mac. If it says "Apple M1/M2/M3/M4" you have Apple Silicon. If it says "Intel" you have an Intel Mac.

## Architecture

Clawster uses a hybrid local + cloud architecture:

```
User message
    │
    ├─ Local model (Qwen 1.5B, fine-tuned) → tool classification (~200ms)
    │   └─ Tool executor: open apps, run shell, timers, messages, system control
    │
    ├─ Cloud proxy (Cloudflare Worker) → natural conversation via GPT-4o-mini
    │   └─ HMAC-authenticated, rate-limited, content-moderated
    │
    └─ Memory layer (LanceDB, local) → persistent facts + emotional memories
        └─ Vector search for relevant context, stored in ~/.clawster/memory/
```

- **Local model** handles tool calls (open apps, set timers, run commands) with ~200ms latency
- **Cloud proxy** handles natural conversation, screen analysis, and personality
- **Memory** stores facts and emotional context locally in LanceDB with vector search
- **Safety filter** blocks harmful content, destructive commands, and prompt injection
- **Auto-update** checks GitHub Releases on launch and every 30 minutes; in-app banner shows download progress and "Restart Now"

## Getting Started (from source)

### Prerequisites

- **Node.js** 18+
- **Ollama** (optional, for local model — the app downloads the model automatically)

### Installation

```bash
git clone https://github.com/wuyuwenj/clawster.git
cd clawster
npm install
npm start
```

On first launch, the onboarding wizard walks you through setup.

## Customization

### Personality
Edit the files in `personality/` to customize this AI desktop pet:
- **IDENTITY.md** — Define who Clawster is: name, appearance, available actions
- **SOUL.md** — Define how Clawster behaves: tone, response style, personality traits

Make it a strict code reviewer, a cheerful assistant, a sarcastic debugger, or anything you want.

### Behaviors
In the Assistant panel settings, you can:
- Enable/disable attention seeking behavior
- Configure watched folders for file change notifications
- Toggle window title tracking
- Manage analytics opt-in/out

### Reset Onboarding
```bash
rm ~/Library/Application\ Support/clawster/clawster-config.json
```

## Privacy

- Personal data (memories, preferences) stored locally in `~/.clawster/`
- Screen captures processed locally or sent to the cloud proxy (your choice)
- Conversations stored locally on your machine
- Optional PostHog analytics (opt-out in settings)
- Cloud proxy only forwards messages to OpenAI — no data stored server-side
- Link opening is limited to web URLs (`http`/`https`) — `file:`, `javascript:`, and other schemes are refused

## Development

```bash
npm start        # Run in development mode
npm run build    # Build for production
npm test         # Run test suite
npm run dist     # Create distributable package
```

### Project Structure

```
clawster/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # App entry, windows, IPC handlers
│   │   ├── chat/          # Chat system (router, providers, tools, memory, sessions)
│   │   ├── analytics.ts   # PostHog analytics (opt-in)
│   │   ├── emotion-engine.ts  # Valence/arousal mood model
│   │   ├── pet-behaviors.ts   # Idle behaviors, attention seeking
│   │   ├── permission-helper.ts # macOS permission management
│   │   ├── screen-capture.ts  # Screenshot capture
│   │   ├── speech.ts      # Speech recognition (native helper)
│   │   └── windows.ts     # Window management
│   └── renderer/          # Frontend (React + Vite)
│       ├── pet/           # Animated lobster component
│       ├── chatbar/       # Quick chat overlay
│       ├── assistant/     # Full assistant panel
│       └── onboarding/    # First-launch setup wizard
├── proxy/                 # Cloudflare Worker proxy
│   └── src/index.ts       # HMAC auth, rate limiting, moderation
├── eval/                  # Model evaluation framework
├── personality/           # Default personality files (IDENTITY.md, SOUL.md)
├── test/                  # Vitest test suite
└── package.json
```

## System Requirements

- **macOS** (Monterey 12.0 or later)
- **Apple Silicon** (arm64) or **Intel** (x86_64)

## Links

- **Website:** [clawster.pet](https://clawster.pet)
- **Download:** [Latest Release](https://github.com/wuyuwenj/clawster/releases/latest)

## License

MIT

---

_Made with 🦞_

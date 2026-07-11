# Animalese voice clips (private, licensed — NOT committed)

This directory holds the sampled voice clips the Animalese v2 engine
(`src/renderer/utils/animalese.ts`) plays back. **The audio files here are
gitignored on purpose** (see `.gitignore`) because they are private, licensed
assets and must never enter the public repository (legal risk for a commercial
kids product; do NOT rip Nintendo / Animal Crossing audio).

## How the split works

- **Public checkout / CI / tests:** this folder contains only this README. The
  engine finds no clips via `import.meta.glob('../assets/voice/*.{wav,mp3,ogg}')`
  and degrades **silently** — the mouth animation still runs, there is just no
  synthesized voice. The public build and the full test suite pass with no clips.
- **Private / release build:** dropping the licensed clips in here lets Vite
  bundle them into `dist/` at build time (they stay out of git). The engine
  decodes them once and plays them per character.

## Clip convention (v1, letter-based)

One short clip per lowercase letter, named by the letter:

```
a.wav  b.wav  c.wav  …  z.wav
```

Any subset works — missing letters fall back to a vowel clip so partial banks
still render every input. `.wav`, `.mp3`, `.ogg`, `.aiff`, `.m4a`, and `.flac`
are all recognized. Keep clips short (~80–150 ms), mono, one clear vocal syllable
each; the engine pitch-shifts them per character via `playbackRate`.

## Generating the real voice bank

The real voice source is a **captain decision** (brand voice + licensing) and is
tracked as a follow-up — see the CLA-53 PR. Options include a licensed TTS voice
(e.g. ElevenLabs Creator+ for commercial use) or a human recording. Do not commit
whatever bank you generate; drop it here and it will be bundled locally.

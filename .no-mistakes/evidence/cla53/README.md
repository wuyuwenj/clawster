# CLA-53 Animalese v2 — rendered voice samples (PLACEHOLDER timbre)

These `.wav` files let you **hear the v2 engine's prosody** on your own time.
They were rendered offline to files (never played through speakers, mic never
opened) by running representative utterances through the real `planUtterance`
prosody plan.

## ⚠️ The timbre is a stand-in, not the shipped voice

The per-letter clips behind these renders are **throwaway macOS `say` sounds**,
generated only to exercise the engine. They are **not** the real Animalese
voice. The real voice bank is a **captain decision** (brand voice + licensing)
and is escalated separately — see the PR description.

So: **judge the prosody, not the timbre.** What these demonstrate is the engine
layer this task delivers — pitch contour, mood → pitch/speed, punctuation
pauses, and end-of-utterance trail-off. How good it ultimately *sounds* depends
on the real clips and is your call.

## What to listen for

| File | Mood | Demonstrates |
|------|------|--------------|
| `1-neutral-intro.wav` | neutral | baseline cadence + gentle statement declination |
| `2-excited.wav` | excited | higher pitch, faster, more pitch variance |
| `3-curious-question.wav` | curious | pitch **rises** into the `?` |
| `4-sleepy-trailoff.wav` | sleepy | slow, low, and **trails off** on the `...` |
| `5-mood-neutral.wav` | neutral | — same sentence, three moods — |
| `6-mood-happy.wav` | happy | faster + higher than neutral (~1.79s vs 1.90s) |
| `7-mood-sad.wav` | sad | slower + lower than neutral (~2.20s vs 1.90s) |

Files 5–7 are the same text ("Let me help you with that.") so the mood contrast
is direct.

## Reproducing

The renderer (`eval/render-samples.mts`, gitignored) and the placeholder clips
(`eval/voice-raw/`, gitignored) are not committed. Regenerate locally:

```bash
# throwaway placeholder clips (writes files only, no playback)
for L in a b c ... z; do say -o "eval/voice-raw/$L.wav" --data-format=LEI16@22050 "<syllable>"; done
npx esbuild eval/render-samples.mts --bundle --platform=node --format=esm --outfile=eval/render-samples.build.mjs
node eval/render-samples.build.mjs
```

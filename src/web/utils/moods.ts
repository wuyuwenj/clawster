export type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited' | 'doze' | 'startle' | 'proud' | 'mad' | 'spin' | 'mouth_o';

export const moodToState = (mood: Mood): string => {
  switch (mood) {
    case 'happy':
    case 'excited':
      return 'state-happy';
    case 'curious':
      return 'state-snip';
    case 'sleeping':
      return 'state-sleep';
    case 'doze':
      return 'state-doze';
    case 'startle':
      return 'state-startle';
    case 'proud':
      return 'state-proud';
    case 'mad':
      return 'state-crossed';
    case 'spin':
      return 'state-spin';
    case 'mouth_o':
      return 'state-mouth-o';
    case 'thinking':
      return 'state-worried';
    default:
      return 'state-idle';
  }
};

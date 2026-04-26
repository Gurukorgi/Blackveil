/**
 * Shared color palettes for Blackveil (popup + content script).
 * Each entry: page background, surface/card, buttons, accent, text.
 */
(function (g) {
  const LIST = [
    {
      id: 'soft-midnight',
      label: 'Soft Midnight',
      bg: '#0F172A',
      surface: '#1E293B',
      primary: '#3B82F6',
      secondary: '#64748B',
      accent: '#22C55E',
      textMain: '#D8DEE9',
      textMuted: '#94A3B8',
    },
    {
      id: 'true-dark-grey',
      label: 'True Dark Grey',
      bg: '#121212',
      surface: '#1E1E1E',
      primary: '#BB86FC',
      secondary: '#03DAC6',
      accent: '#CF6679',
      textMain: '#D4D4D4',
      textMuted: '#A0A0A0',
    },
    {
      id: 'deep-ocean',
      label: 'Deep Ocean',
      bg: '#0A192F',
      surface: '#112240',
      primary: '#64FFDA',
      secondary: '#8892B0',
      accent: '#CCD6F6',
      textMain: '#D8E4F5',
      textMuted: '#94A3B8',
    },
    {
      id: 'warm-dark',
      label: 'Warm Dark',
      bg: '#1A1A1A',
      surface: '#2A2A2A',
      primary: '#F59E0B',
      secondary: '#D97706',
      accent: '#FCD34D',
      textMain: '#E8E8E8',
      textMuted: '#B3B3B3',
    },
    {
      id: 'purple-night',
      label: 'Purple Night',
      bg: '#0D0C1D',
      surface: '#161B33',
      primary: '#7C3AED',
      secondary: '#A78BFA',
      accent: '#F472B6',
      textMain: '#DDD6FE',
      textMuted: '#9CA3AF',
    },
    {
      id: 'neutral-grey-pro',
      label: 'Neutral Grey Pro',
      bg: '#18181B',
      surface: '#27272A',
      primary: '#2563EB',
      secondary: '#52525B',
      accent: '#16A34A',
      textMain: '#E4E4E7',
      textMuted: '#A1A1AA',
    },
    {
      id: 'amoled-dark',
      label: 'AMOLED Dark',
      bg: '#000000',
      surface: '#121212',
      primary: '#0EA5E9',
      secondary: '#22C55E',
      accent: '#F43F5E',
      textMain: '#E8E8E8',
      textMuted: '#9CA3AF',
    },
  ];

  g.BLACKVEIL_PALETTE_LIST = LIST;
  g.BLACKVEIL_PALETTE_BY_ID = Object.fromEntries(LIST.map((p) => [p.id, p]));
})(typeof self !== 'undefined' ? self : globalThis);

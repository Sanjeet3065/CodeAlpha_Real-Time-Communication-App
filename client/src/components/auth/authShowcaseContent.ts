export interface AuthHighlight {
  label: string;
  detail: string;
}

export interface PasswordCriterion {
  id: string;
  label: string;
  valid: boolean;
}

export const AUTH_SHOWCASE_COPY = {
  brandTag: 'Video Workspace',
  headlineTop: 'Crystal-clear calls,',
  headlineAccent: 'built for focus.',
  subtitle: 'Adaptive HD meetings, shared vector canvas, and private room controls.',
} as const;

export const AUTH_TOPBAR_COPY = {
  guestPrompt: 'Sign in first',
  dashboardLabel: 'Dashboard',
} as const;

export const AUTH_ANIMATED_HIGHLIGHTS: readonly AuthHighlight[] = [
  { label: '60-Peer Adaptive SFU', detail: '1080p spatial video' },
  { label: 'Live Vector Whiteboard', detail: 'Multi-cursor canvas' },
  { label: 'DTLS-SRTP Encrypted', detail: 'Private room access' },
];

export const STUDIO_WAVEFORM_BARS: readonly number[] = [
  0.35, 0.72, 0.5, 0.96, 0.64, 0.88, 0.46, 0.76, 0.38,
];

export function evaluatePasswordCriteria(password: string): PasswordCriterion[] {
  return [
    { id: 'length', label: '8+ characters', valid: password.length >= 8 },
    { id: 'upper', label: 'Uppercase (A-Z)', valid: /[A-Z]/.test(password) },
    { id: 'lower', label: 'Lowercase (a-z)', valid: /[a-z]/.test(password) },
    { id: 'number', label: 'Number (0-9)', valid: /[0-9]/.test(password) },
    { id: 'symbol', label: 'Special (!@#$...)', valid: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function allPasswordCriteriaMet(password: string): boolean {
  return evaluatePasswordCriteria(password).every((criterion) => criterion.valid);
}

export interface LandingNavLink {
  label: string;
  href: string;
}

export type BentoCardId = 'video-stage' | 'vector-canvas' | 'room-vault';

export interface StudioBentoCard {
  id: BentoCardId;
  title: string;
  caption: string;
}

export interface FooterPolicyLink {
  label: string;
  topic: 'Privacy' | 'Terms' | 'Security';
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export const LANDING_NAV_LINKS: readonly LandingNavLink[] = [
  { label: 'Studio', href: '#studio' },
  { label: 'Security', href: '#trust' },
];

export const HERO_CONTENT = {
  eyebrow: 'Encrypted Collaboration Studio',
  headlineTop: 'Quiet spaces for',
  headlineAccent: 'focused teams.',
  subtitle:
    'Adaptive video, shared vector canvas, and private room controls inside a unified workspace.',
  guestPrimaryCta: 'Get Started',
  authPrimaryCta: 'Open Workspace',
  secondaryCta: 'Explore Studio',
} as const;

export const HERO_TRUST_PILLS: readonly string[] = [
  'Adaptive 60-Peer SFU',
  'Vector Whiteboard',
  'DTLS-SRTP Encrypted',
];

export const STUDIO_BENTO_CARDS: readonly StudioBentoCard[] = [
  {
    id: 'video-stage',
    title: 'Adaptive Video Stage',
    caption: 'Crisp multi-party video up to 60 peers.',
  },
  {
    id: 'vector-canvas',
    title: 'Vector Whiteboard',
    caption: 'Multi-cursor sketching with live undo sync.',
  },
  {
    id: 'room-vault',
    title: 'Private Room Vault',
    caption: 'Host waiting room and signed file sharing.',
  },
];

export const CARBON_SPOTLIGHT_CONTENT = {
  eyebrow: 'Ready When You Are',
  headline: 'Built for calm, deliberate work.',
  guestPrimaryCta: 'Create Workspace',
  authPrimaryCta: 'Open Workspace',
  secondaryModalTopic: 'Security & Encryption',
  secondaryLabel: 'Security Architecture',
} as const;

export const CARBON_SPOTLIGHT_SPECS: readonly string[] = [
  'DTLS-SRTP Media',
  'Zero Third-Party Trackers',
  'Row-Level Isolation',
];

export const FOOTER_POLICY_LINKS: readonly FooterPolicyLink[] = [
  { label: 'Privacy', topic: 'Privacy' },
  { label: 'Terms', topic: 'Terms' },
  { label: 'Security', topic: 'Security' },
];

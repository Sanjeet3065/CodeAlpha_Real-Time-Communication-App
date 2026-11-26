import React from 'react';
import { Container } from '@/components/ui/Container';
import { Video, ShieldCheck } from 'lucide-react';

export interface FooterProps {
  onOpenNotice: (topic: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenNotice }) => {
  return (
    <footer className="bg-[#181B20] text-[#EAECEE] pt-16 pb-12 border-t border-[#2B3038]" role="contentinfo">
      <Container size="xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-12 border-b border-white/10">
          {/* Brand Info */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#24282E] text-[#5FA399] flex items-center justify-center border border-white/10">
                <Video className="w-5 h-5" aria-hidden="true" />
              </span>
              <span className="font-display font-extrabold text-xl tracking-tight text-[#EAECEE]">
                CONNECTLY
              </span>
            </div>

            <p className="text-sm text-[#A3AAB2] max-w-sm leading-relaxed">
              Real-time video communication and collaboration platform powered by LiveKit SFU architecture and private cloud storage.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1F302E] text-[#5FA399] border border-[#5FA399]/25 text-xs font-mono">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>SFU Operational</span>
              </span>
              <span className="text-xs text-[#747C86] font-mono">
                WCAG 2.2 AA Baseline
              </span>
            </div>
          </div>

          {/* Col 1: Platform */}
          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#EAECEE] mb-4">
              Platform
            </h4>
            <ul className="space-y-2.5 text-sm text-[#A3AAB2]">
              <li>
                <a href="#features" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  SFU Video &amp; Audio
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  Vector Whiteboard
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  HD Screen Sharing
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  File Sharing &amp; Downloads
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  Real-Time Chat &amp; Reactions
                </a>
              </li>
            </ul>
          </div>

          {/* Col 2: Architecture */}
          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#EAECEE] mb-4">
              Architecture
            </h4>
            <ul className="space-y-2.5 text-sm text-[#A3AAB2]">
              <li>
                <a href="#architecture" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  Selective Forwarding Unit
                </a>
              </li>
              <li>
                <a href="#architecture" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  Adaptive Simulcast
                </a>
              </li>
              <li>
                <a href="#security" className="hover:text-[#EAECEE] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded">
                  DTLS-SRTP Encryption
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Envelope & Credential Encryption')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  Key &amp; Token Security
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('LiveKit SFU Engine')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  Pion WebRTC Core
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Trust & Policy */}
          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-wider text-[#EAECEE] mb-4">
              Trust &amp; Policy
            </h4>
            <ul className="space-y-2.5 text-sm text-[#A3AAB2]">
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Privacy Policy & Data Sovereignty')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Terms of Service')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Security Architecture Overview')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  Security Overview
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('System Telemetry & Status')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  System Status
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('WCAG 2.2 AA Accessibility Statement')}
                  className="hover:text-[#EAECEE] transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5FA399] rounded"
                >
                  Accessibility Statement
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#747C86]">
          <div>
            © {new Date().getFullYear()} CONNECTLY. Real-Time Collaboration Workspace.
          </div>

          <div className="flex items-center gap-6">
            <span>Stone &amp; Carbon Matte UI</span>
            <span className="hidden sm:inline">•</span>
            <span>Privacy-First Architecture · No Ad Trackers</span>
          </div>
        </div>
      </Container>
    </footer>
  );
};

export default Footer;

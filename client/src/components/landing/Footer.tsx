import React from 'react';
import { Container } from '@/components/ui/Container';
import { Video, ShieldCheck } from 'lucide-react';

export interface FooterProps {
  onOpenNotice: (topic: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenNotice }) => {
  return (
    <footer className="bg-[#172B3A] text-white pt-16 pb-12 border-t border-white/10" role="contentinfo">
      <Container size="xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-12 border-b border-white/10">
          {/* Brand Info (Span 2 on lg) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#101820] text-white flex items-center justify-center border border-white/10">
                <Video className="w-5 h-5 text-[#168B83]" aria-hidden="true" />
              </span>
              <span className="font-display font-extrabold text-xl tracking-tight text-white">
                CONNECTLY
              </span>
            </div>

            <p className="text-sm text-[#8A9FA8] max-w-sm leading-relaxed">
              Premium real-time video communication and collaboration platform. Engineered with selective forwarding unit architecture for true scalability and data sovereignty.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#101820] text-[#2EC4B6] border border-white/10 text-xs font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-[#168B83]" aria-hidden="true" />
                <span>Phase 04 Verified</span>
              </span>
              <span className="text-xs text-[#8A9FA8] font-mono">
                WCAG 2.2 AA Baseline
              </span>
            </div>
          </div>

          {/* Col 1: Platform */}
          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-wider text-white mb-4">
              Platform
            </h4>
            <ul className="space-y-2.5 text-sm text-[#8A9FA8]">
              <li>
                <a href="#features" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  SFU Video & Audio
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  Vector Whiteboard
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  1080p Screen Sharing
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  File Sharing & Downloads
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  Real-Time Chat & Reactions
                </a>
              </li>
            </ul>
          </div>

          {/* Col 2: Architecture */}
          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-wider text-white mb-4">
              Architecture
            </h4>
            <ul className="space-y-2.5 text-sm text-[#8A9FA8]">
              <li>
                <a href="#architecture" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  Selective Forwarding Unit
                </a>
              </li>
              <li>
                <a href="#architecture" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  Adaptive Simulcast
                </a>
              </li>
              <li>
                <a href="#security" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded">
                  DTLS-SRTP Encryption
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('SFrame Architecture (Phase 15)')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  SFrame E2EE Roadmap
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('LiveKit SFU Engine')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  Pion WebRTC Core
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Trust & Governance */}
          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-wider text-white mb-4">
              Trust & Policy
            </h4>
            <ul className="space-y-2.5 text-sm text-[#8A9FA8]">
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Privacy Policy & Data Sovereignty')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Terms of Service')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('Security Whitepaper')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  Security Whitepaper
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('System Telemetry & Status')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  System Status
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenNotice('WCAG 2.2 AA Accessibility Statement')}
                  className="hover:text-white transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2EC4B6] rounded"
                >
                  Accessibility Statement
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8A9FA8]">
          <div>
            © {new Date().getFullYear()} CONNECTLY. Engineered strictly following the 18-Phase Architectural Roadmap.
          </div>

          <div className="flex items-center gap-6">
            <span>Modern Editorial + Premium SaaS</span>
            <span className="hidden sm:inline">•</span>
            <span>Privacy-First Architecture · No Ad Trackers</span>
          </div>
        </div>
      </Container>
    </footer>
  );
};

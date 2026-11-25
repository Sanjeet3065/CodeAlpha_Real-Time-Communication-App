import React from 'react';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ShieldCheck, Lock, KeyRound, EyeOff, CheckCircle2 } from 'lucide-react';

const securityPillars = [
  {
    icon: Lock,
    title: 'DTLS-SRTP Transport Encryption',
    badge: 'Transport Security',
    description:
      'Planned transport encryption via DTLS and SRTP to protect audio, video, and screen sharing streams in transit between client endpoints and the media router. Does not constitute end-to-end encryption.',
  },
  {
    icon: KeyRound,
    title: 'E2EE Evaluation Roadmap',
    badge: 'Phase 15 Assignment',
    description:
      'True End-to-End Encryption (E2EE) is scheduled for formal architectural evaluation and prototype validation in Phase 15 using emerging SFrame standards.',
  },
  {
    icon: EyeOff,
    title: 'In-Memory Media Routing',
    badge: 'Ephemeral Streams',
    description:
      'The planned SFU operates as an in-memory packet router without persisting live media packets to disk. Shared documents and persistent meeting artifacts are stored separately in private session storage.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy-Conscious Architecture',
    badge: 'Data Sovereignty',
    description:
      'Designed with zero third-party advertising cookies or cross-site tracking trackers. User identity and session metadata remain strictly confined to platform operations.',
  },
];

export const SecurityTrustSection: React.FC = () => {
  return (
    <section id="security" className="py-16 md:py-24 bg-[#F7F6F2] scroll-mt-14">
      <Container size="xl">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Security & Trust Architecture
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#172B3A] tracking-tight mb-4">
            Security by design: protecting collaborative conversations.
          </h2>
          <p className="text-base sm:text-lg text-[#3D5265] leading-relaxed">
            Data sovereignty is a core foundation of modern communication. Connectly's planned architecture prioritizes transport encryption, data privacy, and robust access controls.
          </p>
        </div>

        {/* 4 Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mb-12">
          {securityPillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <Card
                key={pillar.title}
                variant="standard"
                className="p-6 sm:p-7 bg-white rounded-2xl border border-[#E3E1D9] hover:border-[#168B83]/40 hover:shadow-cly-md transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="w-11 h-11 rounded-xl bg-[#DCEDE8] text-[#168B83] flex items-center justify-center shrink-0 shadow-sm">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-[#F7F6F2] text-[#172B3A] border border-[#E3E1D9]">
                    {pillar.badge}
                  </span>
                </div>

                <h3 className="font-display font-bold text-lg text-[#172B3A] mb-2">
                  {pillar.title}
                </h3>
                <p className="text-sm text-[#3D5265] leading-relaxed">
                  {pillar.description}
                </p>
              </Card>
            );
          })}
        </div>

        {/* Bottom Assurance Card */}
        <div className="p-6 rounded-2xl bg-white border border-[#E3E1D9] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-[#DCEDE8] text-[#168B83] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <div className="font-display font-bold text-sm text-[#172B3A]">
                Standards-Aligned Architecture
              </div>
              <div className="text-xs text-[#6B8092]">
                Designed in alignment with open IETF WebRTC specifications (RFC-8825, RFC-3711) and WCAG 2.2 Level AA accessibility guidelines.
              </div>
            </div>
          </div>

          <div className="text-xs font-mono text-[#168B83] bg-[#DCEDE8]/50 px-3 py-1.5 rounded-lg border border-[#168B83]/20 shrink-0">
            Roadmap Aligned · Phase 15 E2EE Evaluation
          </div>
        </div>
      </Container>
    </section>
  );
};

export default SecurityTrustSection;

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
      'Audio, video, and screen sharing streams are encrypted in transit between participants and the SFU media server using DTLS and SRTP.',
  },
  {
    icon: KeyRound,
    title: 'Argon2id & Envelope Encryption',
    badge: 'Account & Key Safety',
    description:
      'Credentials are hardened with Argon2id hashing, dual-token session rotation, and 256-bit AES-GCM application encryption keys.',
  },
  {
    icon: EyeOff,
    title: 'In-Memory Media Routing',
    badge: 'Ephemeral Streams',
    description:
      'Live media packets flow purely in memory without persistence to disk. Shared files are verified and isolated inside private cloud storage.',
  },
  {
    icon: ShieldCheck,
    title: 'Host Admission & Governance',
    badge: 'Room Controls',
    description:
      'Waiting rooms, room locking, signed WebSocket admission gates, and host/co-host revocation protect every active workspace.',
  },
];

export const SecurityTrustSection: React.FC = () => {
  return (
    <section id="security" className="py-16 md:py-24 bg-[#F3F2EE] dark:bg-[#141619] scroll-mt-14">
      <Container size="xl">
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Security &amp; Trust Architecture
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#1F2428] dark:text-[#EAECEE] tracking-tight mb-4">
            Security by design: protecting collaborative conversations.
          </h2>
          <p className="text-base sm:text-lg text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
            Built with strict admission gates, zero third-party ad trackers, and encrypted storage across your entire workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mb-12">
          {securityPillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <Card
                key={pillar.title}
                variant="standard"
                className="p-6 sm:p-7 bg-[#FAF9F6] dark:bg-[#1C1F24] rounded-2xl border border-[#DDDAD0] dark:border-[#2B3038] hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40 transition-colors duration-200"
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="w-11 h-11 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-[#EAE8E1] dark:bg-[#24282E] text-[#1F2428] dark:text-[#EAECEE] border border-[#DDDAD0] dark:border-[#2B3038]">
                    {pillar.badge}
                  </span>
                </div>

                <h3 className="font-display font-bold text-lg text-[#1F2428] dark:text-[#EAECEE] mb-2">
                  {pillar.title}
                </h3>
                <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
                  {pillar.description}
                </p>
              </Card>
            );
          })}
        </div>

        <div className="p-6 rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <div className="font-display font-bold text-sm text-[#1F2428] dark:text-[#EAECEE]">
                Standards-Aligned Architecture
              </div>
              <div className="text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                Engineered around open IETF WebRTC specifications (RFC-8825, RFC-3711) and WCAG 2.2 AA accessibility.
              </div>
            </div>
          </div>

          <div className="text-xs font-mono text-[#2F6F68] dark:text-[#5FA399] bg-[#E2ECE9] dark:bg-[#1F302E] px-3 py-1.5 rounded-lg border border-[#2F6F68]/20 dark:border-[#5FA399]/25 shrink-0">
            Zero Ad Trackers · Signed Access
          </div>
        </div>
      </Container>
    </section>
  );
};

export default SecurityTrustSection;

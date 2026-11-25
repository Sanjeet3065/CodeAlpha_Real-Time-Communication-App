import React from 'react';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Video,
  PenTool,
  MonitorUp,
  MessageSquare,
  FileDown,
  Calendar,
  type LucideIcon,
} from 'lucide-react';

interface FeatureItem {
  icon: LucideIcon;
  title: string;
  badge: string;
  description: string;
  technicalSpecs: string[];
}

const features: FeatureItem[] = [
  {
    icon: Video,
    title: 'Scalable Multi-User Video',
    badge: 'Planned for Phase 10',
    description:
      'Designed for clear multi-user conferencing with a planned Selective Forwarding Unit (SFU) targeting up to 60 concurrent participants without excessive client uplink strain.',
    technicalSpecs: ['Planned: Multi-resolution simulcast', 'Audio: Opus voice codec with DTX', 'Codecs: Multi-codec support (VP8/VP9/AV1)'],
  },
  {
    icon: PenTool,
    title: 'Collaborative Vector Whiteboard',
    badge: 'Planned for Phase 14',
    description:
      'Draw, diagram, and brainstorm in real time on an infinite vector canvas with planned low-latency cursor synchronization and pressure-sensitive drawing.',
    technicalSpecs: ['Planned: Multi-user cursor presence', 'Tools: Geometric shapes & freehand paths', 'Export: Vector SVG and raster PNG'],
  },
  {
    icon: MonitorUp,
    title: 'High-Definition Screen Sharing',
    badge: 'Planned for Phase 11',
    description:
      'Designed to share entire displays, individual application windows, or browser tabs with synchronized system audio pass-through.',
    technicalSpecs: ['Planned: Tab, window, and display capture', 'Audio: Stereo system sound forwarding', 'Optimization: Dynamic framerate adaptation'],
  },
  {
    icon: MessageSquare,
    title: 'Real-Time Chat & Live Reactions',
    badge: 'Planned for Phase 12',
    description:
      'Designed with synchronized chat streams, direct participant messaging, rich text formatting, and floating emoji reaction bursts.',
    technicalSpecs: ['Planned: In-meeting threaded channels', 'Delivery: Low-overhead socket transport', 'Accessibility: Screen-reader live notifications'],
  },
  {
    icon: FileDown,
    title: 'In-Meeting Document Sharing',
    badge: 'Planned for Phase 13',
    description:
      'Designed for exchanging documents and collaboration artifacts directly during active sessions with cryptographic verification.',
    technicalSpecs: ['Planned: Chunked WebRTC data transfer', 'Integrity: Cryptographic checksum validation', 'Storage: Private session downloads vault'],
  },
  {
    icon: Calendar,
    title: 'Smart Scheduling & Artifacts Vault',
    badge: 'Planned for Phase 16',
    description:
      'Designed to plan syncs with standard calendar integration (.ics), configure waiting room policies, and access shared meeting files in the dedicated downloads hub.',
    technicalSpecs: ['Standards: RFC-5545 iCalendar integration', 'Security: Pre-meeting waiting rooms', 'Access: Centralized session downloads'],
  },
];

export const FeatureGrid: React.FC = () => {
  return (
    <section id="features" className="py-16 md:py-24 bg-white border-y border-[#E3E1D9]/70 scroll-mt-14">
      <Container size="xl">
        {/* Section Heading */}
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Product Capabilities & Roadmap
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#172B3A] tracking-tight mb-4">
            Designed for deep collaboration, not just talking.
          </h2>
          <p className="text-base sm:text-lg text-[#3D5265] leading-relaxed">
            Six cohesive capabilities designed from the ground up on open WebRTC standards. Each capability is mapped to the fixed engineering roadmap to ensure rigorous execution.
          </p>
        </div>

        {/* 6-Card Grid (3x2 Desktop, 2x3 Tablet, 1x6 Mobile) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.title}
                variant="standard"
                className="group relative flex flex-col justify-between p-6 sm:p-7 rounded-2xl bg-[#F7F6F2]/40 hover:bg-white hover:shadow-cly-md hover:border-[#168B83]/30 transition-all duration-200"
              >
                <div>
                  {/* Icon & Badge Row */}
                  <div className="flex items-center justify-between mb-5">
                    <span className="w-12 h-12 rounded-xl bg-[#DCEDE8] text-[#168B83] flex items-center justify-center transition-transform group-hover:scale-105 shadow-sm">
                      <Icon className="w-6 h-6" aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-white text-[#172B3A] border border-[#E3E1D9] shadow-cly-sm">
                      {feature.badge}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <h3 className="font-display font-bold text-xl text-[#172B3A] mb-2.5">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-[#3D5265] leading-relaxed mb-6">
                    {feature.description}
                  </p>
                </div>

                {/* Technical Specifications List */}
                <div className="pt-4 border-t border-[#E3E1D9]/70 space-y-1.5">
                  {feature.technicalSpecs.map((spec) => (
                    <div key={spec} className="flex items-center gap-2 text-xs text-[#6B8092]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#168B83] shrink-0" />
                      <span>{spec}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      </Container>
    </section>
  );
};

export default FeatureGrid;

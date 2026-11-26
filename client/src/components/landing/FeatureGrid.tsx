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
    badge: 'LiveKit SFU',
    description:
      'Fluid multi-user conferencing powered by a Selective Forwarding Unit (SFU) supporting up to 60 concurrent participants without client uplink strain.',
    technicalSpecs: ['Multi-resolution simulcast', 'Opus voice codec with DTX', 'VP8 / VP9 / AV1 adaptive routing'],
  },
  {
    icon: PenTool,
    title: 'Collaborative Vector Whiteboard',
    badge: 'Real-Time Sync',
    description:
      'Draw, diagram, and brainstorm together in real time on a crisp vector canvas with synchronized strokes, shapes, undo/redo history, and PNG export.',
    technicalSpecs: ['Live multi-user cursor presence', 'Shapes, arrows & freehand ink', 'Instant PNG canvas export'],
  },
  {
    icon: MonitorUp,
    title: 'High-Definition Screen Sharing',
    badge: 'Low Latency',
    description:
      'Share entire displays, individual application windows, or browser tabs with adaptive frame prioritization directly in the theater grid.',
    technicalSpecs: ['Tab, window & display capture', 'Audio pass-through support', 'Dynamic bitrate adaptation'],
  },
  {
    icon: MessageSquare,
    title: 'Real-Time Chat & Reactions',
    badge: 'Socket.IO',
    description:
      'Communicate effortlessly via persistent room chat streams, optimistic delivery indicators, and lightweight floating emoji reactions.',
    technicalSpecs: ['In-meeting persistent chat', 'Role badges for host & co-hosts', 'Accessible live updates'],
  },
  {
    icon: FileDown,
    title: 'Private File Sharing Vault',
    badge: 'Supabase Storage',
    description:
      'Share documents and meeting artifacts directly during active sessions with SHA-256 verification and signed download URLs.',
    technicalSpecs: ['Private bucket signed URLs', 'SHA-256 integrity checks', 'Centralized downloads hub'],
  },
  {
    icon: Calendar,
    title: 'Smart Scheduling & Waiting Room',
    badge: 'Access Control',
    description:
      'Schedule upcoming sessions across timezones with pre-join camera/mic checks, host waiting rooms, room locking, and one-click invite links.',
    technicalSpecs: ['Waiting room host admission', 'Timezone-aware scheduling', 'Shareable live join links'],
  },
];

export const FeatureGrid: React.FC = () => {
  return (
    <section
      id="features"
      className="py-16 md:py-24 bg-[#FAF9F6] dark:bg-[#1C1F24] border-y border-[#DDDAD0] dark:border-[#2B3038] scroll-mt-14"
    >
      <Container size="xl">
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Platform Capabilities
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#1F2428] dark:text-[#EAECEE] tracking-tight mb-4">
            Designed for deep collaboration, not just talking.
          </h2>
          <p className="text-base sm:text-lg text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
            Six integrated capabilities engineered on open WebRTC standards for clear video, shared visual thinking, and secure team workflows.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.title}
                variant="standard"
                className="group relative flex flex-col justify-between p-6 sm:p-7 rounded-2xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] hover:bg-[#FAF9F6] dark:hover:bg-[#24282E] hover:border-[#2F6F68]/40 dark:hover:border-[#5FA399]/40 transition-colors duration-200"
              >
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <span className="w-12 h-12 rounded-xl bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] flex items-center justify-center transition-transform group-hover:scale-105">
                      <Icon className="w-6 h-6" aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] border border-[#DDDAD0] dark:border-[#2B3038]">
                      {feature.badge}
                    </span>
                  </div>

                  <h3 className="font-display font-bold text-xl text-[#1F2428] dark:text-[#EAECEE] mb-2.5">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed mb-6">
                    {feature.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-[#DDDAD0]/80 dark:border-[#2B3038] space-y-1.5">
                  {feature.technicalSpecs.map((spec) => (
                    <div key={spec} className="flex items-center gap-2 text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2F6F68] dark:bg-[#5FA399] shrink-0" />
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

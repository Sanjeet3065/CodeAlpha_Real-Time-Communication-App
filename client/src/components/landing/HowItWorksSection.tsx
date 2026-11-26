import React from 'react';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PlusCircle, Globe, Layers, type LucideIcon } from 'lucide-react';

interface StepItem {
  step: string;
  title: string;
  badge: string;
  icon: LucideIcon;
  description: string;
  detail: string;
}

const steps: StepItem[] = [
  {
    step: '01',
    title: 'Initialize Your Session',
    badge: 'Instant or Scheduled',
    icon: PlusCircle,
    description:
      'Launch an instant room with a formatted code (cly-xxx-xxx) or schedule an upcoming meeting with waiting-room and moderation controls.',
    detail: 'Shareable live join links ready in one click.',
  },
  {
    step: '02',
    title: 'Join From Any Browser',
    badge: 'Browser-Native',
    icon: Globe,
    description:
      'Participants verify their camera and microphone in the Pre-Join Lobby before entering—no desktop installers or browser extensions needed.',
    detail: 'Supports Chrome, Edge, Safari, and Firefox.',
  },
  {
    step: '03',
    title: 'Collaborate & Keep Artifacts',
    badge: 'Unified Workspace',
    icon: Layers,
    description:
      'Meet over HD video, sketch on the vector whiteboard, exchange chat messages, and access shared session files anytime from Downloads.',
    detail: 'All meeting artifacts stay organized by session.',
  },
];

export const HowItWorksSection: React.FC = () => {
  return (
    <section
      id="how-it-works"
      className="py-16 md:py-24 bg-[#FAF9F6] dark:bg-[#1C1F24] border-b border-[#DDDAD0] dark:border-[#2B3038] scroll-mt-14"
    >
      <Container size="xl">
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Simple Workflow
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#1F2428] dark:text-[#EAECEE] tracking-tight mb-4">
            Three steps from link to live collaboration.
          </h2>
          <p className="text-base sm:text-lg text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
            Built to remove friction between sharing a link and starting a focused conversation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.step}
                variant="standard"
                className="relative flex flex-col justify-between p-7 rounded-2xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] hover:bg-[#FAF9F6] dark:hover:bg-[#24282E] transition-colors duration-200"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-2xl font-extrabold text-[#2F6F68] dark:text-[#5FA399] bg-[#E2ECE9] dark:bg-[#1F302E] w-12 h-12 rounded-xl flex items-center justify-center">
                      {item.step}
                    </span>
                    <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-[#FAF9F6] dark:bg-[#1C1F24] text-[#1F2428] dark:text-[#EAECEE] border border-[#DDDAD0] dark:border-[#2B3038]">
                      {item.badge}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 mb-3">
                    <Icon className="w-5 h-5 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                    <h3 className="font-display font-bold text-xl text-[#1F2428] dark:text-[#EAECEE]">
                      {item.title}
                    </h3>
                  </div>

                  <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed mb-6">
                    {item.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-[#DDDAD0]/80 dark:border-[#2B3038] text-xs text-[#7C848D] dark:text-[#A3AAB2] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2F6F68] dark:bg-[#5FA399] shrink-0" />
                  <span>{item.detail}</span>
                </div>
              </Card>
            );
          })}
        </div>
      </Container>
    </section>
  );
};

export default HowItWorksSection;

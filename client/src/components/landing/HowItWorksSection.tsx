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
    badge: 'Planned Workflow',
    icon: PlusCircle,
    description:
      'Designed to launch an instant room with a unique formatted code (cly-xxx-xxx) or schedule a recurring sync with custom waiting room and audio policies.',
    detail: 'Generates structured room identifiers with zero client configuration.',
  },
  {
    step: '02',
    title: 'Join Without Plugins',
    badge: 'Browser-Native',
    icon: Globe,
    description:
      'Participants enter directly through modern browsers (Chrome, Safari, Firefox, Edge) without executable app installations or mandatory accounts for guests.',
    detail: 'Full WebRTC standards support across desktop and mobile devices.',
  },
  {
    step: '03',
    title: 'Collaborate & Retain Artifacts',
    badge: 'Planned Workspace',
    icon: Layers,
    description:
      'Collaborate via HD video, vector whiteboard, screen sharing, and document transfers. Retrieve shared meeting files in the dedicated downloads manager.',
    detail: 'Shared files and whiteboard drawings remain organized by meeting name.',
  },
];

export const HowItWorksSection: React.FC = () => {
  return (
    <section id="how-it-works" className="py-16 md:py-24 bg-white border-b border-[#E3E1D9]/70 scroll-mt-14">
      <Container size="xl">
        {/* Section Heading */}
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Planned Workflow
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#172B3A] tracking-tight mb-4">
            Three steps from link to sovereign collaboration.
          </h2>
          <p className="text-base sm:text-lg text-[#3D5265] leading-relaxed">
            Connectly is designed to minimize meeting friction. Planned for instant connections without bloatware, confusing permission popups, or mandatory desktop clients.
          </p>
        </div>

        {/* 3-Step Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.step}
                variant="standard"
                className="relative flex flex-col justify-between p-7 rounded-2xl bg-[#F7F6F2]/50 border border-[#E3E1D9] hover:bg-white hover:shadow-cly-md transition-all duration-200"
              >
                <div>
                  {/* Step Header */}
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-2xl font-extrabold text-[#168B83] bg-[#DCEDE8] w-12 h-12 rounded-xl flex items-center justify-center shadow-sm">
                      {item.step}
                    </span>
                    <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-white text-[#172B3A] border border-[#E3E1D9]">
                      {item.badge}
                    </span>
                  </div>

                  {/* Icon & Title */}
                  <div className="flex items-center gap-2.5 mb-3">
                    <Icon className="w-5 h-5 text-[#168B83]" aria-hidden="true" />
                    <h3 className="font-display font-bold text-xl text-[#172B3A]">
                      {item.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-[#3D5265] leading-relaxed mb-6">
                    {item.description}
                  </p>
                </div>

                {/* Sub-detail */}
                <div className="pt-4 border-t border-[#E3E1D9]/70 text-xs text-[#6B8092] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#168B83] shrink-0" />
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

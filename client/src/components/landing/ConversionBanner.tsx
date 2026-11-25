import React from 'react';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Video, ArrowRight, ShieldCheck } from 'lucide-react';

export interface ConversionBannerProps {
  onStartMeeting: () => void;
  onExploreTech: () => void;
}

export const ConversionBanner: React.FC<ConversionBannerProps> = ({
  onStartMeeting,
  onExploreTech,
}) => {
  return (
    <section className="py-16 md:py-24 bg-white border-t border-[#E3E1D9]/70">
      <Container size="xl">
        <div className="relative rounded-3xl bg-[#172B3A] text-white p-8 sm:p-12 md:p-16 overflow-hidden shadow-2xl">
          {/* Subtle architectural background pattern */}
          <div className="absolute -right-24 -bottom-24 w-96 h-96 rounded-full bg-[#168B83]/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-3xl">
            {/* Pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[#2EC4B6] text-xs font-semibold mb-6 border border-white/10">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Open Standards · Selective Forwarding · Roadmap Aligned</span>
            </div>

            {/* Heading */}
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-white tracking-tight mb-6 leading-[1.15]">
              Ready for collaboration that respects your craft and privacy?
            </h2>

            {/* Subtitle */}
            <p className="text-base sm:text-lg text-[#8A9FA8] max-w-2xl font-normal leading-relaxed mb-8 sm:mb-10">
              Designed for purposeful video conferences, collaborative vector diagrams, and secure document sharing without mandatory desktop app installs.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={onStartMeeting}
                className="text-base shadow-lg px-8 justify-center"
                leftIcon={<Video className="w-5 h-5" aria-hidden="true" />}
              >
                Start Instant Meeting
              </Button>

              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onExploreTech}
                className="text-base text-white border-white/20 hover:bg-white/10 hover:text-white active:bg-white/15 justify-center"
                rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
              >
                Explore Architecture
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default ConversionBanner;

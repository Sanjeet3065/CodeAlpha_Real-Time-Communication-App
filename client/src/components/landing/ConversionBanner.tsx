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
    <section className="py-16 md:py-24 bg-[#FAF9F6] dark:bg-[#1C1F24] border-t border-[#DDDAD0] dark:border-[#2B3038]">
      <Container size="xl">
        <div className="relative rounded-3xl bg-[#1C1F24] dark:bg-[#141619] text-[#EAECEE] p-8 sm:p-12 md:p-16 overflow-hidden border border-[#2B3038] shadow-cly-lg">
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#24282E] text-[#5FA399] text-xs font-semibold mb-6 border border-[#2B3038]">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Open Standards · Selective Forwarding · Matte Workspace</span>
            </div>

            <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-[#EAECEE] tracking-tight mb-6 leading-[1.15]">
              Ready for collaboration that respects your craft and privacy?
            </h2>

            <p className="text-base sm:text-lg text-[#A3AAB2] max-w-2xl font-normal leading-relaxed mb-8 sm:mb-10">
              Start purposeful video conferences, sketch on shared vector boards, and transfer meeting files directly in the browser.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={onStartMeeting}
                className="text-base px-8 justify-center"
                leftIcon={<Video className="w-5 h-5" aria-hidden="true" />}
              >
                Start Instant Meeting
              </Button>

              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onExploreTech}
                className="text-base text-[#EAECEE] border-white/15 hover:bg-white/10 hover:text-[#EAECEE] active:bg-white/15 justify-center"
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

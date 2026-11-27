import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { CARBON_SPOTLIGHT_CONTENT, CARBON_SPOTLIGHT_SPECS } from './landingContent';

export interface ConversionBannerProps {
  isAuthenticated: boolean;
  onPrimaryAction: () => void;
  onOpenSecurityNotice: (topic: string) => void;
}

export const ConversionBanner: React.FC<ConversionBannerProps> = ({
  isAuthenticated,
  onPrimaryAction,
  onOpenSecurityNotice,
}) => {
  const primaryLabel = isAuthenticated
    ? CARBON_SPOTLIGHT_CONTENT.authPrimaryCta
    : CARBON_SPOTLIGHT_CONTENT.guestPrimaryCta;

  return (
    <section id="trust" className="pt-2 pb-12 sm:pb-16">
      <Container size="xl">
        <div className="rounded-2xl bg-[#1C1F24] border border-[#2B3038] p-7 sm:p-10 lg:px-11 lg:py-10 shadow-cly-theater flex flex-col lg:flex-row lg:items-center justify-between gap-7">
          <div className="space-y-3 max-w-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5FA399]">
              {CARBON_SPOTLIGHT_CONTENT.eyebrow}
            </div>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-[2rem] font-semibold tracking-tight text-[#EAECEE] leading-[1.15]">
              {CARBON_SPOTLIGHT_CONTENT.headline}
            </h2>
            <div className="pt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-[#A3AAB2]">
              {CARBON_SPOTLIGHT_SPECS.map((spec) => (
                <span key={spec} className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#5FA399]" aria-hidden="true" />
                  <span>{spec}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0 lg:border-l lg:border-[#2B3038] lg:pl-8">
            <Button
              variant="primary"
              size="lg"
              onClick={onPrimaryAction}
              className="!bg-[#5FA399] !text-[#141619] hover:!bg-[#6EB2A8] active:!bg-[#4E8F85]"
              rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            >
              {primaryLabel}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => onOpenSecurityNotice(CARBON_SPOTLIGHT_CONTENT.secondaryModalTopic)}
              className="!border-[#2B3038] !text-[#EAECEE] hover:!bg-[#24282E]"
            >
              {CARBON_SPOTLIGHT_CONTENT.secondaryLabel}
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default ConversionBanner;

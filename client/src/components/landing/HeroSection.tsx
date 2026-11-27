import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import heroStudioImage from '@/assets/hero-studio.jpg';
import { HERO_CONTENT, HERO_TRUST_PILLS } from './landingContent';

export interface HeroSectionProps {
  isAuthenticated: boolean;
  onPrimaryAction: () => void;
  onExploreStudio: () => void;
}

const STUDIO_CADENCE_BARS = [6, 12, 8, 14, 9];

export const HeroSection: React.FC<HeroSectionProps> = ({
  isAuthenticated,
  onPrimaryAction,
  onExploreStudio,
}) => {
  const primaryLabel = isAuthenticated ? HERO_CONTENT.authPrimaryCta : HERO_CONTENT.guestPrimaryCta;

  return (
    <section className="pt-10 pb-14 sm:pt-12 sm:pb-16 lg:pt-14 lg:pb-20 border-b border-[#DDDAD0]/75 dark:border-[#2B3038]/80">
      <Container size="xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Editorial Copy & Primary Actions */}
          <div className="lg:col-span-5 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] shadow-cly-sm">
              <ShieldCheck
                className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399]"
                aria-hidden="true"
              />
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[#2F6F68] dark:text-[#5FA399]">
                {HERO_CONTENT.eyebrow}
              </span>
            </div>

            <h1 className="font-display text-4xl sm:text-[2.85rem] lg:text-[3.4rem] font-semibold tracking-[-0.03em] leading-[1.05] text-[#1F2428] dark:text-[#EAECEE]">
              {HERO_CONTENT.headlineTop}
              <span className="block text-[#2F6F68] dark:text-[#5FA399]">
                {HERO_CONTENT.headlineAccent}
              </span>
            </h1>

            <p className="text-[15px] sm:text-base text-[#555D66] dark:text-[#A3AAB2] leading-[1.6] max-w-[40ch]">
              {HERO_CONTENT.subtitle}
            </p>

            <div className="pt-1 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                onClick={onPrimaryAction}
                rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
              >
                {primaryLabel}
              </Button>
              <Button variant="outline" size="lg" onClick={onExploreStudio}>
                {HERO_CONTENT.secondaryCta}
              </Button>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[#646D77] dark:text-[#8E96A0]">
              {HERO_TRUST_PILLS.map((spec, index) => (
                <React.Fragment key={spec}>
                  {index > 0 && (
                    <span className="text-[#DDDAD0] dark:text-[#2B3038]" aria-hidden="true">
                      /
                    </span>
                  )}
                  <span>{spec}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Architectural Editorial Hero Artwork */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-2.5 sm:p-3 shadow-cly-lg">
              <div className="overflow-hidden rounded-xl bg-[#EAE8E1] dark:bg-[#141619] ring-1 ring-inset ring-black/5 dark:ring-white/10">
                <img
                  src={heroStudioImage}
                  alt="Sculptural warm stone, brushed matte carbon, and frosted pine glass workspace architecture"
                  className="w-full aspect-[4/3] object-cover block"
                />
              </div>

              <div className="px-2 pt-3 pb-0.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2 text-[#555D66] dark:text-[#A3AAB2]">
                  <span
                    className="w-2 h-2 rounded-full bg-[#2F6F68] dark:bg-[#5FA399]"
                    aria-hidden="true"
                  />
                  <span className="font-medium text-[#1F2428] dark:text-[#EAECEE]">
                    Studio Architecture
                  </span>
                  <span className="text-[#DDDAD0] dark:text-[#2B3038]" aria-hidden="true">
                    /
                  </span>
                  <span>1080p Adaptive SFU</span>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="flex items-end gap-0.5 h-3.5" aria-hidden="true">
                    {STUDIO_CADENCE_BARS.map((height, idx) => (
                      <span
                        key={idx}
                        className="w-[2.5px] rounded-full bg-[#2F6F68] dark:bg-[#5FA399]"
                        style={{ height: `${height}px` }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-semibold">
                    DTLS-SRTP
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default HeroSection;

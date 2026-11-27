import React from 'react';
import { ArrowRight, Mic, MicOff, PenTool, PhoneOff, ShieldCheck, Video } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { HERO_CONTENT, HERO_TRUST_PILLS } from './landingContent';

export interface HeroSectionProps {
  isAuthenticated: boolean;
  onPrimaryAction: () => void;
  onExploreStudio: () => void;
}

const AUDIO_BAR_HEIGHTS = [6, 12, 9, 15, 7];

export const HeroSection: React.FC<HeroSectionProps> = ({
  isAuthenticated,
  onPrimaryAction,
  onExploreStudio,
}) => {
  const primaryLabel = isAuthenticated ? HERO_CONTENT.authPrimaryCta : HERO_CONTENT.guestPrimaryCta;

  return (
    <section className="pt-10 pb-14 sm:pt-12 sm:pb-16 lg:pt-14 lg:pb-20 border-b border-[#DDDAD0]/70 dark:border-[#2B3038]/80">
      <Container size="xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Editorial Copy & Workspace CTAs */}
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

            <h1 className="font-display text-4xl sm:text-[2.75rem] lg:text-[3.3rem] font-semibold tracking-[-0.03em] leading-[1.06] text-[#1F2428] dark:text-[#EAECEE]">
              {HERO_CONTENT.headlineTop}
              <span className="block text-[#2F6F68] dark:text-[#5FA399]">
                {HERO_CONTENT.headlineAccent}
              </span>
            </h1>

            <p className="text-[15px] sm:text-base text-[#555D66] dark:text-[#A3AAB2] leading-[1.6] max-w-[42ch]">
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

          {/* Elevated Matte Carbon Studio Preview */}
          <div className="lg:col-span-7">
            <div
              className="rounded-2xl bg-[#1C1F24] border border-[#2B3038] p-3.5 sm:p-4 shadow-cly-theater"
              aria-hidden="true"
            >
              {/* Top Studio Session Chrome */}
              <div className="px-2 pb-3 flex items-center justify-between gap-3 text-[11px]">
                <div className="flex items-center gap-2.5 text-[#A3AAB2]">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[#EAECEE]">
                    <span className="w-2 h-2 rounded-full bg-[#5FA399]" />
                    design-review
                  </span>
                  <span className="text-[#2B3038]">|</span>
                  <span>3 active</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[#A3AAB2]">24:18</span>
                  <span className="px-2 py-0.5 rounded bg-[#1F302E] border border-[#5FA399]/30 text-[10px] font-semibold tracking-wide text-[#5FA399]">
                    SFU · 1080p
                  </span>
                </div>
              </div>

              {/* Dual-Mode Studio Stage */}
              <div className="rounded-xl bg-[#141619] border border-[#2B3038]/90 p-3 grid grid-cols-12 gap-2.5">
                {/* Active Speaker Stage */}
                <div className="col-span-12 sm:col-span-7 min-h-[210px] sm:min-h-[244px] rounded-lg bg-[#191D22] border border-[#5FA399]/55 p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-[#1F302E] border border-[#5FA399]/30 text-[10px] font-semibold text-[#5FA399]">
                      Speaking
                    </span>
                    <div className="flex items-end gap-0.5 h-4">
                      {AUDIO_BAR_HEIGHTS.map((height, idx) => (
                        <span
                          key={idx}
                          className="w-[3px] rounded-full bg-[#5FA399]"
                          style={{ height: `${height}px` }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="my-auto flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full border border-[#5FA399]/20 flex items-center justify-center">
                      <div className="w-14 h-14 rounded-full bg-[#24282E] border border-[#323842] flex items-center justify-center font-display text-sm font-semibold tracking-wide text-[#EAECEE]">
                        AR
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#EAECEE]">Aarav Rao</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#24282E] text-[#A3AAB2]">
                        Host
                      </span>
                    </div>
                    <Mic className="w-3.5 h-3.5 text-[#5FA399]" />
                  </div>
                </div>

                {/* Right Stacked Canvas + Participant */}
                <div className="col-span-12 sm:col-span-5 flex flex-col gap-2.5">
                  <div
                    className="flex-1 min-h-[146px] rounded-lg bg-[#FAF9F6] dark:bg-[#1F242A] border border-[#DDDAD0]/30 dark:border-[#2B3038] p-2.5 flex flex-col justify-between relative overflow-hidden"
                    style={{
                      backgroundImage:
                        'radial-gradient(rgba(95, 163, 153, 0.24) 1px, transparent 1px)',
                      backgroundSize: '14px 14px',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold tracking-wide text-[#1F2428] dark:text-[#EAECEE]">
                        Shared Canvas
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]">
                        Synced
                      </span>
                    </div>

                    <svg
                      viewBox="0 0 210 86"
                      className="w-full h-[76px]"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect
                        x="12"
                        y="18"
                        width="58"
                        height="34"
                        rx="6"
                        className="fill-[#FFFFFF] dark:fill-[#141619] stroke-[#2F6F68] dark:stroke-[#5FA399]"
                        strokeWidth="1.5"
                      />
                      <line
                        x1="22"
                        y1="30"
                        x2="54"
                        y2="30"
                        className="stroke-[#1F2428]/60 dark:stroke-[#EAECEE]/60"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1="22"
                        y1="39"
                        x2="44"
                        y2="39"
                        className="stroke-[#555D66]/45 dark:stroke-[#A3AAB2]/45"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />

                      <path
                        d="M70 35 C 98 35, 102 52, 132 52"
                        className="stroke-[#2F6F68] dark:stroke-[#5FA399]"
                        strokeWidth="1.75"
                        strokeDasharray="3 3"
                      />
                      <circle
                        cx="70"
                        cy="35"
                        r="3"
                        className="fill-[#2F6F68] dark:fill-[#5FA399]"
                      />

                      <rect
                        x="132"
                        y="32"
                        width="62"
                        height="38"
                        rx="6"
                        className="fill-[#FFFFFF] dark:fill-[#141619] stroke-[#DDDAD0] dark:stroke-[#323842]"
                        strokeWidth="1.5"
                      />
                      <line
                        x1="142"
                        y1="45"
                        x2="178"
                        y2="45"
                        className="stroke-[#1F2428]/55 dark:stroke-[#EAECEE]/55"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1="142"
                        y1="55"
                        x2="168"
                        y2="55"
                        className="stroke-[#555D66]/45 dark:stroke-[#A3AAB2]/45"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>

                    <div className="flex justify-end">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] text-[10px] font-semibold">
                        Maya · Drawing
                      </span>
                    </div>
                  </div>

                  <div className="h-[84px] rounded-lg bg-[#191D22] border border-[#2B3038] px-3 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-[#24282E] border border-[#323842] flex items-center justify-center font-display text-xs font-semibold text-[#EAECEE]">
                        RK
                      </div>
                      <div>
                        <div className="text-xs font-medium text-[#EAECEE]">Riya Kapoor</div>
                        <div className="text-[11px] text-[#8E96A0]">Annotating layer</div>
                      </div>
                    </div>
                    <MicOff className="w-3.5 h-3.5 text-[#8E96A0]" />
                  </div>
                </div>
              </div>

              {/* Minimal Dock Strip */}
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="w-8 h-8 rounded-full bg-[#24282E] border border-[#2B3038] flex items-center justify-center text-[#EAECEE]">
                  <Mic className="w-3.5 h-3.5" />
                </span>
                <span className="w-8 h-8 rounded-full bg-[#24282E] border border-[#2B3038] flex items-center justify-center text-[#EAECEE]">
                  <Video className="w-3.5 h-3.5" />
                </span>
                <span className="w-8 h-8 rounded-full bg-[#1F302E] border border-[#5FA399]/50 flex items-center justify-center text-[#5FA399]">
                  <PenTool className="w-3.5 h-3.5" />
                </span>
                <span className="w-8 h-8 rounded-full bg-[#D46A6A]/15 border border-[#D46A6A]/35 flex items-center justify-center text-[#D46A6A]">
                  <PhoneOff className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default HeroSection;

import React from 'react';
import { FileCheck2, Lock, Mic, PenTool, Square, UserCheck, Video } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { STUDIO_BENTO_CARDS, type BentoCardId } from './landingContent';

const VideoStageMiniature: React.FC = () => (
  <div className="h-[208px] rounded-xl bg-[#181B20] border border-[#2B3038] p-3 flex flex-col justify-between">
    <div className="flex items-center justify-between text-[10px]">
      <span className="font-mono text-[#A3AAB2]">60-peer room</span>
      <span className="px-2 py-0.5 rounded bg-[#1F302E] border border-[#5FA399]/30 font-semibold text-[#5FA399]">
        1080p SFU
      </span>
    </div>

    <div className="grid grid-cols-2 gap-2 my-auto py-1">
      <div className="h-[58px] rounded-lg bg-[#22262C] border border-[#5FA399]/65 p-2 flex items-center justify-between">
        <span className="w-7 h-7 rounded-full bg-[#2B3038] flex items-center justify-center font-display text-[11px] font-semibold text-[#EAECEE]">
          AR
        </span>
        <div className="flex items-end gap-0.5 h-3">
          <span className="w-0.5 h-1.5 rounded-full bg-[#5FA399]" />
          <span className="w-0.5 h-3 rounded-full bg-[#5FA399]" />
          <span className="w-0.5 h-2 rounded-full bg-[#5FA399]" />
        </div>
      </div>
      <div className="h-[58px] rounded-lg bg-[#22262C] border border-[#2B3038] p-2 flex items-center justify-between">
        <span className="w-7 h-7 rounded-full bg-[#2B3038] flex items-center justify-center font-display text-[11px] font-semibold text-[#EAECEE]">
          SL
        </span>
        <span className="text-[10px] text-[#8E96A0]">HD</span>
      </div>
      <div className="h-[58px] rounded-lg bg-[#22262C] border border-[#2B3038] p-2 flex items-center justify-between">
        <span className="w-7 h-7 rounded-full bg-[#2B3038] flex items-center justify-center font-display text-[11px] font-semibold text-[#EAECEE]">
          MK
        </span>
        <span className="text-[10px] text-[#8E96A0]">HD</span>
      </div>
      <div className="h-[58px] rounded-lg bg-[#141619] border border-[#2B3038] p-2 flex items-center justify-center">
        <span className="font-mono text-xs font-semibold text-[#5FA399]">+12</span>
      </div>
    </div>

    <div className="mx-auto inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#22262C] border border-[#2B3038] text-[#EAECEE]">
      <Mic className="w-3 h-3 text-[#5FA399]" />
      <Video className="w-3 h-3" />
      <PenTool className="w-3 h-3 text-[#A3AAB2]" />
    </div>
  </div>
);

const VectorCanvasMiniature: React.FC = () => (
  <div
    className="h-[208px] rounded-xl bg-[#FAF9F6] dark:bg-[#191D22] border border-[#DDDAD0] dark:border-[#2B3038] p-3 relative flex flex-col justify-between overflow-hidden"
    style={{
      backgroundImage: 'radial-gradient(rgba(95, 163, 153, 0.25) 1px, transparent 1px)',
      backgroundSize: '14px 14px',
    }}
  >
    <div className="flex items-center justify-between">
      <div className="inline-flex items-center gap-1 rounded-md bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] p-1">
        <span className="w-5 h-5 rounded bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] flex items-center justify-center">
          <PenTool className="w-3 h-3" />
        </span>
        <span className="w-5 h-5 rounded text-[#555D66] dark:text-[#A3AAB2] flex items-center justify-center">
          <Square className="w-3 h-3" />
        </span>
      </div>
      <span className="px-2 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[10px] font-semibold text-[#2F6F68] dark:text-[#5FA399]">
        Live Undo
      </span>
    </div>

    <svg
      viewBox="0 0 240 100"
      className="w-full h-[106px]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="16"
        y="16"
        width="68"
        height="34"
        rx="7"
        className="fill-[#FFFFFF] dark:fill-[#141619] stroke-[#2F6F68] dark:stroke-[#5FA399]"
        strokeWidth="1.5"
      />
      <line
        x1="28"
        y1="30"
        x2="66"
        y2="30"
        className="stroke-[#1F2428]/70 dark:stroke-[#EAECEE]/70"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="28"
        y1="39"
        x2="52"
        y2="39"
        className="stroke-[#555D66]/45 dark:stroke-[#A3AAB2]/45"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <path
        d="M84 33 C 118 33, 120 64, 152 64"
        className="stroke-[#2F6F68] dark:stroke-[#5FA399]"
        strokeWidth="2"
      />
      <circle cx="84" cy="33" r="3.5" className="fill-[#2F6F68] dark:fill-[#5FA399]" />
      <circle cx="152" cy="64" r="3.5" className="fill-[#2F6F68] dark:fill-[#5FA399]" />

      <rect
        x="152"
        y="46"
        width="70"
        height="36"
        rx="7"
        className="fill-[#FFFFFF] dark:fill-[#141619] stroke-[#DDDAD0] dark:stroke-[#323842]"
        strokeWidth="1.5"
      />
      <line
        x1="164"
        y1="60"
        x2="206"
        y2="60"
        className="stroke-[#1F2428]/60 dark:stroke-[#EAECEE]/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="164"
        y1="70"
        x2="192"
        y2="70"
        className="stroke-[#555D66]/45 dark:stroke-[#A3AAB2]/45"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>

    <div className="flex items-center justify-between text-[10px]">
      <span className="px-2 py-0.5 rounded bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] font-semibold">
        Maya
      </span>
      <span className="px-2 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#24282E] text-[#1F2428] dark:text-[#EAECEE] font-semibold border border-[#DDDAD0] dark:border-[#323842]">
        Devon
      </span>
    </div>
  </div>
);

const RoomVaultMiniature: React.FC = () => (
  <div className="h-[208px] rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] p-3 flex flex-col justify-between">
    <div className="rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] px-3 py-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-display text-[11px] font-semibold flex items-center justify-center">
          NK
        </span>
        <div>
          <div className="text-[11px] font-semibold text-[#1F2428] dark:text-[#EAECEE]">
            Neha Kulkarni
          </div>
          <div className="text-[10px] text-[#646D77] dark:text-[#8E96A0]">Waiting room</div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] text-[10px] font-semibold">
        <UserCheck className="w-3 h-3" />
        Admit
      </span>
    </div>

    <div className="rounded-lg bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] px-3 py-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-md bg-[#EAE8E1] dark:bg-[#24282E] flex items-center justify-center text-[#2F6F68] dark:text-[#5FA399] shrink-0">
          <FileCheck2 className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-[#1F2428] dark:text-[#EAECEE] truncate">
            Architecture_Spec.pdf
          </div>
          <div className="text-[10px] text-[#646D77] dark:text-[#8E96A0]">2.4 MB</div>
        </div>
      </div>
      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] shrink-0">
        Signed
      </span>
    </div>

    <div className="px-1 flex items-center justify-between text-[10px] font-medium text-[#646D77] dark:text-[#8E96A0]">
      <span className="inline-flex items-center gap-1.5">
        <Lock className="w-3 h-3 text-[#2F6F68] dark:text-[#5FA399]" />
        Private bucket access
      </span>
      <span className="font-mono text-[#2F6F68] dark:text-[#5FA399]">RLS Active</span>
    </div>
  </div>
);

const renderBentoVisual = (id: BentoCardId): React.ReactNode => {
  switch (id) {
    case 'video-stage':
      return <VideoStageMiniature />;
    case 'vector-canvas':
      return <VectorCanvasMiniature />;
    case 'room-vault':
      return <RoomVaultMiniature />;
  }
};

export const FeatureGrid: React.FC = () => {
  return (
    <section id="studio" className="py-12 sm:py-16 lg:py-20">
      <Container size="xl">
        <div className="mb-7 sm:mb-9 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2F6F68] dark:text-[#5FA399]">
              Workspace Studio
            </div>
            <h2 className="mt-1.5 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
              Crafted for clarity in every room.
            </h2>
          </div>
          <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] max-w-[34ch]">
            Every core workspace layer, visible without interface clutter.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {STUDIO_BENTO_CARDS.map((card) => (
            <article
              key={card.id}
              className="rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-3 flex flex-col shadow-cly-sm transition-colors duration-200 hover:border-[#2F6F68]/50 dark:hover:border-[#5FA399]/50"
            >
              <div aria-hidden="true">{renderBentoVisual(card.id)}</div>
              <div className="px-2 pt-3.5 pb-1">
                <h3 className="text-base font-semibold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                  {card.title}
                </h3>
                <p className="mt-1 text-sm text-[#555D66] dark:text-[#A3AAB2]">{card.caption}</p>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
};

export default FeatureGrid;

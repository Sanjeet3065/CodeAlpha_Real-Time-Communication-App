import React, { useState } from 'react';
import {
  FileCheck2,
  Layers,
  LayoutGrid,
  Lock,
  Maximize2,
  Mic,
  PenTool,
  UserCheck,
} from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { cn } from '@/lib/utils';
import { STUDIO_BENTO_CARDS } from './landingContent';

const VIDEO_PEERS = [
  { initials: 'AR', name: 'Aarav Rao', role: 'Host · Speaking', speaking: true },
  { initials: 'MN', name: 'Maya Nair', role: 'Design Lead', speaking: false },
  { initials: 'DB', name: 'Devon Brooks', role: 'Systems Eng', speaking: false },
] as const;

const VideoStageMiniature: React.FC = () => {
  const [stageMode, setStageMode] = useState<'spotlight' | 'grid'>('spotlight');

  return (
    <div className="h-[224px] rounded-xl bg-[#181B20] border border-[#2B3038] p-3 flex flex-col justify-between">
      {/* Top interactive mode bar */}
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#5FA399]" aria-hidden="true" />
          <span className="font-mono text-[#EAECEE]">60-peer room</span>
          <span className="px-1.5 py-0.5 rounded bg-[#1F302E] text-[#5FA399] font-semibold">
            Simulcast
          </span>
        </div>

        <div
          className="inline-flex items-center rounded-md bg-[#111316] border border-[#2B3038] p-0.5"
          role="group"
          aria-label="Stage view layout preview"
        >
          <button
            type="button"
            onClick={() => setStageMode('spotlight')}
            aria-pressed={stageMode === 'spotlight'}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              stageMode === 'spotlight'
                ? 'bg-[#2B3038] text-[#EAECEE]'
                : 'text-[#8E96A0] hover:text-[#EAECEE]'
            )}
          >
            <Maximize2 className="w-2.5 h-2.5" aria-hidden="true" />
            Focus
          </button>
          <button
            type="button"
            onClick={() => setStageMode('grid')}
            aria-pressed={stageMode === 'grid'}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              stageMode === 'grid'
                ? 'bg-[#2B3038] text-[#EAECEE]'
                : 'text-[#8E96A0] hover:text-[#EAECEE]'
            )}
          >
            <LayoutGrid className="w-2.5 h-2.5" aria-hidden="true" />
            Grid
          </button>
        </div>
      </div>

      {/* Stage body */}
      {stageMode === 'spotlight' ? (
        <div className="grid grid-cols-12 gap-2.5 flex-1 py-2.5">
          <div className="col-span-7 rounded-lg bg-[#20252C] border border-[#5FA399]/60 p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="px-1.5 py-0.5 rounded bg-[#1F302E] text-[9px] font-semibold text-[#5FA399]">
                Active Speaker
              </span>
              <div className="flex items-end gap-0.5 h-3" aria-hidden="true">
                <span className="w-0.5 h-1.5 rounded-full bg-[#5FA399]" />
                <span className="w-0.5 h-3 rounded-full bg-[#5FA399]" />
                <span className="w-0.5 h-2 rounded-full bg-[#5FA399]" />
                <span className="w-0.5 h-2.5 rounded-full bg-[#5FA399]" />
              </div>
            </div>

            <div className="my-auto flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border border-[#5FA399]/30 flex items-center justify-center">
                <span className="w-9 h-9 rounded-full bg-[#2B313A] flex items-center justify-center font-display text-xs font-semibold text-[#EAECEE]">
                  AR
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px]">
              <span className="font-medium text-[#EAECEE]">Aarav Rao</span>
              <Mic className="w-3 h-3 text-[#5FA399]" aria-hidden="true" />
            </div>
          </div>

          <div className="col-span-5 flex flex-col justify-between gap-1.5">
            {VIDEO_PEERS.slice(1).map((peer) => (
              <div
                key={peer.initials}
                className="flex-1 rounded-lg bg-[#1C1F24] border border-[#2B3038] px-2.5 py-1.5 flex items-center gap-2"
              >
                <span className="w-6 h-6 rounded-full bg-[#2B3038] flex items-center justify-center font-display text-[10px] font-semibold text-[#EAECEE] shrink-0">
                  {peer.initials}
                </span>
                <div className="min-w-0">
                  <div className="text-[10px] font-medium text-[#EAECEE] truncate">{peer.name}</div>
                  <div className="text-[9px] text-[#8E96A0] truncate">{peer.role}</div>
                </div>
              </div>
            ))}
            <div className="rounded-lg bg-[#141619] border border-[#2B3038] px-2.5 py-1.5 flex items-center justify-between text-[10px]">
              <span className="text-[#8E96A0]">Roster synced</span>
              <span className="font-mono font-semibold text-[#5FA399]">+12 peers</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 flex-1 py-2.5">
          {VIDEO_PEERS.map((peer) => (
            <div
              key={peer.initials}
              className={cn(
                'rounded-lg bg-[#20252C] px-2.5 py-2 flex items-center justify-between border',
                peer.speaking ? 'border-[#5FA399]/65' : 'border-[#2B3038]'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-full bg-[#2B313A] flex items-center justify-center font-display text-[10px] font-semibold text-[#EAECEE] shrink-0">
                  {peer.initials}
                </span>
                <span className="text-[10px] font-medium text-[#EAECEE] truncate">{peer.name}</span>
              </div>
              {peer.speaking ? (
                <Mic className="w-3 h-3 text-[#5FA399] shrink-0" aria-hidden="true" />
              ) : (
                <span className="text-[9px] font-mono text-[#8E96A0]">HD</span>
              )}
            </div>
          ))}
          <div className="rounded-lg bg-[#141619] border border-[#2B3038] px-2.5 py-2 flex items-center justify-center">
            <span className="font-mono text-xs font-semibold text-[#5FA399]">+12 active</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-[#8E96A0] border-t border-[#2B3038]/80 pt-2">
        <span>Adaptive bitrate &amp; pagination</span>
        <span className="font-mono text-[#EAECEE]">1080p · 60fps</span>
      </div>
    </div>
  );
};

const VectorCanvasMiniature: React.FC = () => {
  const [tool, setTool] = useState<'flow' | 'sketch'>('flow');

  return (
    <div
      className="h-[224px] rounded-xl bg-[#FAF9F6] dark:bg-[#191D22] border border-[#DDDAD0] dark:border-[#2B3038] p-3 relative flex flex-col justify-between overflow-hidden"
      style={{
        backgroundImage: 'radial-gradient(rgba(95, 163, 153, 0.25) 1px, transparent 1px)',
        backgroundSize: '14px 14px',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-1 rounded-md bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] p-0.5"
          role="group"
          aria-label="Canvas mode preview"
        >
          <button
            type="button"
            onClick={() => setTool('flow')}
            aria-pressed={tool === 'flow'}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              tool === 'flow'
                ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
                : 'text-[#555D66] dark:text-[#A3AAB2]'
            )}
          >
            <Layers className="w-2.5 h-2.5" aria-hidden="true" />
            Flow
          </button>
          <button
            type="button"
            onClick={() => setTool('sketch')}
            aria-pressed={tool === 'sketch'}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
              tool === 'sketch'
                ? 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619]'
                : 'text-[#555D66] dark:text-[#A3AAB2]'
            )}
          >
            <PenTool className="w-2.5 h-2.5" aria-hidden="true" />
            Sketch
          </button>
        </div>

        <span className="px-2 py-0.5 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[10px] font-semibold text-[#2F6F68] dark:text-[#5FA399]">
          Undo Sync
        </span>
      </div>

      <svg
        viewBox="0 0 260 116"
        className="w-full h-[126px]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Left Node */}
        <rect
          x="18"
          y="18"
          width="74"
          height="38"
          rx="7"
          className="fill-[#FFFFFF] dark:fill-[#141619] stroke-[#2F6F68] dark:stroke-[#5FA399]"
          strokeWidth="1.5"
        />
        <line
          x1="30"
          y1="32"
          x2="72"
          y2="32"
          className="stroke-[#1F2428]/70 dark:stroke-[#EAECEE]/70"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <line
          x1="30"
          y1="43"
          x2="58"
          y2="43"
          className="stroke-[#555D66]/45 dark:stroke-[#A3AAB2]/45"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Right Node */}
        <rect
          x="164"
          y="46"
          width="78"
          height="40"
          rx="7"
          className="fill-[#FFFFFF] dark:fill-[#141619] stroke-[#DDDAD0] dark:stroke-[#323842]"
          strokeWidth="1.5"
        />
        <line
          x1="176"
          y1="61"
          x2="220"
          y2="61"
          className="stroke-[#1F2428]/65 dark:stroke-[#EAECEE]/65"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <line
          x1="176"
          y1="72"
          x2="204"
          y2="72"
          className="stroke-[#555D66]/45 dark:stroke-[#A3AAB2]/45"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Dynamic Path */}
        {tool === 'flow' ? (
          <>
            <path
              d="M92 37 C 128 37, 130 66, 164 66"
              className="stroke-[#2F6F68] dark:stroke-[#5FA399]"
              strokeWidth="2"
            />
            <circle cx="92" cy="37" r="3.5" className="fill-[#2F6F68] dark:fill-[#5FA399]" />
            <circle cx="164" cy="66" r="3.5" className="fill-[#2F6F68] dark:fill-[#5FA399]" />
          </>
        ) : (
          <path
            d="M34 84 C 66 58, 108 102, 146 66 C 174 40, 206 30, 232 28"
            className="stroke-[#2F6F68] dark:stroke-[#5FA399]"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
        )}

        {/* Angled Pointer Cursor: Maya */}
        <g transform="translate(114, 16)">
          <path
            d="M0 0 L12 6 L6.8 7.6 L4.6 13 Z"
            className="fill-[#2F6F68] dark:fill-[#5FA399]"
          />
          <rect
            x="10"
            y="8"
            width="42"
            height="17"
            rx="4"
            className="fill-[#2F6F68] dark:fill-[#5FA399]"
          />
          <text
            x="31"
            y="19.5"
            textAnchor="middle"
            className="fill-[#FAF9F6] dark:fill-[#141619]"
            fontSize="9"
            fontWeight="600"
            fontFamily="Inter, sans-serif"
          >
            Maya
          </text>
        </g>

        {/* Angled Pointer Cursor: Devon */}
        <g transform="translate(182, 86)">
          <path
            d="M0 0 L12 6 L6.8 7.6 L4.6 13 Z"
            className="fill-[#1F2428] dark:fill-[#EAECEE]"
          />
          <rect
            x="10"
            y="8"
            width="46"
            height="17"
            rx="4"
            className="fill-[#1F2428] dark:fill-[#EAECEE]"
          />
          <text
            x="33"
            y="19.5"
            textAnchor="middle"
            className="fill-[#FAF9F6] dark:fill-[#141619]"
            fontSize="9"
            fontWeight="600"
            fontFamily="Inter, sans-serif"
          >
            Devon
          </text>
        </g>
      </svg>

      <div className="flex items-center justify-between text-[10px] text-[#646D77] dark:text-[#8E96A0]">
        <span>Bezier spline simplification</span>
        <span className="font-mono text-[#1F2428] dark:text-[#EAECEE]">2 cursors live</span>
      </div>
    </div>
  );
};

const RoomVaultConsole: React.FC = () => {
  const [guestAdmitted, setGuestAdmitted] = useState(false);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
      {/* Waiting Room Interactive Gatekeeper */}
      <div className="rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] px-3.5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-full bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-display text-xs font-semibold flex items-center justify-center shrink-0">
            NK
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
              Neha Kulkarni
            </div>
            <div className="text-[11px] text-[#646D77] dark:text-[#8E96A0]">
              {guestAdmitted ? 'In studio · Verified' : 'Waiting room'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setGuestAdmitted((prev) => !prev)}
          aria-pressed={guestAdmitted}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
            guestAdmitted
              ? 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] border border-[#2F6F68]/30 dark:border-[#5FA399]/30'
              : 'bg-[#2F6F68] dark:bg-[#5FA399] text-[#FAF9F6] dark:text-[#141619] hover:bg-[#255A54] dark:hover:bg-[#6EB2A8]'
          )}
        >
          <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
          {guestAdmitted ? 'Admitted' : 'Admit'}
        </button>
      </div>

      {/* Private Signed Vault Asset */}
      <div className="rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] px-3.5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#EAE8E1] dark:bg-[#24282E] flex items-center justify-center text-[#2F6F68] dark:text-[#5FA399] shrink-0">
            <FileCheck2 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE] truncate">
              Architecture_Spec.pdf
            </div>
            <div className="text-[11px] text-[#646D77] dark:text-[#8E96A0] flex items-center gap-1">
              <Lock className="w-3 h-3 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
              <span>2.4 MB · Private RLS</span>
            </div>
          </div>
        </div>

        <span className="font-mono text-[10px] px-2 py-1 rounded bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399] font-semibold shrink-0">
          Signed
        </span>
      </div>
    </div>
  );
};

export const FeatureGrid: React.FC = () => {
  const [videoCard, canvasCard, vaultCard] = STUDIO_BENTO_CARDS;

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
            Every core workspace layer, interactive and uncluttered.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Row 1 Left: Featured Wide Adaptive Video Stage */}
          <article className="lg:col-span-7 rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-3 flex flex-col shadow-cly-sm transition-colors duration-200 hover:border-[#2F6F68]/50 dark:hover:border-[#5FA399]/50">
            <VideoStageMiniature />
            <div className="px-2 pt-3.5 pb-1 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <h3 className="text-base font-semibold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                {videoCard.title}
              </h3>
              <p className="text-sm text-[#555D66] dark:text-[#A3AAB2]">{videoCard.caption}</p>
            </div>
          </article>

          {/* Row 1 Right: Collaborative Vector Canvas */}
          <article className="lg:col-span-5 rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-3 flex flex-col shadow-cly-sm transition-colors duration-200 hover:border-[#2F6F68]/50 dark:hover:border-[#5FA399]/50">
            <VectorCanvasMiniature />
            <div className="px-2 pt-3.5 pb-1">
              <h3 className="text-base font-semibold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                {canvasCard.title}
              </h3>
              <p className="mt-0.5 text-sm text-[#555D66] dark:text-[#A3AAB2]">
                {canvasCard.caption}
              </p>
            </div>
          </article>

          {/* Row 2 Full-Width Slim Horizontal Split: Private Room Vault */}
          <article className="lg:col-span-12 rounded-2xl bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-cly-sm transition-colors duration-200 hover:border-[#2F6F68]/50 dark:hover:border-[#5FA399]/50">
            <div className="lg:max-w-xs shrink-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2F6F68] dark:text-[#5FA399]">
                Room Access &amp; Vault
              </div>
              <h3 className="mt-1 text-base font-semibold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
                {vaultCard.title}
              </h3>
              <p className="mt-0.5 text-sm text-[#555D66] dark:text-[#A3AAB2]">
                {vaultCard.caption}
              </p>
            </div>

            <div className="flex-1">
              <RoomVaultConsole />
            </div>
          </article>
        </div>
      </Container>
    </section>
  );
};

export default FeatureGrid;

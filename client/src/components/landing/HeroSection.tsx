import React, { useState } from 'react';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Video,
  Mic,
  MicOff,
  MonitorUp,
  MessageSquare,
  Users,
  PhoneOff,
  PenTool,
  ShieldCheck,
  Sparkles,
  Radio,
  Copy,
  Check,
} from 'lucide-react';

export interface HeroSectionProps {
  onStartInstantMeeting: () => void;
  onJoinCode: (code: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onStartInstantMeeting,
  onJoinCode,
}) => {
  const [meetingCode, setMeetingCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Format meeting code: cly-xxx-xxx
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip non-alphanumeric except hyphen
    let val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');

    // Auto-hyphenate if typing cleanly
    if (val.length === 3 && !val.includes('-')) {
      val = `${val}-`;
    } else if (val.length === 7 && val.split('-').length === 2) {
      val = `${val}-`;
    }

    if (val.length > 11) {
      val = val.slice(0, 11);
    }

    setMeetingCode(val);
    if (codeError) setCodeError(null);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = meetingCode.trim();

    if (!clean) {
      setCodeError('Please enter a meeting code');
      return;
    }

    // Accept patterns like cly-xxx-xxx or xxx-xxx
    const codeRegex = /^(cly-)?[a-z0-9]{3}-[a-z0-9]{3}$/i;
    if (!codeRegex.test(clean)) {
      setCodeError('Format should be cly-xxx-xxx (e.g. cly-789-qwa)');
      return;
    }

    setCodeError(null);
    onJoinCode(clean);
  };

  const handleCopySampleCode = () => {
    setCopiedCode(true);
    setMeetingCode('cly-789-qwa');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <section className="relative pt-8 pb-16 md:pt-14 md:pb-24 overflow-hidden">
      <Container size="xl">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto mb-12 md:mb-16">
          {/* Engineering Roadmap Pill */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#DCEDE8] border border-[#168B83]/30 text-xs font-semibold text-[#168B83] mb-6">
            <Radio className="w-3.5 h-3.5 animate-pulse text-[#168B83]" aria-hidden="true" />
            <span>Architected on Selective Forwarding · Roadmap Aligned</span>
          </div>

          {/* Editorial Display Heading */}
          <h1 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl text-[#172B3A] tracking-tight leading-[1.1] mb-6 text-balance">
            Video collaboration engineered for{' '}
            <span className="text-[#168B83] underline decoration-[#168B83]/30 underline-offset-8">
              clarity
            </span>{' '}
            and data sovereignty.
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg md:text-xl text-[#3D5265] max-w-2xl font-normal leading-relaxed mb-8 sm:mb-10 text-balance">
            Connectly is designed for scalable video meetings powered by a selective forwarding unit (SFU) architecture. Planned for privacy and clarity—fluid video, vector whiteboarding, and encrypted transport.
          </p>

          {/* Dual Call-to-Action Area */}
          <div className="w-full max-w-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3.5 mb-8">
            {/* Primary Action Button */}
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={onStartInstantMeeting}
              className="w-full sm:w-auto text-base shadow-md px-7"
              leftIcon={<Video className="w-5 h-5" aria-hidden="true" />}
            >
              Start Instant Meeting
            </Button>

            {/* Join with Code Input Box */}
            <form
              onSubmit={handleJoinSubmit}
              className="flex-1 flex items-center bg-white border border-[#E3E1D9] rounded-lg p-1 shadow-sm focus-within:border-[#168B83] focus-within:ring-2 focus-within:ring-[#168B83]/20 transition-all"
            >
              <input
                type="text"
                value={meetingCode}
                onChange={handleCodeChange}
                placeholder="Enter code (cly-xxx-xxx)"
                aria-label="Meeting code"
                aria-invalid={Boolean(codeError)}
                aria-describedby={codeError ? 'code-error-msg' : undefined}
                className="flex-1 min-w-0 px-3 py-2 text-sm text-[#172B3A] placeholder-[#6B8092] bg-transparent outline-none font-mono"
              />
              <Button
                type="submit"
                variant="secondary"
                size="md"
                className="shrink-0"
              >
                Join
              </Button>
            </form>
          </div>

          {/* Validation Feedback */}
          {codeError && (
            <p id="code-error-msg" className="text-xs text-[#D94F4F] -mt-5 mb-6 font-medium">
              {codeError}
            </p>
          )}

          {/* Trust Value Badges */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-[#3D5265]">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#168B83]" aria-hidden="true" />
              <span>Planned DTLS-SRTP Transport</span>
            </span>
            <span className="hidden sm:inline text-[#E3E1D9]">•</span>
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-[#168B83]" aria-hidden="true" />
              <span>Target Scale: Up to 60 Participants</span>
            </span>
            <span className="hidden sm:inline text-[#E3E1D9]">•</span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[#168B83]" aria-hidden="true" />
              <span>Browser-Native · No App Install Required</span>
            </span>
          </div>
        </div>

        {/* =========================================================================
            AUTHENTIC PRODUCT INTERFACE PREVIEW (Meeting Theater Preview)
            ========================================================================= */}
        <div className="relative mx-auto max-w-5xl rounded-2xl p-2 sm:p-3 bg-[#172B3A] shadow-2xl border border-[#E3E1D9]/40">
          {/* Subtle Outer Glow & Frame */}
          <div className="w-full rounded-xl bg-[#101820] text-white overflow-hidden border border-white/10 flex flex-col">
            {/* Top Theater Header */}
            <div className="h-12 bg-[#182430] border-b border-white/10 px-4 sm:px-6 flex items-center justify-between text-xs">
              {/* Meeting Info */}
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#168B83] shrink-0" />
                <span className="font-semibold text-white truncate max-w-[180px] sm:max-w-xs md:max-w-md">
                  Q3 Distributed Systems & WebRTC Architecture Sync
                </span>
                <button
                  type="button"
                  onClick={handleCopySampleCode}
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#253746] text-[#8A9FA8] hover:text-white font-mono text-[11px] border border-white/10 transition-colors"
                  title="Click to copy sample code"
                >
                  <span>cly-789-qwa</span>
                  {copiedCode ? (
                    <Check className="w-3 h-3 text-[#2EC4B6]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* Status & Timer */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[#8A9FA8] bg-[#101820] px-2 py-0.5 rounded text-[11px] border border-white/5">
                  00:24:18
                </span>
                <Badge variant="success" className="hidden sm:inline-flex py-0 px-2 text-[10px] bg-[#168B83]/20 border-[#168B83]/40 text-[#2EC4B6]">
                  Simulcast · Planned Preview
                </Badge>
              </div>
            </div>

            {/* Video Grid Stage (2x2 Multi-Participant Layout Preview) */}
            <div className="p-3 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 bg-[#101820] min-h-[340px] sm:min-h-[420px]">
              {/* Tile 1: Active Speaker (Host) */}
              <div className="relative rounded-xl bg-[#1A2530] border-2 border-[#168B83] overflow-hidden flex flex-col justify-between p-3.5 shadow-lg min-h-[160px] sm:min-h-[190px]">
                <div className="flex items-center justify-between text-xs">
                  <span className="px-2 py-0.5 rounded bg-[#101820]/80 text-[#2EC4B6] font-semibold text-[11px] flex items-center gap-1.5 border border-[#168B83]/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#168B83] animate-ping" />
                    Active Speaker
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-3 bg-[#168B83] rounded-full animate-pulse" />
                    <span className="w-1.5 h-4 bg-[#168B83] rounded-full animate-pulse delay-75" />
                    <span className="w-1.5 h-2 bg-[#168B83] rounded-full animate-pulse delay-150" />
                  </div>
                </div>

                {/* Avatar Visual */}
                <div className="self-center my-auto flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-[#168B83] to-[#2EC4B6] flex items-center justify-center text-white font-display font-bold text-lg sm:text-xl shadow-md border-2 border-white/20">
                    SC
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs mt-2">
                  <span className="font-medium text-white/90">Sarah Chen (Host)</span>
                  <span className="p-1 rounded bg-[#168B83]/30 text-[#2EC4B6]">
                    <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>

              {/* Tile 2: Participant (Muted) */}
              <div className="relative rounded-xl bg-[#1A2530] border border-white/10 overflow-hidden flex flex-col justify-between p-3.5 min-h-[160px] sm:min-h-[190px]">
                <div className="flex items-center justify-between text-xs">
                  <span className="px-2 py-0.5 rounded bg-[#101820]/60 text-white/60 text-[11px]">
                    Participant
                  </span>
                </div>

                <div className="self-center my-auto flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#253746] flex items-center justify-center text-white/80 font-display font-bold text-lg sm:text-xl border border-white/10">
                    MV
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs mt-2">
                  <span className="font-medium text-white/80">Marcus Vance</span>
                  <span className="p-1 rounded bg-[#D94F4F]/20 text-[#D94F4F]">
                    <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>

              {/* Tile 3: Screen Share Stream Preview */}
              <div className="relative rounded-xl bg-[#1A2530] border border-white/10 overflow-hidden flex flex-col justify-between p-3.5 min-h-[160px] sm:min-h-[190px]">
                <div className="flex items-center justify-between text-xs z-10">
                  <span className="px-2 py-0.5 rounded bg-[#168B83]/90 text-white text-[11px] font-medium flex items-center gap-1">
                    <MonitorUp className="w-3 h-3" aria-hidden="true" />
                    Dr. Elena Rostova's Screen
                  </span>
                  <span className="font-mono text-[10px] text-white/60 bg-black/40 px-1.5 py-0.5 rounded">
                    Screen Stream · Active
                  </span>
                </div>

                {/* Simulated Screen Presentation Graphic */}
                <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-[#182430] to-[#121B24]">
                  <div className="w-full max-w-xs space-y-2 opacity-80">
                    <div className="h-2 w-3/4 bg-[#168B83]/40 rounded" />
                    <div className="h-1.5 w-full bg-white/10 rounded" />
                    <div className="h-1.5 w-5/6 bg-white/10 rounded" />
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      <div className="h-12 bg-[#253746] rounded border border-white/10 flex items-center justify-center text-[10px] text-[#2EC4B6] font-mono">
                        SFU Core
                      </div>
                      <div className="h-12 bg-[#253746] rounded border border-white/10 flex items-center justify-center text-[10px] text-[#2EC4B6] font-mono">
                        Simulcast
                      </div>
                      <div className="h-12 bg-[#253746] rounded border border-white/10 flex items-center justify-center text-[10px] text-[#2EC4B6] font-mono">
                        SFrame Key
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs mt-2 z-10">
                  <span className="font-medium text-white/80">Architecture Topology</span>
                  <span className="p-1 rounded bg-[#101820]/70 text-[#2EC4B6]">
                    <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>

              {/* Tile 4: Participant */}
              <div className="relative rounded-xl bg-[#1A2530] border border-white/10 overflow-hidden flex flex-col justify-between p-3.5 min-h-[160px] sm:min-h-[190px]">
                <div className="flex items-center justify-between text-xs">
                  <span className="px-2 py-0.5 rounded bg-[#101820]/60 text-white/60 text-[11px]">
                    Participant
                  </span>
                </div>

                <div className="self-center my-auto flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#253746] flex items-center justify-center text-white/80 font-display font-bold text-lg sm:text-xl border border-white/10">
                    DT
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs mt-2">
                  <span className="font-medium text-white/80">Devon Taylor</span>
                  <span className="p-1 rounded bg-[#101820]/70 text-[#2EC4B6]">
                    <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Floating Pill Dock Bar */}
            <div className="p-3 bg-[#182430] border-t border-white/10 flex items-center justify-center">
              <div className="inline-flex items-center gap-1.5 sm:gap-2.5 px-3 sm:px-4 py-2 rounded-full bg-[#253746] border border-white/10 shadow-cly-theater">
                <button
                  type="button"
                  aria-label="Microphone preview"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#168B83] text-white flex items-center justify-center hover:bg-[#11706A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4B6]"
                >
                  <Mic className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Camera preview"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#168B83] text-white flex items-center justify-center hover:bg-[#11706A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4B6]"
                >
                  <Video className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Screen share preview"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#1A2530] text-white/80 flex items-center justify-center hover:bg-[#334A5D] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4B6]"
                >
                  <MonitorUp className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Collaborative whiteboard preview"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#1A2530] text-white/80 flex items-center justify-center hover:bg-[#334A5D] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4B6]"
                >
                  <PenTool className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Chat drawer preview (2 unread)"
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#1A2530] text-white/80 flex items-center justify-center hover:bg-[#334A5D] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4B6]"
                  >
                    <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                  </button>
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#168B83] text-white text-[10px] font-bold flex items-center justify-center border border-[#253746]">
                    2
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Participants list preview"
                  className="hidden sm:flex w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#1A2530] text-white/80 items-center justify-center hover:bg-[#334A5D] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2EC4B6]"
                >
                  <Users className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                </button>
                <div className="w-px h-6 bg-white/10 mx-0.5" />
                <button
                  type="button"
                  aria-label="Leave meeting preview"
                  className="px-3 sm:px-4 h-9 sm:h-10 rounded-full bg-[#D94F4F] text-white font-medium text-xs sm:text-sm flex items-center gap-1.5 hover:bg-[#BF3C3C] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F87171]"
                >
                  <PhoneOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden xs:inline">Leave</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default HeroSection;

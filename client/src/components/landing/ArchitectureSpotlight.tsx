import React from 'react';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Network, CheckCircle2, AlertCircle } from 'lucide-react';

export const ArchitectureSpotlight: React.FC = () => {
  return (
    <section id="architecture" className="py-16 md:py-24 bg-[#F3F2EE] dark:bg-[#141619] scroll-mt-14">
      <Container size="xl">
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Media Routing Architecture
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#1F2428] dark:text-[#EAECEE] tracking-tight mb-4">
            Understanding the Selective Forwarding difference.
          </h2>
          <p className="text-base sm:text-lg text-[#555D66] dark:text-[#A3AAB2] leading-relaxed">
            Real-time video architectures differ fundamentally in how streams flow. Connectly routes media through a Selective Forwarding Unit (SFU) to keep every client fast and cool.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Traditional Mesh P2P */}
          <Card
            variant="standard"
            className="p-6 sm:p-8 bg-[#FAF9F6] dark:bg-[#1C1F24] border border-[#DDDAD0] dark:border-[#2B3038] rounded-2xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#C24D4D] dark:text-[#D46A6A] bg-[#F6E6E6] dark:bg-[#342023] px-2.5 py-1 rounded-md">
                  Full-Mesh Topology
                </span>
                <span className="text-xs font-mono text-[#7C848D] dark:text-[#747C86]">N × (N - 1) Links</span>
              </div>
              <h3 className="font-display font-bold text-xl text-[#1F2428] dark:text-[#EAECEE] mb-2">
                Peer-to-Peer Mesh (Browser to Browser)
              </h3>
              <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed mb-6">
                In a pure mesh topology, each participant opens direct connections to every other peer. Upload streams and CPU encoding cost multiply rapidly as rooms grow.
              </p>

              <div className="p-4 rounded-xl bg-[#F3F2EE] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038] mb-6 flex flex-col items-center justify-center text-center">
                <div className="font-mono text-xs text-[#C24D4D] dark:text-[#D46A6A] font-semibold mb-1">
                  Client Uplink Multiplies with Each Peer
                </div>
                <div className="flex items-center gap-2 text-xs text-[#7C848D] dark:text-[#A3AAB2]">
                  <AlertCircle className="w-4 h-4 text-[#C24D4D] dark:text-[#D46A6A]" aria-hidden="true" />
                  <span>Bandwidth and CPU load scale sharply with participant count</span>
                </div>
              </div>

              <ul className="space-y-2.5 text-xs text-[#555D66] dark:text-[#A3AAB2]">
                <li className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#C24D4D] dark:text-[#D46A6A] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Direct peer connections grow quadratically across the room</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#C24D4D] dark:text-[#D46A6A] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Devices must encode and push duplicate streams per attendee</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#C24D4D] dark:text-[#D46A6A] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Higher packet loss risk on mobile and constrained networks</span>
                </li>
              </ul>
            </div>
          </Card>

          {/* CONNECTLY SFU Architecture */}
          <Card
            variant="standard"
            className="p-6 sm:p-8 bg-[#FAF9F6] dark:bg-[#1C1F24] border-2 border-[#2F6F68] dark:border-[#5FA399] rounded-2xl shadow-cly-md flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#2F6F68] dark:text-[#5FA399] bg-[#E2ECE9] dark:bg-[#1F302E] px-2.5 py-1 rounded-md">
                  Selective Forwarding Unit
                </span>
                <span className="text-xs font-mono text-[#2F6F68] dark:text-[#5FA399] font-bold">Adaptive Media Routing</span>
              </div>
              <h3 className="font-display font-bold text-xl text-[#1F2428] dark:text-[#EAECEE] mb-2">
                Connectly SFU Routing Engine
              </h3>
              <p className="text-sm text-[#555D66] dark:text-[#A3AAB2] leading-relaxed mb-6">
                Each participant sends a single media uplink to the SFU. Streams are selectively routed based on active speaker state, layout size, and receiver bandwidth.
              </p>

              <div className="p-4 rounded-xl bg-[#E2ECE9]/60 dark:bg-[#1F302E] border border-[#2F6F68]/25 dark:border-[#5FA399]/30 mb-6 flex flex-col items-center justify-center text-center">
                <div className="font-mono text-xs text-[#2F6F68] dark:text-[#5FA399] font-bold mb-1">
                  Single Client Uplink to Media Router
                </div>
                <div className="flex items-center gap-2 text-xs text-[#1F2428] dark:text-[#EAECEE]">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399]" aria-hidden="true" />
                  <span>Adaptive multi-resolution simulcast without redundant uploads</span>
                </div>
              </div>

              <ul className="space-y-2.5 text-xs text-[#555D66] dark:text-[#A3AAB2]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Every client publishes once to the SFU media node</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Subscriber layers automatically match tile size and network headroom</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#2F6F68] dark:text-[#5FA399] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Smooth performance up to 60 concurrent room participants</span>
                </li>
              </ul>
            </div>
          </Card>
        </div>

        {/* Technical Specification Bar */}
        <div className="rounded-2xl bg-[#1C1F24] text-[#EAECEE] p-6 sm:p-8 border border-[#2B3038] shadow-cly-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-white/10">
            <div>
              <span className="text-xs font-mono font-bold text-[#5FA399] uppercase tracking-wider">
                Operational Stack
              </span>
              <h4 className="font-display font-bold text-xl sm:text-2xl mt-1 text-[#EAECEE]">
                Engineered around open communication protocols
              </h4>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#A3AAB2]">
              <Network className="w-4 h-4 text-[#5FA399]" aria-hidden="true" />
              <span>Open IETF WebRTC Standards</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-6">
            <div>
              <div className="text-xs text-[#747C86] font-mono mb-1">MEDIA CORE</div>
              <div className="font-display font-bold text-base text-[#EAECEE]">LiveKit SFU</div>
              <div className="text-xs text-[#A3AAB2] mt-0.5">Pion WebRTC (Go)</div>
            </div>
            <div>
              <div className="text-xs text-[#747C86] font-mono mb-1">CODEC SUITE</div>
              <div className="font-display font-bold text-base text-[#EAECEE]">VP8 / VP9 / AV1</div>
              <div className="text-xs text-[#A3AAB2] mt-0.5">Simulcast layers</div>
            </div>
            <div>
              <div className="text-xs text-[#747C86] font-mono mb-1">AUDIO PIPELINE</div>
              <div className="font-display font-bold text-base text-[#EAECEE]">Opus 48kHz</div>
              <div className="text-xs text-[#A3AAB2] mt-0.5">DTX &amp; echo control</div>
            </div>
            <div>
              <div className="text-xs text-[#747C86] font-mono mb-1">ROOM CAPACITY</div>
              <div className="font-display font-bold text-base text-[#EAECEE]">Multi-User Rooms</div>
              <div className="text-xs text-[#A3AAB2] mt-0.5">Up to 60 attendees</div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default ArchitectureSpotlight;

import React from 'react';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Network, CheckCircle2, AlertCircle } from 'lucide-react';

export const ArchitectureSpotlight: React.FC = () => {
  return (
    <section id="architecture" className="py-16 md:py-24 bg-[#F7F6F2] scroll-mt-14">
      <Container size="xl">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
          <Badge variant="host" className="mb-3">
            Media Routing Architecture
          </Badge>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#172B3A] tracking-tight mb-4">
            Understanding the Selective Forwarding difference.
          </h2>
          <p className="text-base sm:text-lg text-[#3D5265] leading-relaxed">
            Real-time video conferencing architectures differ fundamentally in how media flows between participants. Connectly is planned on a Selective Forwarding Unit (SFU) model to optimize endpoint efficiency.
          </p>
        </div>

        {/* Dual Comparison Cards: Mesh P2P vs Connectly SFU */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Card 1: Traditional Mesh P2P */}
          <Card
            variant="standard"
            className="p-6 sm:p-8 bg-white/70 border border-[#E3E1D9] rounded-2xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#D94F4F] bg-[#FEE2E2] px-2.5 py-1 rounded-md">
                  Full-Mesh Topology
                </span>
                <span className="text-xs font-mono text-[#6B8092]">N × (N - 1) Peer Links</span>
              </div>
              <h3 className="font-display font-bold text-xl text-[#172B3A] mb-2">
                Peer-to-Peer Mesh (Browser to Browser)
              </h3>
              <p className="text-sm text-[#3D5265] leading-relaxed mb-6">
                In a pure peer-to-peer mesh, each participant maintains direct bi-directional connections to every other user. As room roster expands, client upload streams and CPU encoding demands multiply rapidly.
              </p>

              {/* Conceptual Graphic */}
              <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#E3E1D9] mb-6 flex flex-col items-center justify-center text-center">
                <div className="font-mono text-xs text-[#D94F4F] font-semibold mb-1">
                  Client Uplink Multiplies with Each Peer
                </div>
                <div className="flex items-center gap-2 text-xs text-[#6B8092]">
                  <AlertCircle className="w-4 h-4 text-[#D94F4F]" aria-hidden="true" />
                  <span>Uplink bandwidth and encoding overhead scale with participant count</span>
                </div>
              </div>

              {/* Technical Characteristics */}
              <ul className="space-y-2.5 text-xs text-[#3D5265]">
                <li className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#D94F4F] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Direct peer connections multiply exponentially across the room roster</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#D94F4F] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Client devices must encode and transmit separate video streams to each peer</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#D94F4F] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Increased susceptibility to thermal throttling and packet drops on constrained devices</span>
                </li>
              </ul>
            </div>
          </Card>

          {/* Card 2: CONNECTLY SFU Architecture */}
          <Card
            variant="standard"
            className="p-6 sm:p-8 bg-white border-2 border-[#168B83] rounded-2xl shadow-cly-md flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#168B83] bg-[#DCEDE8] px-2.5 py-1 rounded-md">
                  Selective Forwarding Unit (SFU)
                </span>
                <span className="text-xs font-mono text-[#168B83] font-bold">Centralized Media Routing</span>
              </div>
              <h3 className="font-display font-bold text-xl text-[#172B3A] mb-2">
                Planned SFU Routing Engine
              </h3>
              <p className="text-sm text-[#3D5265] leading-relaxed mb-6">
                With an SFU, each client establishes a single uplink session to the media server. The SFU selectively forwards media streams to subscribers based on active speaker status, screen real estate, and receiver capacity.
              </p>

              {/* Conceptual Graphic */}
              <div className="p-4 rounded-xl bg-[#DCEDE8]/40 border border-[#168B83]/30 mb-6 flex flex-col items-center justify-center text-center">
                <div className="font-mono text-xs text-[#168B83] font-bold mb-1">
                  Streamlined Client Uplink to Media Router
                </div>
                <div className="flex items-center gap-2 text-xs text-[#172B3A]">
                  <CheckCircle2 className="w-4 h-4 text-[#168B83]" aria-hidden="true" />
                  <span>Single media publish session with adaptive multi-resolution simulcast</span>
                </div>
              </div>

              {/* Technical Characteristics */}
              <ul className="space-y-2.5 text-xs text-[#3D5265]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#168B83] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Each client publishes media to a single SFU endpoint rather than multiple peers</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#168B83] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>SFU forwards optimized simulcast layers matching each receiver's layout geometry</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#168B83] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Server bandwidth and processing scale with aggregate subscriptions and media quality</span>
                </li>
              </ul>
            </div>
          </Card>
        </div>

        {/* Technical Specification Bar */}
        <div className="rounded-2xl bg-[#172B3A] text-white p-6 sm:p-8 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-white/10">
            <div>
              <span className="text-xs font-mono font-bold text-[#2EC4B6] uppercase tracking-wider">
                Planned Architectural Stack
              </span>
              <h4 className="font-display font-bold text-xl sm:text-2xl mt-1 text-white">
                Engineered around open communication protocols
              </h4>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#8A9FA8]">
              <Network className="w-4 h-4 text-[#2EC4B6]" aria-hidden="true" />
              <span>Aligned with open IETF WebRTC standards</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-6">
            <div>
              <div className="text-xs text-[#8A9FA8] font-mono mb-1">PLANNED CORE</div>
              <div className="font-display font-bold text-base text-white">LiveKit SFU</div>
              <div className="text-xs text-[#8A9FA8] mt-0.5">Pion WebRTC (Go)</div>
            </div>
            <div>
              <div className="text-xs text-[#8A9FA8] font-mono mb-1">CODEC SUITE</div>
              <div className="font-display font-bold text-base text-white">VP8 / VP9 / AV1</div>
              <div className="text-xs text-[#8A9FA8] mt-0.5">Simulcast layers</div>
            </div>
            <div>
              <div className="text-xs text-[#8A9FA8] font-mono mb-1">AUDIO ARCHITECTURE</div>
              <div className="font-display font-bold text-base text-white">Opus 48kHz</div>
              <div className="text-xs text-[#8A9FA8] mt-0.5">DTX & echo control</div>
            </div>
            <div>
              <div className="text-xs text-[#8A9FA8] font-mono mb-1">TARGET SCALE</div>
              <div className="font-display font-bold text-base text-white">Multi-User Rooms</div>
              <div className="text-xs text-[#8A9FA8] mt-0.5">Up to 60 (Phase 10)</div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default ArchitectureSpotlight;

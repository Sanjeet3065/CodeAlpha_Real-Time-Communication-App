import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar } from '@/components/landing/NavBar';
import { HeroSection } from '@/components/landing/HeroSection';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
import { ArchitectureSpotlight } from '@/components/landing/ArchitectureSpotlight';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { SecurityTrustSection } from '@/components/landing/SecurityTrustSection';
import { ConversionBanner } from '@/components/landing/ConversionBanner';
import { Footer } from '@/components/landing/Footer';
import { PhaseNoticeModal } from '@/components/landing/PhaseNoticeModal';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    targetPhase: string;
    description: string;
    detail?: string;
  }>({
    isOpen: false,
    title: '',
    targetPhase: '',
    description: '',
  });

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleOpenAuthNotice = (intent: string) => {
    if (intent === 'Sign In' || intent.toLowerCase().includes('sign in') || intent.toLowerCase().includes('login')) {
      navigate('/login');
    } else {
      navigate('/register');
    }
  };

  const handleStartInstantMeeting = () => {
    setModalState({
      isOpen: true,
      title: 'Instant Meeting Room Creation',
      targetPhase: 'Phase 08 — Meeting Room Management',
      description:
        'Instant room generation, cryptographic room code assignment (cly-xxx-xxx), host token generation, and waiting room policies will be operational in Phase 08, powered by LiveKit SFU in Phase 09.',
      detail: 'Prerequisite: Phase 05 (Authentication System) & Phase 07 (Backend & Database).',
    });
  };

  const handleJoinCode = (code: string) => {
    setModalState({
      isOpen: true,
      title: 'Join Room by Code',
      targetPhase: 'Phase 08 — Meeting Room Management',
      description: `Validated room code "${code}". Live conference room connectivity, peer admission, and media negotiation will launch when the room gateway and media servers are deployed.`,
      detail: `Validated syntax: ${code} (Format verified). Room gateway connection scheduled for Phase 08.`,
    });
  };

  const handleExploreTech = () => {
    const el = document.getElementById('architecture');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handlePolicyNotice = (topic: string) => {
    setModalState({
      isOpen: true,
      title: `${topic}`,
      targetPhase: 'Documentation & Architecture',
      description: `CONNECTLY maintains strict adherence to ${topic}. In Phase 04, our technical and compliance specifications are fully documented in the docs/ architectural repository.`,
      detail: 'Reference docs: docs/SECURITY_PLAN.md, docs/REQUIREMENTS.md, docs/ACCESSIBILITY_GUIDELINES.md',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F6F2] text-[#172B3A] selection:bg-[#DCEDE8] selection:text-[#168B83]">
      {/* Primary Navigation Header */}
      <NavBar onOpenAuthNotice={handleOpenAuthNotice} />

      {/* Main Page Landmark */}
      <main id="main-content" className="flex-1 outline-none">
        {/* Section 01: Hero with Live Product Preview */}
        <HeroSection
          onStartInstantMeeting={handleStartInstantMeeting}
          onJoinCode={handleJoinCode}
        />

        {/* Section 02: 6 Core Capabilities Grid */}
        <FeatureGrid />

        {/* Section 03: Selective Forwarding Architecture Spotlight */}
        <ArchitectureSpotlight />

        {/* Section 04: 3-Step Simple Workflow */}
        <HowItWorksSection />

        {/* Section 05: Trust & Security Architecture */}
        <SecurityTrustSection />

        {/* Section 06: Final Conversion Card */}
        <ConversionBanner
          onStartMeeting={handleStartInstantMeeting}
          onExploreTech={handleExploreTech}
        />
      </main>

      {/* Primary Footer */}
      <Footer onOpenNotice={handlePolicyNotice} />

      {/* Transparent Roadmap Phase Notice Modal */}
      <PhaseNoticeModal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        title={modalState.title}
        targetPhase={modalState.targetPhase}
        description={modalState.description}
        detail={modalState.detail}
      />
    </div>
  );
};

export default LandingPage;

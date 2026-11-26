import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { validateMeetingCode } from '@/lib/meetingCode';
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
  const { isAuthenticated } = useAuth();
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
    navigate(isAuthenticated ? '/dashboard' : '/login?redirect=%2Fdashboard');
  };

  const handleJoinCode = (code: string) => {
    const parsed = validateMeetingCode(code);
    const targetCode = parsed.isValid ? parsed.normalizedCode : code.trim();
    navigate(`/join/${encodeURIComponent(targetCode)}`);
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
      targetPhase: 'Architecture & Security Overview',
      description: `CONNECTLY enforces strict standards for ${topic}. Full security, encryption, and accessibility documentation is maintained alongside our live deployment.`,
      detail: 'Encryption: Argon2id + Dual JWT + DTLS-SRTP + Supabase RLS & Private Storage',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F2EE] text-[#1F2428] dark:bg-[#141619] dark:text-[#EAECEE] selection:bg-[#E2ECE9] selection:text-[#2F6F68] dark:selection:bg-[#1F302E] dark:selection:text-[#5FA399]">
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

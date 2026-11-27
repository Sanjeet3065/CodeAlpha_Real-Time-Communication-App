import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { NavBar } from '@/components/landing/NavBar';
import { HeroSection } from '@/components/landing/HeroSection';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
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
    const normalized = intent.toLowerCase();
    if (normalized.includes('sign in') || normalized.includes('login')) {
      navigate('/login');
      return;
    }
    navigate('/register');
  };

  const handleWorkspaceAction = () => {
    navigate(isAuthenticated ? '/dashboard' : '/register');
  };

  const handleExploreStudio = () => {
    const el = document.getElementById('studio');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handlePolicyNotice = (topic: string) => {
    setModalState({
      isOpen: true,
      title: topic,
      targetPhase: 'Architecture & Security Overview',
      description: `CONNECTLY enforces strict standards for ${topic}. Full security, encryption, and accessibility documentation is maintained alongside our live deployment.`,
      detail: 'Encryption: Argon2id + Dual JWT + DTLS-SRTP + Supabase RLS & Private Storage',
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F2EE] text-[#1F2428] dark:bg-[#141619] dark:text-[#EAECEE] selection:bg-[#E2ECE9] selection:text-[#2F6F68] dark:selection:bg-[#1F302E] dark:selection:text-[#5FA399]">
      <NavBar onOpenAuthNotice={handleOpenAuthNotice} />

      <main id="main-content" className="flex-1 outline-none">
        <HeroSection
          isAuthenticated={isAuthenticated}
          onPrimaryAction={handleWorkspaceAction}
          onExploreStudio={handleExploreStudio}
        />
        <FeatureGrid />
        <ConversionBanner
          isAuthenticated={isAuthenticated}
          onPrimaryAction={handleWorkspaceAction}
          onOpenSecurityNotice={handlePolicyNotice}
        />
      </main>

      <Footer onOpenNotice={handlePolicyNotice} />

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

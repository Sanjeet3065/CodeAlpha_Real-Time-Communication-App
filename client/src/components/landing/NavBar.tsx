import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Video, Menu, X, ArrowRight, User as UserIcon, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

export interface NavBarProps {
  onOpenAuthNotice?: (intent: string) => void;
}

export const NavBar: React.FC<NavBarProps> = ({ onOpenAuthNotice }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleSignIn = () => {
    if (onOpenAuthNotice) {
      onOpenAuthNotice('Sign In');
    } else {
      navigate('/login');
    }
  };

  const handleGetStarted = () => {
    if (onOpenAuthNotice) {
      onOpenAuthNotice('Get Started');
    } else {
      navigate('/register');
    }
  };

  // Monitor scroll for header border & shadow enhancement
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Prevent background scrolling when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // Handle escape key to close mobile menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Architecture', href: '#architecture' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Security', href: '#security' },
  ];

  const handleLinkClick = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-all duration-200',
        'bg-white/90 backdrop-blur-md border-b',
        isScrolled ? 'border-[#E3E1D9] shadow-cly-sm py-2.5' : 'border-[#E3E1D9]/70 py-3.5'
      )}
    >
      <Container size="xl">
        <div className="flex items-center justify-between h-11 md:h-12">
          {/* Brand Mark */}
          <a
            href="/"
            className="flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded-lg px-1 py-0.5"
            aria-label="CONNECTLY home"
          >
            <span className="w-9 h-9 rounded-xl bg-[#172B3A] text-white flex items-center justify-center transition-transform group-hover:scale-105 shadow-sm">
              <Video className="w-5 h-5 text-[#168B83]" aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="font-display font-extrabold text-xl tracking-tight text-[#172B3A]">
                CONNECTLY
              </span>
            </div>
          </a>

          {/* Center Navigation Links (Desktop >= 1024px) */}
          <nav
            aria-label="Main Navigation"
            className="hidden lg:flex items-center gap-8 text-sm font-medium text-[#3D5265]"
          >
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="hover:text-[#172B3A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83] rounded-md px-1 py-0.5"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Right Action CTAs (Desktop) */}
          <div className="hidden lg:flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <Link
                  to="/dashboard"
                  className="flex items-center gap-2 text-sm font-medium text-[#172B3A] hover:text-[#168B83] px-2 py-1 rounded-md transition-colors"
                >
                  <UserIcon className="w-4 h-4 text-[#168B83]" aria-hidden="true" />
                  <span>{user?.firstName}</span>
                </Link>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => navigate('/dashboard')}
                  rightIcon={<LayoutDashboard className="w-4 h-4" aria-hidden="true" />}
                >
                  Dashboard
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="tertiary"
                  size="md"
                  onClick={handleSignIn}
                >
                  Sign In
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleGetStarted}
                  rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                >
                  Get Started
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Hamburger Button */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-navigation-drawer"
              className="p-2.5 rounded-lg text-[#172B3A] hover:bg-[#F7F6F2] active:bg-[#ECEBE4] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83]"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" aria-hidden="true" />
              ) : (
                <Menu className="w-6 h-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </Container>

      {/* Mobile Slide-Over Drawer */}
      {isMobileMenuOpen && (
        <div
          id="mobile-navigation-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation"
          className="lg:hidden fixed inset-x-0 top-[60px] bottom-0 z-50 bg-[#172B3A]/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <div className="bg-white border-b border-[#E3E1D9] shadow-xl p-6 flex flex-col gap-6 animate-in slide-in-from-top-2 duration-200">
            {/* Mobile Nav Links */}
            <nav aria-label="Mobile Main Navigation" className="flex flex-col gap-3">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={handleLinkClick}
                  className="px-3 py-2 text-base font-medium text-[#172B3A] hover:bg-[#F7F6F2] rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168B83]"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            {/* Mobile CTAs */}
            <div className="flex flex-col gap-3 pt-4 border-t border-[#E3E1D9]">
              {isAuthenticated ? (
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="w-full justify-center"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    navigate('/dashboard');
                  }}
                  rightIcon={<LayoutDashboard className="w-4 h-4" aria-hidden="true" />}
                >
                  Go to Dashboard ({user?.firstName})
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full justify-center"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleSignIn();
                    }}
                  >
                    Sign In
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full justify-center"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleGetStarted();
                    }}
                    rightIcon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                  >
                    Get Started
                  </Button>
                </>
              )}
            </div>

            {/* Roadmap Badge Notice */}
            <div className="p-3 bg-[#F7F6F2] rounded-lg text-xs text-[#3D5265] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#168B83] shrink-0" aria-hidden="true" />
              <span>Phase 05 Active · Production Authentication Operational</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

import { Link } from 'react-router-dom';
import {
  Video,
  Users,
  Monitor,
  PenTool,
  Folder,
  ShieldCheck,
  Shield,
  ArrowRight,
  CheckCircle2,
  LogIn,
  UserPlus,
  Zap,
  Lock,
  Sun,
  Moon,
  AtSign,
  Code2,
  Briefcase
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useThemeStore } from '@/stores/themeStore';

export function LandingPage() {
  const { theme, setTheme } = useThemeStore();
  const isDark = theme === 'dark';

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const features = [
    {
      icon: Video,
      iconBg: 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400',
      title: 'Video Conferencing',
      desc: 'Experience crystal-clear, multi-party HD video meetings with intelligent active speaker tracking, adaptable grid layouts, and instantaneous room entry.'
    },
    {
      icon: Monitor,
      iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
      title: 'Screen Sharing',
      desc: 'Effortlessly broadcast your full display, specific application windows, or browser tabs in real time with high-framerate rendering and interactive annotations.'
    },
    {
      icon: PenTool,
      iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
      title: 'Real-Time Whiteboard',
      desc: 'Ideate and sketch collaboratively on an infinite shared canvas featuring multi-color drawing tools, smart geometric shapes, sticky notes, and live cursor tracking.'
    },
    {
      icon: Folder,
      iconBg: 'bg-rose-50 text-rose-500 dark:bg-rose-950/50 dark:text-rose-400',
      title: 'Secure File Sharing',
      desc: 'Instantly upload, preview, and exchange documents, code snippets, and media assets during live sessions with robust encryption and role-based permissions.'
    },
    {
      icon: ShieldCheck,
      iconBg: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/50 dark:text-cyan-400',
      title: 'End-to-End Security',
      desc: 'Enterprise-grade privacy powered by TLS 1.3, DTLS-SRTP transport encryption, secure JWT session verification, and zero-knowledge data architecture.'
    },
    {
      icon: Users,
      iconBg: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400',
      title: 'Real-Time Collaboration',
      desc: 'Keep conversations synchronized with low-latency in-meeting messaging, live participant presence indicators, rich reactions, and instant WebRTC streaming.'
    }
  ];

  const steps = [
    {
      number: '1',
      icon: UserPlus,
      title: 'Create an account',
      desc: 'Sign up for free with your email address. Set up your display name and profile in seconds — no credit card required.',
      link: '/signup'
    },
    {
      number: '2',
      icon: LogIn,
      title: 'Sign in securely',
      desc: 'Log in with your credentials. Connectly uses secure JWT sessions and end-to-end encrypted authentication to protect your identity.',
      link: '/login'
    },
    {
      number: '3',
      icon: Video,
      title: 'Start or join a meeting',
      desc: 'Launch an instant meeting room or join via a shared meeting ID or link. Your workspace is ready the moment you log in.',
      link: '/dashboard'
    }
  ];

  return (
    <div className="min-h-screen bg-[#fafbfc] dark:bg-gray-950 text-slate-900 dark:text-slate-100 antialiased transition-colors duration-300">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/90 dark:bg-gray-950/90 border-b border-slate-200/80 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <Logo size="md" />
            </Link>

            <div className="flex items-center gap-3">
              {/* Theme Toggle Button */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 hover:scale-105 active:scale-95 transition-all shadow-sm"
              >
                {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-700" />}
              </button>

              {/* Sign In Button */}
              <Link
                to="/login"
                className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-800 hover:scale-105 active:scale-95 font-semibold text-sm transition-all shadow-sm"
              >
                Sign In
              </Link>

              {/* Get Started Button */}
              <Link
                to="/signup"
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm hover:scale-105 active:scale-95 transition-all shadow-md shadow-indigo-600/25"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-12 pb-20 sm:pt-16 sm:pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            {/* Left Hero Column */}
            <div className="lg:col-span-6 space-y-6">
              {/* Pill Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-semibold shadow-xs">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Unified Collaboration Suite</span>
              </div>

              {/* Main Heading */}
              <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-extrabold text-slate-900 dark:text-white tracking-tight leading-[1.14]">
                Connect. Collaborate.{' '}
                <span className="text-indigo-600 dark:text-indigo-400">Create.</span>
              </h1>

              {/* Subtitle */}
              <p className="text-slate-600 dark:text-slate-300 text-base sm:text-lg leading-relaxed max-w-xl font-normal">
                Securely communicate, conduct video meetings, share screens, exchange files,
                and collaborate on a real-time whiteboard — all in one platform.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm sm:text-base transition-all shadow-md shadow-indigo-600/25 hover:shadow-xl hover:shadow-indigo-600/35 hover:-translate-y-1 active:translate-y-0"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>Get Started Free</span>
                </Link>

                <Link
                  to="/login"
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-700 dark:text-slate-200 font-semibold text-sm sm:text-base transition-all shadow-sm hover:shadow-md hover:-translate-y-1 active:translate-y-0"
                >
                  <LogIn className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <span>Sign In</span>
                </Link>
              </div>

              {/* Feature Checkpoints */}
              <div className="flex flex-wrap items-center gap-6 pt-4 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-slate-800 dark:text-slate-200" />
                  <span>No download required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-slate-800 dark:text-slate-200" />
                  <span>Browser-based</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-slate-800 dark:text-slate-200" />
                  <span>Free to start</span>
                </div>
              </div>
            </div>

            {/* Right Hero Column: Tablet Mockup with Professional Zoom Hover */}
            <div className="lg:col-span-6 flex justify-center lg:justify-end">
              <div className="relative w-full max-w-xl group cursor-pointer">
                {/* Background Ambient Glow on Hover */}
                <div className="absolute -inset-2 bg-gradient-to-r from-indigo-500/20 via-blue-500/20 to-purple-500/20 rounded-[32px] blur-2xl opacity-40 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700 ease-out pointer-events-none" />

                {/* Tablet Frame Container */}
                <div className="relative rounded-2xl sm:rounded-3xl border border-slate-200/90 dark:border-gray-800 shadow-2xl overflow-hidden bg-slate-900 transform group-hover:scale-[1.03] group-hover:-translate-y-1.5 transition-all duration-500 ease-out group-hover:shadow-[0_25px_60px_-15px_rgba(79,70,229,0.35)]">
                  <img
                    src="/hero-tablet.jpg"
                    alt="Connectly Video Conferencing Interface on Tablet"
                    className="w-full h-auto object-cover transform group-hover:scale-[1.05] transition-transform duration-700 ease-out"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid Section: "Everything you need to work together" */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-900/40 border-t border-b border-slate-200/70 dark:border-gray-800/80">
        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Everything you need to work together
            </h2>
            <p className="mt-3 text-base sm:text-lg text-slate-500 dark:text-slate-400 font-normal">
              A unified architecture engineered for speed, ultra-low latency, and distraction-free collaboration.
            </p>
          </div>

          {/* 6 Feature Cards Grid with Professional Interactive Hover */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative bg-white dark:bg-gray-900 rounded-3xl p-8 border border-slate-100 dark:border-gray-800/90 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-2xl hover:shadow-indigo-500/15 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:-translate-y-2.5 transition-all duration-300 ease-out flex flex-col justify-between cursor-pointer overflow-hidden"
              >
                {/* Subtle top-right ambient hover highlight */}
                <div className="absolute top-0 right-0 w-36 h-36 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                <div>
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300 ease-out group-hover:scale-110 group-hover:rotate-3 shadow-xs ${feature.iconBg}`}
                  >
                    <feature.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400 font-normal">
                    {feature.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works Section: "Get started in seconds" */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="text-center max-w-2xl mx-auto mb-20">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-4 shadow-xs">
              <Zap className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Simple Onboarding</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Get started in seconds
            </h2>
            <p className="mt-3 text-base sm:text-lg text-slate-500 dark:text-slate-400 font-normal">
              No downloads, no installs — sign up, start meeting, and collaborate right from your browser.
            </p>
          </div>

          {/* 3 Step Cards Grid with Interactive Hover & Connecting Line */}
          <div className="relative">
            {/* Connecting Horizontal Line (desktop) */}
            <div className="hidden lg:block absolute top-4 left-[16%] right-[16%] h-[2px] bg-indigo-100 dark:bg-indigo-950 -z-0" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
              {steps.map((step) => (
                <div
                  key={step.number}
                  className="group bg-white dark:bg-gray-900 rounded-3xl p-8 border border-slate-100 dark:border-gray-800 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-2xl hover:shadow-indigo-500/15 hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:-translate-y-2.5 text-center flex flex-col items-center transition-all duration-300 ease-out relative cursor-pointer"
                >
                  {/* Step Number Circle */}
                  <div className="w-9 h-9 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center -mt-12 mb-6 shadow-md ring-4 ring-white dark:ring-gray-900 group-hover:scale-115 group-hover:ring-indigo-100 dark:group-hover:ring-indigo-900/60 transition-all duration-300">
                    {step.number}
                  </div>

                  {/* Icon Box */}
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-5 group-hover:scale-110 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/80 transition-all duration-300">
                    <step.icon className="w-6 h-6" />
                  </div>

                  {/* Title & Desc */}
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400 mb-6 font-normal">
                    {step.desc}
                  </p>

                  <Link
                    to={step.link}
                    className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 group-hover:gap-2.5 transition-all duration-200"
                  >
                    <span>Proceed to step</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Security Banner Section (Inverted Contrast: Dark when site is Light, Light when site is Dark) */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div
            className={`rounded-3xl p-8 sm:p-12 lg:p-14 relative overflow-hidden shadow-2xl transition-all duration-500 ${
              isDark
                ? 'bg-white text-slate-900 border border-slate-200/90 shadow-indigo-500/10'
                : 'bg-[#0c1122] text-white border border-slate-800/80 shadow-slate-950/50'
            }`}
          >
            {/* Subtle glow background */}
            <div
              className={`absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 ${
                isDark ? 'bg-indigo-100/70' : 'bg-indigo-600/15'
              }`}
            />
            <div
              className={`absolute bottom-0 left-0 w-96 h-96 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 ${
                isDark ? 'bg-blue-100/60' : 'bg-blue-600/15'
              }`}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center relative z-10">
              {/* Left Column */}
              <div className="lg:col-span-7 space-y-6">
                <div
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold shadow-xs ${
                    isDark
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                      : 'bg-white/10 text-indigo-200 border border-white/10'
                  }`}
                >
                  <Lock className={`w-3.5 h-3.5 ${isDark ? 'text-indigo-600' : 'text-indigo-300'}`} />
                  <span>Enterprise Grade Protection</span>
                </div>

                <h2
                  className={`text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight ${
                    isDark ? 'text-slate-900' : 'text-white'
                  }`}
                >
                  Your conversations stay completely private.
                </h2>

                <p
                  className={`text-base sm:text-lg leading-relaxed max-w-2xl font-normal ${
                    isDark ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  Connectly is engineered with end-to-end encryption and zero-knowledge architecture.
                  Audio, video, and whiteboard packets are secure in transit and at rest.
                </p>

                <div className="space-y-4 pt-2">
                  <div className="flex items-start gap-3.5">
                    <ShieldCheck
                      className={`w-5 h-5 mt-1 flex-shrink-0 ${
                        isDark ? 'text-indigo-600' : 'text-indigo-400'
                      }`}
                    />
                    <div>
                      <h4 className={`font-bold text-base ${isDark ? 'text-slate-900' : 'text-white'}`}>
                        End-to-End Encryption
                      </h4>
                      <p className={`text-sm mt-0.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                        All WebRTC video streams and message channels use AES-256 and DTLS-SRTP security protocols.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <Shield
                      className={`w-5 h-5 mt-1 flex-shrink-0 ${
                        isDark ? 'text-indigo-600' : 'text-indigo-400'
                      }`}
                    />
                    <div>
                      <h4 className={`font-bold text-base ${isDark ? 'text-slate-900' : 'text-white'}`}>
                        Compliance & Governance
                      </h4>
                      <p className={`text-sm mt-0.5 ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
                        SOC2 Type II, HIPAA, and GDPR compliance ready with configurable data retention rules.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Cyber Padlock 3D Render with Hover Glow */}
              <div className="lg:col-span-5 flex justify-center">
                <div
                  className={`relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border transition-all duration-500 group cursor-pointer hover:scale-[1.02] ${
                    isDark
                      ? 'border-slate-200 bg-slate-950 shadow-indigo-900/10'
                      : 'border-indigo-500/25 bg-slate-950 shadow-slate-950/70'
                  }`}
                >
                  <img
                    src="/security-padlock.jpg"
                    alt="Connectly Cyber Security Padlock 3D"
                    className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer (Designed exactly to match 5th image) */}
      <footer className="pt-16 pb-12 px-4 sm:px-6 lg:px-8 border-t border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-950 select-none">
        <div className="max-w-7xl mx-auto">
          {/* Main Footer Content */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-10 lg:gap-8 pb-14 border-b border-slate-200/70 dark:border-gray-800/80">
            {/* Col 1: Brand & Bio (Spans 2 cols on large screen) */}
            <div className="col-span-2 space-y-4">
              <button
                type="button"
                onClick={scrollToTop}
                className="inline-block text-left hover:opacity-90 transition-opacity cursor-pointer focus:outline-none"
                aria-label="Back to top"
              >
                <Logo size="md" />
              </button>
              <p
                onClick={scrollToTop}
                className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs font-normal cursor-pointer hover:text-indigo-500 transition-colors"
                title="Click to go to top"
              >
                The unified collaboration platform built for precision, speed, and modern engineering workflows.
              </p>
              {/* Circular Action / Social Buttons */}
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={scrollToTop}
                  aria-label="Email"
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/70 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center transition-all hover:scale-110 cursor-pointer"
                >
                  <AtSign className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={scrollToTop}
                  aria-label="Code Repository"
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/70 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center transition-all hover:scale-110 cursor-pointer"
                >
                  <Code2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={scrollToTop}
                  aria-label="Careers & Business"
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/70 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center transition-all hover:scale-110 cursor-pointer"
                >
                  <Briefcase className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Col 2: PRODUCT */}
            <div>
              <button
                type="button"
                onClick={scrollToTop}
                className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors block text-left"
              >
                Product
              </button>
              <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-400 font-normal">
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    HD Video Calling
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Infinite Whiteboard
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Team Workspaces
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    AI Meeting Recaps
                  </button>
                </li>
              </ul>
            </div>

            {/* Col 3: RESOURCES */}
            <div>
              <button
                type="button"
                onClick={scrollToTop}
                className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors block text-left"
              >
                Resources
              </button>
              <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-400 font-normal">
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    API Documentation
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Security Whitepaper
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Help Center
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Release Notes
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    System Status
                  </button>
                </li>
              </ul>
            </div>

            {/* Col 4: COMPANY */}
            <div>
              <button
                type="button"
                onClick={scrollToTop}
                className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors block text-left"
              >
                Company
              </button>
              <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-400 font-normal">
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    About Us
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Careers
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Contact
                  </button>
                </li>
              </ul>
            </div>

            {/* Col 5: LEGAL */}
            <div>
              <button
                type="button"
                onClick={scrollToTop}
                className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors block text-left"
              >
                Legal
              </button>
              <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-400 font-normal">
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Privacy Policy
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Terms of Service
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Security Bug Bounty
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={scrollToTop}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left cursor-pointer"
                  >
                    Cookie Settings
                  </button>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <p
              onClick={scrollToTop}
              className="cursor-pointer hover:text-indigo-500 transition-colors"
            >
              © 2026 Connectly Technologies, Inc. All rights reserved.
            </p>
            <div className="flex items-center gap-2">
              <span
                onClick={scrollToTop}
                className="cursor-pointer hover:text-indigo-500 transition-colors"
              >
                Made for teams who value clarity
              </span>
              <span>•</span>
              <span
                onClick={scrollToTop}
                className="cursor-pointer hover:text-indigo-500 transition-colors"
              >
                v2.4.1
              </span>
              <span>•</span>
              <span
                onClick={scrollToTop}
                className="inline-flex items-center gap-1.5 cursor-pointer hover:text-indigo-500 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                All systems normal
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

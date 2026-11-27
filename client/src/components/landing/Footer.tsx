import React from 'react';
import { Container } from '@/components/ui/Container';
import { FOOTER_POLICY_LINKS } from './landingContent';

export interface FooterProps {
  onOpenNotice: (topic: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenNotice }) => {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#DDDAD0] dark:border-[#2B3038] bg-[#F3F2EE] dark:bg-[#141619] py-6">
      <Container size="xl">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <svg
              width="20"
              height="20"
              viewBox="0 0 28 28"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect
                x="1"
                y="1"
                width="26"
                height="26"
                rx="7"
                className="stroke-[#2F6F68] dark:stroke-[#5FA399]"
                strokeWidth="2"
              />
              <path
                d="M17.5 10.5C16.2 9.4 14.7 9 13.2 9C10.1 9 8 11.2 8 14C8 16.8 10.1 19 13.2 19C14.7 19 16.2 18.6 17.5 17.5"
                className="stroke-[#2F6F68] dark:stroke-[#5FA399]"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-display text-sm font-semibold tracking-tight text-[#1F2428] dark:text-[#EAECEE]">
              CONNECTLY
            </span>
            <span className="text-xs text-[#646D77] dark:text-[#8E96A0]">© {year}</span>
          </div>

          <nav aria-label="Legal and security notices" className="flex items-center gap-5">
            {FOOTER_POLICY_LINKS.map((item) => (
              <button
                key={item.topic}
                type="button"
                onClick={() => onOpenNotice(item.topic)}
                className="text-xs font-medium text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] rounded px-1 py-1"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </Container>
    </footer>
  );
};

export default Footer;

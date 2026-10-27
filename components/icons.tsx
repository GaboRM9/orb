const svg = (d: React.ReactNode) =>
  function Icon({ className = "h-4 w-4" }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        {d}
      </svg>
    );
  };

export const BotIcon = svg(<><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" /></>);
export const ZapIcon = svg(<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />);
export const GearIcon = svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
export const SunIcon = svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>);
export const PanelLeftIcon = svg(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>);
export const PlusIcon = svg(<path d="M12 5v14M5 12h14" />);
export const ArrowUpIcon = svg(<path d="M12 19V5M5 12l7-7 7 7" />);
export const StopIcon = svg(<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />);
export const XIcon = svg(<path d="M18 6 6 18M6 6l12 12" />);
export const MenuIcon = svg(<path d="M4 6h16M4 12h16M4 18h16" />);
export const MoonIcon = svg(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);
export const OrbIcon = svg(<><circle cx="12" cy="12" r="8.25" /><ellipse cx="12" cy="12" rx="8.25" ry="3.2" transform="rotate(-24 12 12)" strokeWidth="1" /><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" /></>);

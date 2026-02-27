'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/',         label: '홈',   icon: '🏠' },
  { href: '/history',  label: '기록', icon: '📋' },
  { href: '/calendar', label: '달력', icon: '📅' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 z-40">
      <div className="max-w-2xl mx-auto flex">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center py-4 gap-1 transition-colors ${
                isActive
                  ? 'text-blue-700 bg-blue-50'
                  : 'text-gray-500 hover:text-blue-600 hover:bg-gray-50'
              }`}
              aria-label={label}
            >
              <span className="text-2xl leading-none">{icon}</span>
              <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

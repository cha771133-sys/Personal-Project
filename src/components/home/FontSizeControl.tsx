'use client';

interface FontSizeControlProps {
  fontSize: 'small' | 'base' | 'large';
  onChange: (size: 'small' | 'base' | 'large') => void;
}

const SIZES = [
  { id: 'small', label: '가-' },
  { id: 'base',  label: '기본' },
  { id: 'large', label: '가+' },
] as const;

export default function FontSizeControl({ fontSize, onChange }: FontSizeControlProps) {
  return (
    <div
      className="flex rounded-xl p-0.5 gap-0.5"
      style={{ background: 'var(--border)' }}
      role="group"
      aria-label="글자 크기 조절"
    >
      {SIZES.map(({ id, label }) => {
        const isActive = fontSize === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className="px-3 rounded-lg text-sm font-bold transition-all"
            style={{
              minHeight: '36px',
              background: isActive ? 'var(--surface)' : 'transparent',
              color: isActive ? 'var(--primary)' : 'var(--text-sub)',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
            aria-label={`${label} 글자 크기`}
            aria-pressed={isActive}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

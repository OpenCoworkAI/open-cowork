import type { HTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

// Status pill. Semantic tone is separate from the brand accent.
export type BadgeTone = 'neutral' | 'accent' | 'mcp' | 'success' | 'warning' | 'error';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-active text-text-secondary',
  accent: 'bg-accent-muted text-accent',
  mcp: 'bg-mcp/10 text-mcp border border-mcp/15',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  error: 'bg-error/12 text-error',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTones[tone],
        className
      )}
      {...props}
    />
  );
}

// Selectable pill used for quick-action suggestions.
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: ReactNode;
}

export function Chip({ selected, icon, className, children, type = 'button', ...props }: ChipProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors duration-150 ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        selected
          ? 'border-accent/30 bg-accent-muted text-accent'
          : 'border-border-subtle bg-background/65 text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

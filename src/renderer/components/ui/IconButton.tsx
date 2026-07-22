import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

// Square/circular icon-only button. Replaces the ~dozen bespoke
// `w-9 h-9 rounded-2xl flex items-center justify-center hover:...` blocks that
// were scattered across the app with a single fixed scale.

export type IconButtonVariant = 'ghost' | 'solid' | 'accent' | 'danger';
export type IconButtonSize = 'xs' | 'sm' | 'md';

const base =
  'inline-flex items-center justify-center shrink-0 transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<IconButtonVariant, string> = {
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
  solid: 'bg-surface border border-border-subtle text-text-primary hover:bg-surface-hover',
  accent: 'bg-accent text-white hover:bg-accent-hover',
  danger: 'text-text-muted hover:text-error hover:bg-surface-active',
};

const sizes: Record<IconButtonSize, string> = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-9 h-9',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Circular instead of the default rounded-square. */
  round?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', round, className, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], round ? 'rounded-full' : 'rounded-lg', className)}
      {...props}
    />
  );
});

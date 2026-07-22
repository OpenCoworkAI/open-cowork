import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

// The single source of truth for buttons across the app.
// Every button should be one of these variants/sizes — no bespoke inline
// button styling. Shape/spacing/state come from the fixed scale below.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-medium rounded-xl whitespace-nowrap ' +
  'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-soft',
  secondary: 'bg-surface border border-border text-text-primary hover:bg-surface-hover',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover',
  danger: 'bg-error/10 text-error hover:bg-error/20',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', fullWidth, className, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...props}
    />
  );
});

import { forwardRef } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

const fieldBase =
  'w-full rounded-xl bg-surface border border-border text-text-primary ' +
  'placeholder:text-text-muted transition-colors duration-150 ' +
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon rendered inside the field on the leading edge (e.g. a search glyph). */
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leftIcon, className, ...props },
  ref
) {
  if (leftIcon) {
    return (
      <div className="relative w-full">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex items-center">
          {leftIcon}
        </span>
        <input
          ref={ref}
          className={cn(fieldBase, 'h-9 pl-9 pr-3 text-sm', className)}
          {...props}
        />
      </div>
    );
  }
  return <input ref={ref} className={cn(fieldBase, 'h-9 px-3.5 text-sm', className)} {...props} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Borderless transparent field, for use inside a composer container. */
  bare?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { bare, className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'resize-none placeholder:text-text-muted',
        bare
          ? 'w-full bg-transparent border-none outline-none text-text-primary'
          : cn(fieldBase, 'px-3.5 py-2.5 text-sm leading-relaxed'),
        className
      )}
      {...props}
    />
  );
});

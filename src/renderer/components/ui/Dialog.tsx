import { useEffect } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

// Modal primitives. Composes an overlay + centered panel with consistent
// radius/shadow/scrim. Individual dialogs supply their own body content.

export interface DialogOverlayProps {
  onClose?: () => void;
  children: ReactNode;
  /** Close when the scrim (not the panel) is clicked. Default true. */
  closeOnScrim?: boolean;
  className?: string;
}

export function DialogOverlay({
  onClose,
  children,
  closeOnScrim = true,
  className,
}: DialogOverlayProps) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={cn(
        // Plain scrim, no backdrop-blur: blur re-composites the whole viewport
        // every frame while content underneath repaints (e.g. streaming chat).
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'bg-black/45 animate-fade-in',
        className
      )}
      onClick={closeOnScrim ? onClose : undefined}
    >
      {children}
    </div>
  );
}

export interface DialogPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Constrain width. Defaults to a comfortable dialog width. */
  size?: 'sm' | 'md' | 'lg';
}

const panelSizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function DialogPanel({ size = 'md', className, children, ...props }: DialogPanelProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'w-full bg-surface rounded-2xl border border-border shadow-elevated animate-slide-up',
        'max-h-[calc(100vh-2rem)] overflow-y-auto',
        panelSizes[size],
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-[17px] font-semibold text-text-primary', className)} {...props} />
  );
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-3', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-5 pb-5 pt-3 flex items-center justify-end gap-2', className)}
      {...props}
    />
  );
}

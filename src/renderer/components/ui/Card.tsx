import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from './cn';

// Surface container. `flat` drops the shadow for nested/inline panels.
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  flat?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { flat, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-surface rounded-2xl border border-border-subtle',
        flat ? '' : 'shadow-card',
        className
      )}
      {...props}
    />
  );
});

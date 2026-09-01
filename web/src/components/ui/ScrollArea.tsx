import type { HTMLAttributes, ReactNode } from 'react';
export function ScrollArea({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`ui-scroll ${className}`} {...props}>
      {children}
    </div>
  );
}

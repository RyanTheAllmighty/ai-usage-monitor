import * as React from 'react';

import { cn } from '../../lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                'h-10 w-full rounded-lg border border-mist/12 bg-ink/35 px-3 text-sm text-mist transition outline-none placeholder:text-mist/25 focus:border-plasma/70 focus-visible:ring-2 focus-visible:ring-plasma/30',
                className,
            )}
            {...props}
        />
    ),
);
Input.displayName = 'Input';

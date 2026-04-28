import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '../../lib/utils';

export const Switch = React.forwardRef<
    React.ElementRef<typeof SwitchPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
        ref={ref}
        className={cn(
            'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-mist/15 p-1 transition-colors focus-visible:ring-2 focus-visible:ring-plasma/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-plasma',
            className,
        )}
        {...props}
    >
        <SwitchPrimitive.Thumb
            className={cn(
                'pointer-events-none block h-5 w-5 rounded-full bg-ink shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5',
            )}
        />
    </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

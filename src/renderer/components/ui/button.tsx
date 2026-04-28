import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plasma/70 disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default: 'bg-mist text-ink hover:bg-mist/90',
                secondary: 'bg-mist/8 text-mist hover:bg-mist/12',
                ghost: 'text-mist/70 hover:bg-mist/8 hover:text-mist',
                destructive: 'bg-rose-300 text-ink hover:bg-rose-200',
                icon: 'border border-mist/10 bg-mist/[0.055] text-mist/70 hover:bg-mist/[0.1] hover:text-mist',
            },
            size: {
                default: 'h-10 px-4',
                sm: 'h-9 px-3',
                icon: 'h-9 w-9 p-0',
                window: 'h-8 w-10 p-0',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button';
        return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
    },
);
Button.displayName = 'Button';

export { buttonVariants };

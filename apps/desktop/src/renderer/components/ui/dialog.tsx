import type { ComponentProps } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';

export const Dialog = Primitive.Root;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="modal-backdrop" />
      <Primitive.Content className={cn('modal', className)} {...props}>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

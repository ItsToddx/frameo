import type {ReactNode} from 'react';
import * as Primitive from '@radix-ui/react-tooltip';

export function Tooltip({label,children}:{label:string;children:ReactNode}){
  return <Primitive.Root>
    <Primitive.Trigger asChild>{children}</Primitive.Trigger>
    <Primitive.Portal><Primitive.Content className="studio-tooltip" sideOffset={6} collisionPadding={12}>
      {label}<Primitive.Arrow className="studio-tooltip-arrow"/>
    </Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
}

export const TooltipProvider=Primitive.Provider;

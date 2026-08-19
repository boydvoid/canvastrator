import * as React from 'react'
import * as Primitive from '@radix-ui/react-context-menu'
import { cn } from '@/lib/utils'

export const ContextMenu = Primitive.Root
export const ContextMenuTrigger = Primitive.Trigger
export const ContextMenuSub = Primitive.Sub
export const ContextMenuGroup = Primitive.Group

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        className={cn(
          'z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-panel/95 p-1 text-fg shadow-2xl backdrop-blur',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        className={cn(
          'z-50 min-w-40 overflow-hidden rounded-lg border border-line bg-panel/95 p-1 shadow-2xl backdrop-blur',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger
      className={cn(
        'flex cursor-default select-none items-center justify-between gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2',
        className,
      )}
      {...props}
    >
      {children}
      <span className="text-fg-subtle">›</span>
    </Primitive.SubTrigger>
  )
}

export function ContextMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn('px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-fg-subtle', className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('my-1 h-px bg-surface-2', className)} {...props} />
}

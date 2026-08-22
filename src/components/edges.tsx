import { useEffect, useState } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { useTouchLive } from '@/lib/activity'
import { useStore } from '@/lib/store'
import { PROVIDER_ACCENT } from '@/lib/types'

/* Every edge is an orthogonal step rather than a bezier. On a left-to-right
   flow a bezier between two distant ranks bows out into a long S that crosses
   every other edge on the way; a step follows the lanes the layout already
   laid out, so a busy canvas reads as wiring instead of spaghetti. */

/** Edges take the accent of whichever provider is sending along them. */
function useSourceAccent(source: string) {
  return useStore((s) => {
    const n = s.nodes.find((x) => x.id === source)
    return n && n.type === 'session' ? PROVIDER_ACCENT[n.data.provider] : 'var(--color-edge)'
  })
}

/** Persistent context edge. Animates only while context is actually moving. */
export function ContextEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  const accent = useSourceAccent(source)
  const flowing = (data as { flowing?: number } | undefined)?.flowing
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!flowing) return
    setActive(true)
    const t = setTimeout(() => setActive(false), 1600)
    return () => clearTimeout(t)
  }, [flowing])

  return (
    <BaseEdge
      id={id}
      path={path}
      className={active ? 'gt-edge-flowing' : undefined}
      style={{
        stroke: active ? accent : 'color-mix(in oklch, var(--color-edge-muted) 60%, transparent)',
        strokeWidth: active ? 1.8 : 1.2,
        transition: 'stroke 200ms ease',
      }}
    />
  )
}

/** Skill/MCP attachment — quiet, dashed, no motion. */
export function AttachEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        stroke: 'var(--color-edge)',
        strokeWidth: 1,
        strokeDasharray: '3 4',
      }}
    />
  )
}

/** Transient agent→agent call. Exists only while the call is in flight. */
export function CallEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  const accent = useSourceAccent(source)
  return (
    <BaseEdge
      id={id}
      path={path}
      className="gt-edge-calling"
      style={{ stroke: accent, strokeWidth: 2 }}
    />
  )
}

/** Folder → session. Solid and quiet: this is structural, not traffic. */
export function CwdEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  return (
    <BaseEdge id={id} path={path} style={{ stroke: 'var(--color-edge-muted)', strokeWidth: 1.6 }} />
  )
}

/** Agent ↔ file. Green when the agent wrote it, grey when it only read.
 *  Travelling dashes while the touch is still in flight. */
export function FileEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  const { write, at } = (data ?? {}) as { write?: boolean; at?: number }
  // Live while the touching agent is still in the turn that touched it: the
  // dashes travel from agent to file, so you can see what it's working on.
  const live = useTouchLive(source, at)
  const colour = write ? 'var(--color-live)' : 'var(--color-edge)'

  return (
    <BaseEdge
      id={id}
      path={path}
      className={live ? 'gt-edge-flowing' : undefined}
      style={{
        stroke: live && !write ? 'var(--color-edge-strong)' : colour,
        strokeWidth: live ? 2 : write ? 1.5 : 1,
        strokeDasharray: live || !write ? '2 3' : undefined,
        transition: 'stroke 200ms ease, stroke-width 200ms ease',
      }}
    />
  )
}

/** Parent → child lineage. Quiet and structural, like a folder's cwd edge. */
export function SpawnEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  const accent = useSourceAccent(source)
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        stroke: `color-mix(in oklch, ${accent} 45%, transparent)`,
        strokeWidth: 1.6,
      }}
    />
  )
}

/**
 * A step of a plan to the next, and the orchestrator into the first.
 *
 * Dashed, because nothing here has happened yet: every other wire on the
 * canvas records something real — a folder attached, a child spawned, a file
 * touched — and a plan is the one that is still only proposed. A step that has
 * run keeps its wire, now pointing at the agent it became.
 */
export function PlanEdge({
  id,
  source,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  })
  const provider = useSourceAccent(source)
  // The pattern's own colour where the plan declared one, so every wire of one
  // plan matches and the card, its steps and the agent below read as a single
  // object. Falls back to the source's accent for a plan with no shape.
  const pattern = (data as { pattern?: string } | undefined)?.pattern
  const accent = pattern ? `var(--color-pattern-${pattern})` : provider
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        stroke: `color-mix(in oklch, ${accent} 45%, transparent)`,
        strokeWidth: 1.6,
        strokeDasharray: '4 4',
      }}
    />
  )
}

export const edgeTypes = {
  context: ContextEdge,
  attach: AttachEdge,
  call: CallEdge,
  cwd: CwdEdge,
  spawn: SpawnEdge,
  file: FileEdge,
  mcpuse: AttachEdge,
  plan: PlanEdge,
}

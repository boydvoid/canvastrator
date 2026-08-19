import { useEffect, useState } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useTouchLive } from '@/lib/activity'
import { useStore } from '@/lib/store'
import { PROVIDER_ACCENT } from '@/lib/types'

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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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

/** Session → its own turn summary. Structural and quiet, like a cwd edge,
 *  but tinted with the provider so you can see whose turn it was. */
export function SummaryEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const accent = useSourceAccent(source)
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        stroke: `color-mix(in oklch, ${accent} 35%, transparent)`,
        strokeWidth: 1.2,
        strokeDasharray: '2 4',
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
  summary: SummaryEdge,
}

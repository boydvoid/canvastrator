import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react'
import { CanvasDialogs, CanvasMenuItems } from '@/components/CanvasBar'
import { AppBar } from '@/components/AppBar'
import { CommandPalette } from '@/components/CommandPalette'
import { LeftRail } from '@/components/LeftRail'
import { DeskBar } from '@/components/Desk'
import { routeEvent, useDesk } from '@/lib/desk'
import { SpawnRing, type SpawnKind } from '@/components/SpawnRing'
import { ZoomControls } from '@/components/ZoomControls'
import { edgeTypes } from '@/components/edges'
import { planFlow } from '@/lib/plannodes'
import { FileViewer } from '@/components/FileViewer'
import { CentralChat } from '@/components/CentralChat'
import { PanelStack } from '@/components/panels/PanelStack'
import { FileNode } from '@/components/nodes/FileNode'
import { FolderNode } from '@/components/nodes/FolderNode'
import { McpNode } from '@/components/nodes/McpNode'
import { McpToolNode } from '@/components/nodes/McpToolNode'
import { SessionNode } from '@/components/nodes/SessionNode'
import { PlanAddNode } from '@/components/nodes/PlanAddNode'
import { PlanStepNode } from '@/components/nodes/PlanStepNode'
import { ShapeNode } from '@/components/nodes/ShapeNode'
import { TerminalNode } from '@/components/nodes/TerminalNode'
import { ChangesNode } from '@/components/nodes/ChangesNode'
import { SkillNode } from '@/components/nodes/SkillNode'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  defaultCwd,
  detectProviders,
  discoverMcpServers,
  onSessionEvent,
  pickPath,
  terminalLive,
} from '@/lib/bridge'
import {
  clearCanvas,
  beginLaunchRestore,
  restoreLastCanvas,
  watchCanvas,
  watchCompletion,
  watchLayout,
} from '@/lib/canvas'
import { pipeTerminals } from '@/lib/terminals'
import { SHORTCUT_LABEL, keyToCanvasAction, keyToDensity, shouldIgnoreShortcut } from '@/lib/shortcuts'
import { CanvasStoreContext, useInViewRef, useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type Provider } from '@/lib/types'

const nodeTypes: NodeTypes = {
  session: SessionNode,
  skill: SkillNode,
  folder: FolderNode,
  file: FileNode,
  mcp: McpNode,
  mcptool: McpToolNode,
  planstep: PlanStepNode,
  planadd: PlanAddNode,
  shape: ShapeNode,
  changes: ChangesNode,
  terminal: TerminalNode,
}

/** The floating panels, as the right-click menu names them. */
const PANEL_ITEMS = [
  { key: 'pulse', label: 'Pulse' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'shared', label: 'Shared context' },
  { key: 'changes', label: 'Changes' },
  { key: 'usage', label: 'Usage' },
  { key: 'skills', label: 'Skills' },
  { key: 'personas', label: 'personas' },
] as const

function Surface() {
  // Autosave and auto-tidy belong to a canvas, not to the app: a canvas
  // running in the background is still being edited by its agents, and a
  // watcher wired to whichever canvas is on screen would have saved one of
  // them and quietly dropped the rest.
  const mine = useContext(CanvasStoreContext)
  const inView = useInViewRef()
  useEffect(() => {
    if (!mine) return
    const stopSaving = watchCanvas(mine)
    const stopTidying = watchLayout(mine)
    return () => {
      stopSaving()
      stopTidying()
    }
  }, [mine])

  const nodes = useStore((s) => s.nodes)
  const panels = useStore((s) => s.panels)
  const edges = useStore((s) => s.edges)
  const plans = useStore((s) => s.plans)
  const providers = useStore((s) => s.providers)
  const addMcp = useStore((s) => s.addMcp)
  const cwd = useStore((s) => s.cwd)

  // Read when the menu opens, never at startup. Scanning for config the
  // moment the app launches means the very first thing a user sees is a
  // permission prompt for something they never asked for.
  const [mcpAvailable, setMcpAvailable] = useState<
    Awaited<ReturnType<typeof discoverMcpServers>>
  >([])
  const loadMcp = useCallback(() => {
    void discoverMcpServers(cwd || null)
      .then(setMcpAvailable)
      .catch(() => setMcpAvailable([]))
  }, [cwd])
  const {
    onNodesChange,
    onEdgesChange,
    onConnect,
    addSession,
    addSkill,
    addFolder,
    addFile,
    addChanges,
    addTerminal,
  } =
    useStore.getState()

  const wrapper = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  // Where a keyboard-added node lands: under the cursor, the same place the
  // right-click menu drops one — or the middle of the canvas if the mouse has
  // never been over it.
  const dropScreen = useCallback(() => {
    if (pointer.current) return pointer.current
    const r = wrapper.current?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 }
  }, [])

  const [menuAt, setMenuAt] = useState({ x: 0, y: 0 })
  /** Where the spawn ring is open, in screen coordinates, or null. */
  const [ringAt, setRingAt] = useState<{ x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /**
   * Nodes pinned in place.
   *
   * Not persisted: it is a posture you take while reading a busy canvas, not a
   * property of the canvas — and a lock that survived a restart would leave
   * someone dragging a node that refuses to move for no visible reason.
   */
  const [locked, setLocked] = useState(false)

  const spawnAt = useCallback(
    (provider: Provider, screen: { x: number; y: number }) => {
      const id = addSession(provider, screenToFlowPosition(screen))
      const folders = useStore
        .getState()
        .nodes.filter((n): n is GtNode & { type: 'folder' } => n.type === 'folder')
      // With exactly one folder on the canvas the intent is unambiguous — wire
      // it up rather than making the user draw the obvious edge. It goes
      // through the same first-wins rule as a hand-drawn one, so on a brand new
      // session it lands as the working directory and can never race one.
      if (folders.length === 1) useStore.getState().attachFolder(id, folders[0].data.path)
    },
    [addSession, screenToFlowPosition],
  )

  const spawn = useCallback((provider: Provider) => spawnAt(provider, menuAt), [spawnAt, menuAt])

  // Spawning wires a child to its parent three times over — the lineage edge
  // and a context edge each way — and drawing all three means every parent is
  // tied to every child by a bundle of identical lines. The lineage edge says
  // everything the other two would; the context edges still exist, they just
  // aren't drawn on top of it. A context edge the user drew themselves has no
  // spawn edge under it, so it always shows.
  const visibleEdges = useMemo(() => {
    const pair = (a: string, b: string) => [a, b].sort().join('\u0000')
    const lineage = new Set(
      edges.filter((e) => e.type === 'spawn').map((e) => pair(e.source, e.target)),
    )
    return edges.filter((e) => e.type !== 'context' || !lineage.has(pair(e.source, e.target)))
  }, [edges])

  /**
   * What the selected node is wired to.
   *
   * On a canvas of thirty nodes the question a click is really asking is "what
   * does this one touch?", and answering it by tracing lines by eye is the
   * work the canvas is supposed to be doing. Selecting a node lights its own
   * connectors and whatever sits on the other end of them, and pushes
   * everything else back.
   */
  const focus = useMemo(() => {
    // A rubber-band selection is several nodes, and the answer for a group is
    // the union of what each of them touches.
    const picked = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    if (!picked.size) return null
    const wires = visibleEdges.filter((e) => picked.has(e.source) || picked.has(e.target))
    return {
      picked,
      nodes: new Set([...picked, ...wires.flatMap((e) => [e.source, e.target])]),
      edges: new Set(wires.map((e) => e.id)),
    }
  }, [nodes, visibleEdges])

  /**
   * The plan drawn as the flow it describes, merged in rather than stored.
   *
   * Deriving it here keeps the plans the only copy: the panel and the canvas
   * are two views of one list, and there is no second place for a step's state
   * to be wrong. It also means nothing to clean up — discarding a plan takes
   * its nodes with it.
   */
  const planned = useMemo(() => planFlow(plans, nodes), [plans, nodes])

  const shownNodes = useMemo(
    () => [
      ...(focus
        ? nodes.map((n) => ({
            ...n,
            className: focus.picked.has(n.id)
              ? undefined
              : focus.nodes.has(n.id)
                ? 'gt-linked'
                : 'gt-faded',
          }))
        : nodes),
      // Never dimmed by focus: a step waiting on approval is the thing most
      // worth seeing, and hiding it behind a selection elsewhere would be the
      // dropdown problem again in a different shape.
      //
      // Cast because a step node is deliberately not a GtNode: GtNode is the
      // set of things that live in the store and get saved, and these are
      // neither. Widening the union to admit them would make every persist and
      // layout path claim to handle a node they must never receive.
      ...(planned.nodes as unknown as GtNode[]),
    ],
    [nodes, focus, planned],
  )

  const shownEdges = useMemo(
    () => [
      ...(focus
        ? visibleEdges.map((e) => ({
            ...e,
            className: focus.edges.has(e.id) ? 'gt-wire-lit' : 'gt-wire-faded',
          }))
        : visibleEdges),
      ...planned.edges,
    ],
    [visibleEdges, focus, planned],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K first, and not gated on `shouldIgnoreShortcut`: a modified chord is
      // not something you type into a field by accident, and reaching the
      // palette from inside a composer is exactly when you want it.
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (e.key.toLowerCase() === 'l' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        useStore.getState().tidy()
        setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 60)
        return
      }

      if (shouldIgnoreShortcut(e.target)) return
      const st = useStore.getState()

      // ⌥1/2/3 pins a density. To the selection where there is one, and to
      // every agent otherwise — "show me all of these the same way" is the
      // whole reason to reach for it.
      const forced = keyToDensity(e)
      if (forced) {
        e.preventDefault()
        const picked = st.nodes.filter((n) => n.selected && n.type === 'session')
        const targets = picked.length
          ? picked
          : st.nodes.filter((n) => n.type === 'session')
        for (const n of targets) st.setDensity(n.id, forced)
        return
      }

      // ⇧⏎ steps back to the whole canvas, which at that zoom is every agent
      // at glance density — one line each.
      if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        void fitView({ duration: 400, padding: 0.15 })
        return
      }

      // A dialog, the file editor or the palette owns the keyboard while it
      // is up — a bare `s` typed into the palette must not also spawn an agent.
      if (st.canvasDialog || st.openFilePath || paletteOpen) return
      const action = keyToCanvasAction(e)
      if (!action) return
      e.preventDefault()

      const at = () => screenToFlowPosition(dropScreen())
      switch (action) {
        case 'session': {
          // No provider to pick from the keyboard, so take the first one that
          // is actually installed; the submenu stays there for the choice.
          const provider = st.providers.find((p) => p.available)?.provider
          if (provider) spawnAt(provider, dropScreen())
          break
        }
        case 'folder': {
          const pos = at()
          void pickPath(true).then((picked) => picked && st.addFolder(picked, pos))
          break
        }
        case 'file': {
          const pos = at()
          void pickPath(false).then((picked) => picked && st.addFile(picked, pos))
          break
        }
        case 'skill':
          st.addSkill(at())
          break
        case 'terminal':
          st.addTerminal(at())
          break
        // The panels are screen furniture, not nodes: the key that puts one on
        // screen takes it away again.
        case 'pulse':
        case 'decisions':
        case 'changes':
        case 'usage':
        case 'skills':
        case 'personas':
          st.togglePanel(action)
          break
        case 'tidy':
          st.tidy(true)
          break
        case 'rules':
          st.setCanvasDialog('rules')
          break
        case 'delete':
          st.nodes.filter((n) => n.selected).forEach((n) => st.removeNode(n.id))
          break
      }
    }
    // Only the canvas in view answers the keyboard — the others are mounted
    // and running, not listening. See `useInView`.
    const guarded = (e: KeyboardEvent) => {
      if (inView.current) onKey(e)
    }
    window.addEventListener('keydown', guarded)
    return () => window.removeEventListener('keydown', guarded)
  }, [dropScreen, fitView, inView, paletteOpen, screenToFlowPosition, spawnAt])


  /**
   * What each slot of the spawn ring does.
   *
   * Every one of them drops its node exactly where the ring opened, which is
   * the promise the ring makes by opening there. Folder and File ask the OS
   * for a path first and land when that returns — the position is captured
   * before the dialog, so a node still arrives where you clicked even though
   * the click was several seconds ago.
   */
  const spawnFromRing = useCallback(
    (kind: SpawnKind, screen: { x: number; y: number }) => {
      const st = useStore.getState()
      const at = screenToFlowPosition(screen)
      switch (kind) {
        case 'agent': {
          const provider = st.providers.find((p) => p.available)?.provider
          if (provider) spawnAt(provider, screen)
          break
        }
        case 'folder':
          void pickPath(true).then((picked) => picked && st.addFolder(picked, at))
          break
        case 'file':
          void pickPath(false).then((picked) => picked && st.addFile(picked, at))
          break
        case 'terminal':
          st.addTerminal(at)
          break
        case 'skill':
          st.addSkill(at)
          break
        case 'worktree':
          // Refused rather than opening a picker: a worktree is cut *from* a
          // repository, and a canvas with no folder on it has none to cut.
          if (!st.addWorktree(at)) {
            useStore.setState({
              canvasError: 'Put a folder on the canvas first — a worktree is cut from a repository.',
            })
          }
          break
        case 'mcp':
          // MCP servers have to be discovered before one can be chosen, and
          // that is a list rather than a slot — the ring hands it to the menu
          // that has room for it.
          loadMcp()
          setMenuAt(screen)
          break
        case 'changes':
          st.addChanges(at)
          break
      }
    },
    [loadMcp, screenToFlowPosition, spawnAt],
  )

  return (
    <div className="flex h-full w-full flex-col">
      <AppBar onOpenPalette={() => setPaletteOpen(true)} />

      {/* One rail, and the canvas — each its own panel, inset from the window
          and from each other, with the desk showing through between them. The
          gap is doing work: it is what separates the chrome you act *with*
          from the canvas you act *on*, which a shared edge only implied.
          The drawer the rail opens floats over the canvas rather than taking a
          column from it — see `LeftRail`. */}
      <div className="relative flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <LeftRail />

        <div
          className="gt-panel relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-canvas"
          ref={wrapper}
        >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="h-full w-full"
              onPointerMove={(e) => {
                pointer.current = { x: e.clientX, y: e.clientY }
              }}
              onContextMenu={(e) => {
              setMenuAt({ x: e.clientX, y: e.clientY })
              loadMcp()
            }}
              onDoubleClick={(e) => {
                // Only on empty canvas. A double-click on a node belongs to
                // the node — it is how an agent opens to full density — and a
                // ring opening on top of what you just opened would be two
                // answers to one gesture.
                if ((e.target as HTMLElement).closest('.react-flow__node')) return
                setRingAt({ x: e.clientX, y: e.clientY })
              }}
            >
              <ReactFlow
                nodes={shownNodes}
                edges={shownEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={(_, node) => {
                  // Moving a node by hand claims it: the layout must not
                  // yank it back where it thinks it belongs.
                  useStore.getState().claimNode(node.id)
                }}
                onNodeClick={(_, node) => {
                  // Clicking an agent points the chatbox at it. Reading the
                  // conversation is a second gesture — double-click, which
                  // opens the node itself to full density — so a single click
                  // never rearranges anything.
                  if (node.type !== 'session') return
                  useStore.getState().setChatTarget(node.id)
                }}
                nodesDraggable={!locked}
                proOptions={{ hideAttribution: true }}
                minZoom={0.2}
                maxZoom={1.6}
                // Double-click belongs to the canvas, not to the viewport: on
                // empty space it opens the spawn ring, and on a node it opens
                // that node to full density. React Flow's own zoom-on-
                // double-click would fire underneath both.
                zoomOnDoubleClick={false}
                defaultEdgeOptions={{ type: 'context' }}
                deleteKeyCode={null}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1}
                  color="var(--color-line-soft)"
                />
                <ZoomControls locked={locked} onToggleLock={() => setLocked((v) => !v)} />
              </ReactFlow>
            </div>
          </ContextMenuTrigger>

          <ContextMenuContent>
            <CanvasMenuItems />
            <ContextMenuLabel>New session</ContextMenuLabel>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                Session
                <span className="ml-auto font-mono text-[10px] text-fg-faint">
                  {SHORTCUT_LABEL.session}
                </span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {(['claude', 'codex', 'opencode'] as Provider[]).map((p) => {
                  const status = providers.find((s) => s.provider === p)
                  return (
                    <ContextMenuItem
                      key={p}
                      disabled={!status?.available}
                      onSelect={() => spawn(p)}
                      className="justify-between"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: PROVIDER_ACCENT[p] }}
                        />
                        {PROVIDER_LABEL[p]}
                      </span>
                      {!status?.available && (
                        <span className="font-mono text-[10px] text-fg-faint">not installed</span>
                      )}
                    </ContextMenuItem>
                  )
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
              onSelect={async () => {
                const pos = screenToFlowPosition(menuAt)
                const picked = await pickPath(true)
                if (picked) addFolder(picked, pos)
              }}
              className="justify-between"
            >
              Folder…
              <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.folder}</span>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={async () => {
                const pos = screenToFlowPosition(menuAt)
                const picked = await pickPath(false)
                if (picked) addFile(picked, pos)
              }}
              className="justify-between"
            >
              File…
              <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.file}</span>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => addSkill(screenToFlowPosition(menuAt))}
              className="justify-between"
            >
              Skill
              <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.skill}</span>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                const st = useStore.getState()
                if (!st.addWorktree(screenToFlowPosition(menuAt))) {
                  useStore.setState({
                    canvasError:
                      'Put a folder on the canvas first — a worktree is cut from a repository.',
                  })
                }
              }}
            >
              Worktree
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => addChanges(screenToFlowPosition(menuAt))}>
              Changes
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => addTerminal(screenToFlowPosition(menuAt))}
              className="justify-between"
            >
              Terminal
              <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.terminal}</span>
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>MCP</ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {mcpAvailable.length === 0 && (
                  <ContextMenuItem disabled>No MCP servers configured</ContextMenuItem>
                )}
                {mcpAvailable.map((m) => (
                  <ContextMenuItem
                    key={m.name}
                    onSelect={() => addMcp(m, screenToFlowPosition(menuAt))}
                    className="justify-between"
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] text-fg-faint">
                      {m.transport}
                    </span>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            {/* Not "new" anything: these show a readout about the canvas
                rather than putting something on it. */}
            {PANEL_ITEMS.map(({ key, label }) => (
              <ContextMenuItem
                key={key}
                onSelect={() => useStore.getState().togglePanel(key)}
                className="justify-between"
              >
                {panels[key].open ? `Hide ${label}` : `Show ${label}`}
                <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL[key]}</span>
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => useStore.getState().tidy(true)}
              className="justify-between"
            >
              Tidy everything
              <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.tidy}</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => clearCanvas()}>Clear canvas</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>


        <CentralChat />
        <PanelStack />

        <FileViewer />
        <CanvasDialogs />

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="font-mono text-[12px] text-fg-faint">
              double-click anywhere to put something here · ⌘K for everything else
            </p>
          </div>
        )}
        </div>
      </div>

      {ringAt && (
        <SpawnRing
          at={ringAt}
          provider={providers.find((p) => p.available)?.provider ?? null}
          onPick={(kind) => spawnFromRing(kind, ringAt)}
          onClose={() => setRingAt(null)}
        />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

export function Canvas() {
  /**
   * Launch, once.
   *
   * These used to be bound as reactive values off the store — and once the
   * store became one-per-canvas, `useStore` started answering for whichever
   * canvas was in view. Every switch handed this effect a different
   * `applyEvent`, so it tore down and ran again: the launch restore reopened
   * the last-remembered canvas and dragged the view straight back to it. You
   * clicked another canvas, saw it for a frame, and bounced. Nothing here is
   * about a particular canvas, so nothing here may depend on which one is
   * showing — the store is read at call time instead.
   */
  useEffect(() => {
    void detectProviders().then((p) => useStore.getState().setProviders(p))
    void useStore.getState().initLibrary()
    // `finally`, not `then`: a default cwd that fails to resolve used to take
    // the restore down with it — the chain died, the canvas never reopened,
    // and the next node minted a new one.
    beginLaunchRestore()
    void defaultCwd()
      .then((c) => useStore.getState().setCwd(c))
      .catch(() => {})
      .finally(() => void restoreLastCanvas())
    // Routed by session rather than handed to the canvas in view: an agent's
    // reply belongs to the canvas its node is on, and that canvas is often not
    // the one on screen. This is the line that makes leaving work running mean
    // something.
    const un = onSessionEvent((e) => routeEvent(e.sessionId, e.event))
    // One listener for every terminal on the canvas, started here so a shell
    // that outlives its view still has somewhere to put its output.
    const stopTerminals = pipeTerminals()
    // A shell the Rust side still has from before this mount — a dev reload,
    // not a restart. The node data never carries `running` across a save, so
    // without asking, a live terminal would show as closed.
    void terminalLive()
      .then((ids) => {
        const st = useStore.getState()
        for (const n of st.nodes) {
          if (n.type === 'terminal' && ids.includes(n.data.terminalId)) {
            st.patchTerminal(n.id, { running: true })
          }
        }
      })
      .catch(() => {})
    const stopChime = watchCompletion()
    return () => {
      void un.then((f) => f())
      stopTerminals()
      stopChime()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- launch, once.
  }, [])

  return <Desk />
}

/**
 * Every open canvas, side by side, with the one you are looking at in view.
 *
 * The strip slides rather than scrolls: React Flow owns the wheel inside a
 * canvas — that is its zoom — so moving between canvases is the dots or the
 * keyboard, and the transform is what makes the move read as travelling along
 * a row rather than as a screen being replaced.
 *
 * All of them stay mounted. That is the feature, not an oversight: the canvas
 * two along is running its agents, drawing its files and advancing its plans
 * while you work here, and unmounting it to save a few frames would put back
 * exactly the behaviour this replaced.
 */
function Desk() {
  const strip = useDesk((d) => d.strip)
  const at = useDesk((d) => d.at)

  return (
    <div className="relative h-full w-full overflow-hidden bg-ground">
      <div
        className="flex h-full w-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${at * 100}%)` }}
      >
        {strip.map((seat) => (
          // Each canvas is a whole workspace, its own app bar included — the
          // name, the spend and the counters on that bar are facts about one
          // canvas, and a single bar over the strip could only ever report on
          // one of them.
          <div key={seat.key} className="h-full w-full shrink-0">
            <CanvasStoreContext.Provider value={seat.store}>
              <ReactFlowProvider>
                <Surface />
              </ReactFlowProvider>
            </CanvasStoreContext.Provider>
          </div>
        ))}
      </div>
      <DeskBar />
    </div>
  )
}

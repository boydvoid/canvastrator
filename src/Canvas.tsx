import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react'
import { CanvasDialogs, CanvasMenuItems } from '@/components/CanvasBar'
import { AppBar } from '@/components/AppBar'
import { PanelDivider } from '@/components/PanelDivider'
import { Sidebar } from '@/components/Sidebar'
import { edgeTypes } from '@/components/edges'
import { FileViewer } from '@/components/FileViewer'
import { RightDock } from '@/components/RightDock'
import { FileNode } from '@/components/nodes/FileNode'
import { FolderNode } from '@/components/nodes/FolderNode'
import { McpNode } from '@/components/nodes/McpNode'
import { McpToolNode } from '@/components/nodes/McpToolNode'
import { SessionNode } from '@/components/nodes/SessionNode'
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
} from '@/lib/bridge'
import {
  newCanvas,
  restoreLastCanvas,
  watchCanvas,
  watchCompletion,
  watchLayout,
} from '@/lib/canvas'
import { togglePanels, usePanels } from '@/lib/panels'
import { SHORTCUT_LABEL, keyToCanvasAction, shouldIgnoreShortcut } from '@/lib/shortcuts'
import { useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type Provider } from '@/lib/types'

const nodeTypes: NodeTypes = {
  session: SessionNode,
  skill: SkillNode,
  folder: FolderNode,
  file: FileNode,
  mcp: McpNode,
  mcptool: McpToolNode,
}

function Surface() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
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
  const { onNodesChange, onEdgesChange, onConnect, addSession, addSkill, addFolder, addFile } =
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
  const { collapsed, widths } = usePanels()

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

  const shownNodes = useMemo(
    () =>
      focus
        ? nodes.map((n) => ({
            ...n,
            className: focus.picked.has(n.id)
              ? undefined
              : focus.nodes.has(n.id)
                ? 'gt-linked'
                : 'gt-faded',
          }))
        : nodes,
    [nodes, focus],
  )

  const shownEdges = useMemo(
    () =>
      focus
        ? visibleEdges.map((e) => ({
            ...e,
            className: focus.edges.has(e.id) ? 'gt-wire-lit' : 'gt-wire-faded',
          }))
        : visibleEdges,
    [visibleEdges, focus],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'l' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        useStore.getState().tidy()
        setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 60)
        return
      }

      if (shouldIgnoreShortcut(e.target)) return
      const st = useStore.getState()
      // A dialog or the file editor owns the keyboard while it is up.
      if (st.canvasDialog || st.openFilePath) return
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dropScreen, fitView, screenToFlowPosition, spawnAt])


  const tidyAndFit = useCallback(() => {
    useStore.getState().tidy()
    // Layout is pointless if the result is off-screen.
    setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 60)
  }, [fitView])

  return (
    <div className="flex h-full w-full flex-col">
      <AppBar collapsed={collapsed} onToggleSidebar={togglePanels} onTidy={tidyAndFit} />

      {/* Panels float: rounded, with the window's own translucency showing
          through the gaps between them. */}
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <Sidebar collapsed={collapsed} onToggle={togglePanels} width={widths.canvases} />
        {!collapsed && <PanelDivider panel="canvases" />}

        <div
          className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-canvas"
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
                  // A node is a label; everything about the agent is in the
                  // dock. So clicking one opens the dock on that conversation
                  // rather than leaving the click with nothing to show for it.
                  if (node.type !== 'session') return
                  const st = useStore.getState()
                  st.setChatTarget(node.id)
                  // setRightTab opens the dock, so a click always lands
                  // somewhere visible even with the panel put away.
                  st.setRightTab('chat')
                }}
                proOptions={{ hideAttribution: true }}
                minZoom={0.2}
                maxZoom={1.6}
                defaultEdgeOptions={{ type: 'context' }}
                deleteKeyCode={null}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1}
                  color="var(--color-line-soft)"
                />
                <Controls
                  className="!bottom-4 !left-4 [&>button]:!border-line [&>button]:!bg-panel [&>button]:!fill-fg-muted [&>button:hover]:!bg-surface-2"
                  showInteractive={false}
                />
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
            <ContextMenuItem
              onSelect={() => useStore.getState().tidy(true)}
              className="justify-between"
            >
              Tidy everything
              <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.tidy}</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => newCanvas()}>Clear canvas</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>


        <FileViewer />
        <CanvasDialogs />

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="font-mono text-[12px] text-fg-faint">
              right-click → add a folder, then a session
            </p>
          </div>
        )}
        </div>

        <RightDock />
      </div>
    </div>
  )
}

export function Canvas() {
  const setProviders = useStore((s) => s.setProviders)
  const setCwd = useStore((s) => s.setCwd)
  const applyEvent = useStore((s) => s.applyEvent)

  useEffect(() => {
    void detectProviders().then(setProviders)
    void useStore.getState().initLibrary()
    void defaultCwd().then(setCwd).then(restoreLastCanvas)
    const un = onSessionEvent((e) => applyEvent(e.sessionId, e.event))
    const stopWatching = watchCanvas()
    const stopLayout = watchLayout()
    const stopChime = watchCompletion()
    return () => {
      void un.then((f) => f())
      stopWatching()
      stopLayout()
      stopChime()
    }
  }, [setProviders, setCwd, applyEvent])

  return (
    <ReactFlowProvider>
      <Surface />
    </ReactFlowProvider>
  )
}

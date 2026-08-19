import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Sidebar } from '@/components/Sidebar'
import { edgeTypes } from '@/components/edges'
import { FileViewer } from '@/components/FileViewer'
import { RightDock } from '@/components/RightDock'
import { FileNode } from '@/components/nodes/FileNode'
import { FolderNode } from '@/components/nodes/FolderNode'
import { McpNode } from '@/components/nodes/McpNode'
import { McpToolNode } from '@/components/nodes/McpToolNode'
import { PersonalityNode } from '@/components/nodes/PersonalityNode'
import { SessionNode } from '@/components/nodes/SessionNode'
import { SkillNode } from '@/components/nodes/SkillNode'
import { SummaryNode } from '@/components/nodes/SummaryNode'
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
import { useSidebar } from '@/lib/sidebar'
import { useStore } from '@/lib/store'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type Provider } from '@/lib/types'

const nodeTypes: NodeTypes = {
  session: SessionNode,
  skill: SkillNode,
  folder: FolderNode,
  file: FileNode,
  personality: PersonalityNode,
  mcp: McpNode,
  mcptool: McpToolNode,
  summary: SummaryNode,
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
  const { onNodesChange, onEdgesChange, onConnect, addSession, addSkill, addFolder, addFile, addPersonality } =
    useStore.getState()

  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'l' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        useStore.getState().tidy()
        setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 60)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView])
  const [menuAt, setMenuAt] = useState({ x: 0, y: 0 })
  const { collapsed, toggle } = useSidebar()

  const spawnAt = useCallback(
    (provider: Provider, screen: { x: number; y: number }) => {
      const id = addSession(provider, screenToFlowPosition(screen))
      useStore.setState((s) => {
        const folders = s.nodes.filter((n) => n.type === 'folder')
        // With exactly one folder on the canvas the intent is unambiguous —
        // wire it up rather than making the user draw the obvious edge.
        return folders.length === 1
          ? { edges: [...s.edges, { id: `cwd_${id}`, source: folders[0].id, target: id, type: 'cwd' }] }
          : s
      })
    },
    [addSession, screenToFlowPosition],
  )

  const spawn = useCallback((provider: Provider) => spawnAt(provider, menuAt), [spawnAt, menuAt])


  const tidyAndFit = useCallback(() => {
    useStore.getState().tidy()
    // Layout is pointless if the result is off-screen.
    setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 60)
  }, [fitView])

  return (
    <div className="flex h-full w-full flex-col">
      <AppBar collapsed={collapsed} onToggleSidebar={toggle} onTidy={tidyAndFit} />

      {/* Panels float: rounded, with the window's own translucency showing
          through the gaps between them. */}
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <Sidebar collapsed={collapsed} onToggle={toggle} />

        <div
          className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-canvas"
          ref={wrapper}
        >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="h-full w-full"
              onContextMenu={(e) => {
              setMenuAt({ x: e.clientX, y: e.clientY })
              loadMcp()
            }}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
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
                  // Clicking a session points the dock at it. Selecting a node
                  // and then hunting for the same conversation in a dropdown
                  // is work the app can do for you.
                  if (node.type !== 'session') return
                  const st = useStore.getState()
                  st.setChatTarget(node.id)
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
              <ContextMenuSubTrigger>Session</ContextMenuSubTrigger>
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
            >
              Folder…
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={async () => {
                const pos = screenToFlowPosition(menuAt)
                const picked = await pickPath(false)
                if (picked) addFile(picked, pos)
              }}
            >
              File…
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => addSkill(screenToFlowPosition(menuAt))}>
              Skill
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => addPersonality(screenToFlowPosition(menuAt))}>
              Personality
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
            <ContextMenuItem onSelect={() => useStore.getState().tidy(true)}>
              Tidy everything
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

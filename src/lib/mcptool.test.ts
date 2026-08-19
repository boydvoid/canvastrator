import { describe, expect, it } from 'vitest'
import { parseMcpTool } from './store'

describe('parseMcpTool', () => {
  it('splits a namespaced MCP tool', () => {
    expect(parseMcpTool('mcp__flowiki__search')).toEqual({ server: 'flowiki', tool: 'search' })
  })

  /** Server names contain underscores; so do tool names. */
  it('handles underscores on both sides', () => {
    expect(parseMcpTool('mcp__flowiki__list_organizations')).toEqual({
      server: 'flowiki',
      tool: 'list_organizations',
    })
    expect(parseMcpTool('mcp__claude_ai_Linear__authenticate')).toEqual({
      server: 'claude_ai_Linear',
      tool: 'authenticate',
    })
  })

  it('ignores built-in tools', () => {
    expect(parseMcpTool('Bash')).toBeNull()
    expect(parseMcpTool('Read')).toBeNull()
    expect(parseMcpTool('ToolSearch')).toBeNull()
    expect(parseMcpTool('')).toBeNull()
  })

  it('ignores a malformed namespace', () => {
    expect(parseMcpTool('mcp__onlyserver')).toBeNull()
  })
})

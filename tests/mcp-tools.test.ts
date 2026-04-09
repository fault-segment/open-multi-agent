import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolUseContext } from '../src/types.js'

const listToolsMock = vi.fn()
const callToolMock = vi.fn()
const connectMock = vi.fn()
const clientCloseMock = vi.fn()
const transportCloseMock = vi.fn()

class MockClient {
  async connect(transport: unknown): Promise<void> {
    connectMock(transport)
  }

  async listTools(): Promise<{ tools: Array<{ name: string; description: string }> }> {
    return listToolsMock()
  }

  async callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<{
    content?: Array<{ type: string; text: string }>
    structuredContent?: unknown
    isError?: boolean
  }> {
    return callToolMock(request)
  }

  async close(): Promise<void> {
    clientCloseMock()
  }
}

class MockStdioTransport {
  readonly config: unknown

  constructor(config: unknown) {
    this.config = config
  }

  async close(): Promise<void> {
    transportCloseMock()
  }
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockStdioTransport,
}))

const context: ToolUseContext = {
  agent: { name: 'test-agent', role: 'tester', model: 'test-model' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('connectMCPTools', () => {
  it('connects, discovers tools, and executes MCP calls', async () => {
    listToolsMock.mockResolvedValue({
      tools: [{ name: 'search_issues', description: 'Search repository issues.' }],
    })
    callToolMock.mockResolvedValue({
      content: [{ type: 'text', text: 'found 2 issues' }],
      isError: false,
    })

    const { connectMCPTools } = await import('../src/tool/mcp.js')
    const connected = await connectMCPTools({
      command: 'npx',
      args: ['-y', 'mock-mcp-server'],
      env: { GITHUB_TOKEN: 'token' },
      namePrefix: 'github',
    })

    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(connected.tools).toHaveLength(1)
    expect(connected.tools[0].name).toBe('github/search_issues')

    const result = await connected.tools[0].execute({ q: 'bug' }, context)
    expect(callToolMock).toHaveBeenCalledWith({
      name: 'search_issues',
      arguments: { q: 'bug' },
    })
    expect(result.isError).toBe(false)
    expect(result.data).toContain('found 2 issues')

    await connected.disconnect()
    expect(clientCloseMock).toHaveBeenCalledTimes(1)
    expect(transportCloseMock).toHaveBeenCalledTimes(1)
  })

  it('marks tool result as error when MCP returns isError', async () => {
    listToolsMock.mockResolvedValue({
      tools: [{ name: 'danger', description: 'Dangerous op.' }],
    })
    callToolMock.mockResolvedValue({
      content: [{ type: 'text', text: 'permission denied' }],
      isError: true,
    })

    const { connectMCPTools } = await import('../src/tool/mcp.js')
    const connected = await connectMCPTools({
      command: 'npx',
      args: ['-y', 'mock-mcp-server'],
    })

    const result = await connected.tools[0].execute({}, context)
    expect(result.isError).toBe(true)
    expect(result.data).toContain('permission denied')
  })
})

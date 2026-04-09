import { z } from 'zod'
import { defineTool } from './framework.js'
import type { ToolDefinition } from '../types.js'

interface MCPToolDescriptor {
  name: string
  description?: string
}

interface MCPListToolsResponse {
  tools?: MCPToolDescriptor[]
}

interface MCPCallToolResponse {
  content?: Array<{ type?: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

interface MCPClientLike {
  connect(transport: unknown): Promise<void>
  listTools(): Promise<MCPListToolsResponse>
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<MCPCallToolResponse>
  close?: () => Promise<void>
}

type MCPClientConstructor = new (
  info: { name: string; version: string },
  options: { capabilities: Record<string, unknown> },
) => MCPClientLike

type StdioTransportConstructor = new (config: {
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
  cwd?: string
}) => { close?: () => Promise<void> }

interface MCPModules {
  Client: MCPClientConstructor
  StdioClientTransport: StdioTransportConstructor
}

async function loadMCPModules(): Promise<MCPModules> {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js') as Promise<{
      Client: MCPClientConstructor
    }>,
    import('@modelcontextprotocol/sdk/client/stdio.js') as Promise<{
      StdioClientTransport: StdioTransportConstructor
    }>,
  ])
  return { Client, StdioClientTransport }
}

export interface ConnectMCPToolsConfig {
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
  cwd?: string
  /**
   * Optional prefix used when generating framework tool names.
   * Example: "github" -> "github/search_issues"
   */
  namePrefix?: string
  /**
   * Client metadata sent to the MCP server.
   */
  clientName?: string
  clientVersion?: string
}

export interface ConnectedMCPTools {
  tools: ToolDefinition[]
  disconnect: () => Promise<void>
}

function normalizeToolName(rawName: string, namePrefix?: string): string {
  if (namePrefix === undefined || namePrefix.trim() === '') {
    return rawName
  }
  return `${namePrefix}/${rawName}`
}

function toToolResultData(result: MCPCallToolResponse): string {
  const textBlocks = (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)

  if (textBlocks.length > 0) {
    return textBlocks.join('\n')
  }

  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent, null, 2)
    } catch {
      return String(result.structuredContent)
    }
  }

  try {
    return JSON.stringify(result)
  } catch {
    return 'MCP tool completed with non-text output.'
  }
}

/**
 * Connect to an MCP server over stdio and convert exposed MCP tools into
 * open-multi-agent ToolDefinitions.
 */
export async function connectMCPTools(
  config: ConnectMCPToolsConfig,
): Promise<ConnectedMCPTools> {
  const { Client, StdioClientTransport } = await loadMCPModules()

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env,
    cwd: config.cwd,
  })

  const client = new Client(
    {
      name: config.clientName ?? 'open-multi-agent',
      version: config.clientVersion ?? '0.0.0',
    },
    { capabilities: {} },
  )

  await client.connect(transport)

  const listed = await client.listTools()
  const mcpTools = listed.tools ?? []

  const tools: ToolDefinition[] = mcpTools.map((tool) =>
    defineTool({
      name: normalizeToolName(tool.name, config.namePrefix),
      description: tool.description ?? `MCP tool: ${tool.name}`,
      // MCP servers validate arguments internally.
      inputSchema: z.any(),
      execute: async (input: Record<string, unknown>) => {
        try {
          const result = await client.callTool({
            name: tool.name,
            arguments: input,
          })
          return {
            data: toToolResultData(result),
            isError: result.isError === true,
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error)
          return {
            data: `MCP tool "${tool.name}" failed: ${message}`,
            isError: true,
          }
        }
      },
    }),
  )

  return {
    tools,
    disconnect: async () => {
      await client.close?.()
      await transport.close?.()
    },
  }
}

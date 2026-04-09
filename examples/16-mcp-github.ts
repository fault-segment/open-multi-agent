/**
 * Example 16 — MCP GitHub Tools
 *
 * Connect an MCP server over stdio and register all exposed MCP tools as
 * standard open-multi-agent tools.
 *
 * Run:
 *   npx tsx examples/16-mcp-github.ts
 *
 * Prerequisites:
 *   - ANTHROPIC_API_KEY
 *   - GITHUB_TOKEN
 *   - @modelcontextprotocol/sdk installed
 */

import { Agent, ToolExecutor, ToolRegistry, registerBuiltInTools } from '../src/index.js'
import { connectMCPTools } from '../src/mcp.js'

const { tools, disconnect } = await connectMCPTools({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    ...process.env,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  },
  namePrefix: 'github',
})

const registry = new ToolRegistry()
registerBuiltInTools(registry)
for (const tool of tools) registry.register(tool)
const executor = new ToolExecutor(registry)

const agent = new Agent(
  {
    name: 'github-agent',
    model: 'claude-sonnet-4-6',
    tools: tools.map((tool) => tool.name),
    systemPrompt: 'Use GitHub MCP tools to answer repository questions.',
  },
  registry,
  executor,
)

try {
  const result = await agent.run(
    'List the last 3 open issues in JackChen-me/open-multi-agent with title and number.',
  )

  console.log(result.output)
} finally {
  await disconnect()
}

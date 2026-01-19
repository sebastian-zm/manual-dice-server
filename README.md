# 🎲 Manual Dice Roller MCP Server

A Model Context Protocol (MCP) server that provides dice rolling functionality with both manual (GTK dialog) and automatic modes.

## Features

- **Dual modes**: Manual input via GTK dialog or automatic random rolls
- **Flexible dice specs**: Roll any die type (d6, d20, d100, etc.)
- **Multiple dice**: Roll multiple dice at once with totals
- **Clean GTK3 UI**: User-friendly dialog for manual rolls

## Installation

### Using `nix-shell` (recommended)

Add to your MCP configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or equivalent):

```json
{
  "mcpServers": {
    "dice-roller": {
      "command": "nix-shell",
      "args": [
        "--pure",
        "https://github.com/sebastian-zm/manual-dice-server.git",
        "--run",
        "dice-roller-mcp"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

### Using `uvx`

Add to your MCP configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or equivalent):

```json
{
  "mcpServers": {
    "dice-roller": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/sebastian-zm/manual-dice-server.git",
        "dice-roller-mcp"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**Note:** Requires [uv](https://github.com/astral-sh/uv) to be installed: `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Clone and install locally

```bash
git clone https://github.com/sebastian-zm/manual-dice-server.git
cd manual-dice-server
pip install -e .
```

Then configure:

```json
{
  "mcpServers": {
    "dice-roller": {
      "command": "dice-roller-mcp",
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

## Usage

Once configured, ask your MCP client (e.g., Claude) to roll dice:

- "Roll a d20"
- "Roll 3d6 for me"
- "Roll 2d8 and 1d6"
- "Roll 4d6 manually" (opens dialog for input)

## Development

```bash
git clone https://github.com/yourusername/manual-dice-server.git
cd manual-dice-server
```

## License

MIT


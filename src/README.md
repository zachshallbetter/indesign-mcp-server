# InDesign MCP Server - Modular Architecture

This directory contains the modular implementation of the InDesign MCP Server, organized for better maintainability and scalability.

## Directory Structure

```bash
src/
├── core/                    # Core server functionality
│   ├── InDesignMCPServer.js # Main server class
│   └── scriptExecutor.js    # Script execution utilities
├── handlers/                # Tool handlers organized by category
│   └── documentHandlers.js  # Document management handlers
├── types/                   # Tool definitions and schemas
│   ├── index.js             # Main tool definitions index
│   ├── toolDefinitions.js   # Basic tool definitions
│   ├── toolDefinitionsExtended.js # Extended tool definitions
│   └── toolDefinitionsAdvanced.js # Advanced tool definitions
├── utils/                   # Utility functions
│   └── stringUtils.js       # String handling utilities
└── index.js                 # Main entry point
```

## Architecture Overview

### Core Module (`core/`)

- **InDesignMCPServer.js**: Main server class that handles MCP protocol communication
- **scriptExecutor.js**: Handles AppleScript and ExtendScript execution

### Handlers Module (`handlers/`)

Organized by functionality:

- **documentHandlers.js**: Document creation, opening, saving, closing
- **pageHandlers.js**: Page management (to be implemented)
- **textHandlers.js**: Text frame operations (to be implemented)
- **graphicsHandlers.js**: Graphics and image operations (to be implemented)
- **styleHandlers.js**: Style management (to be implemented)
- **exportHandlers.js**: Export operations (to be implemented)

### Types Module (`types/`)

- **toolDefinitions.js**: Basic document and page management tools
- **toolDefinitionsExtended.js**: Text, graphics, styles, and export tools
- **toolDefinitionsAdvanced.js**: Master pages, spreads, layers, and advanced features
- **index.js**: Combines all tool definitions

### Utils Module (`utils/`)

- **stringUtils.js**: String escaping and response formatting utilities

## Benefits of Modular Structure

1. **Maintainability**: Each module has a single responsibility
2. **Scalability**: Easy to add new handlers and tool definitions
3. **Testability**: Individual modules can be tested in isolation
4. **Code Reuse**: Common utilities are shared across handlers
5. **Organization**: Clear separation of concerns

## Adding New Functionality

### 1. Add Tool Definitions

Add new tool definitions to the appropriate file in `types/`:

- Basic tools → `toolDefinitions.js`
- Extended tools → `toolDefinitionsExtended.js`
- Advanced tools → `toolDefinitionsAdvanced.js`

### 2. Create Handler

Create a new handler file in `handlers/` for the functionality:

```javascript
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse } from '../utils/stringUtils.js';

export class NewFeatureHandlers {
  static async newTool(args) {
    // Implementation
  }
}
```

### 3. Register Handler

Add the handler to the main server class in `core/InDesignMCPServer.js`:

```javascript
import { NewFeatureHandlers } from '../handlers/newFeatureHandlers.js';

// In handleToolCall method:
case 'new_tool': return await NewFeatureHandlers.newTool(args);
```

## Migration from Monolithic Structure

The original `index.js` file has been broken down into:

- Tool definitions → `types/` directory
- Handler methods → `handlers/` directory
- Utility functions → `utils/` directory
- Server setup → `core/InDesignMCPServer.js`

This modular structure makes the codebase more maintainable and easier to extend with new features.

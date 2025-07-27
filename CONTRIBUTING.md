# Contributing to InDesign MCP Server

Thank you for your interest in contributing to the InDesign MCP Server! This document provides guidelines and information for contributors.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Create** a feature branch
5. **Make** your changes
6. **Test** your changes
7. **Submit** a pull request

## 📋 Prerequisites

- **Adobe InDesign** (macOS) - Required for testing
- **Node.js 18+** - For development and testing
- **macOS** - Required for AppleScript integration
- **Git** - For version control

## 🏗️ Project Structure

```
indesign-mcp-server/
├── src/
│   ├── core/           # Core server and session management
│   ├── handlers/       # Tool handlers organized by functionality
│   ├── types/          # Tool definitions and schemas
│   └── utils/          # Utility functions
├── tests/              # Test suite and examples
├── docs/               # Documentation
└── examples/           # Usage examples
```

## 🔧 Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/your-username/indesign-mcp-server.git
cd indesign-mcp-server
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

### 3. Run Tests

```bash
npm test
```

## 📝 Code Style Guidelines

### JavaScript/Node.js
- Use **ES6+** features
- Follow **ESLint** configuration
- Use **async/await** for asynchronous operations
- Add **JSDoc** comments for public functions

### ExtendScript (InDesign)
- Use **var** for variable declarations
- Follow **InDesign ExtendScript** conventions
- Add **error handling** with try-catch blocks
- Use **descriptive variable names**

### File Naming
- **Handlers**: `camelCase.js` (e.g., `documentHandlers.js`)
- **Types**: `camelCase.js` (e.g., `toolDefinitionsDocument.js`)
- **Tests**: `test-descriptive-name.js` (e.g., `test-document-creation.js`)

## 🧪 Testing Guidelines

### Test Structure
```javascript
// Test file: test-feature-name.js
async function testFeatureName() {
    // 1. Setup
    // 2. Execute
    // 3. Verify
    // 4. Cleanup
}
```

### Test Categories
- **Unit Tests**: Individual handler functions
- **Integration Tests**: End-to-end workflows
- **Error Tests**: Error handling and edge cases
- **Performance Tests**: Scaling and performance validation

### Running Tests
```bash
# Run all tests
npm test

# Run specific test
node tests/test-specific-feature.js

# Run with debugging
node --inspect tests/test-specific-feature.js
```

## 🔨 Adding New Tools

### 1. Create Handler Method

```javascript
// src/handlers/exampleHandlers.js
export class ExampleHandlers {
    static async newTool(args) {
        // Implementation
        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "New Tool");
    }
}
```

### 2. Add Tool Definition

```javascript
// src/types/toolDefinitionsExample.js
{
    name: 'new_tool',
    description: 'Description of the new tool',
    inputSchema: {
        type: 'object',
        properties: {
            // Parameter definitions
        },
        required: ['requiredParam']
    }
}
```

### 3. Register in Server

```javascript
// src/core/InDesignMCPServer.js
case 'new_tool': return await ExampleHandlers.newTool(args);
```

### 4. Add Tests

```javascript
// tests/test-new-tool.js
// Comprehensive test coverage
```

## 📚 Documentation

### Code Documentation
- **JSDoc** comments for all public methods
- **Inline comments** for complex logic
- **README** updates for new features

### User Documentation
- **MCP_INSTRUCTIONS.md** for setup and usage
- **LLM_PROMPT.md** for AI assistant integration
- **Examples** in the examples directory

## 🐛 Bug Reports

### Before Submitting
1. **Search** existing issues
2. **Test** with latest version
3. **Reproduce** the issue consistently

### Bug Report Template
```markdown
## Bug Description
Brief description of the issue

## Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- InDesign Version: [version]
- Node.js Version: [version]
- macOS Version: [version]

## Additional Information
Screenshots, logs, etc.
```

## 💡 Feature Requests

### Before Submitting
1. **Check** existing features
2. **Search** existing requests
3. **Consider** implementation complexity

### Feature Request Template
```markdown
## Feature Description
Brief description of the feature

## Use Case
Why this feature is needed

## Proposed Implementation
How it could be implemented

## Alternatives Considered
Other approaches considered

## Additional Information
Mockups, examples, etc.
```

## 🔄 Pull Request Process

### Before Submitting
1. **Test** your changes thoroughly
2. **Update** documentation
3. **Add** tests for new features
4. **Follow** code style guidelines

### PR Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Test addition

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Documentation
- [ ] Code comments added
- [ ] README updated
- [ ] Examples updated

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] No console.log statements left
- [ ] Error handling implemented
```

## 🏷️ Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🤝 Community

### Getting Help
- **Issues**: Use GitHub issues for bugs and feature requests
- **Discussions**: Use GitHub discussions for questions and ideas
- **Documentation**: Check the README and documentation files

### Code of Conduct
- **Be respectful** and inclusive
- **Help others** learn and grow
- **Focus on** constructive feedback
- **Follow** the project's coding standards

## 🎯 Contribution Areas

### High Priority
- **Bug fixes** and error handling improvements
- **Documentation** updates and clarifications
- **Test coverage** improvements
- **Performance** optimizations

### Medium Priority
- **New tools** for InDesign automation
- **Enhanced** error messages and debugging
- **Additional** export formats
- **Integration** with other Adobe products

### Low Priority
- **UI improvements** for development tools
- **Advanced** features and workflows
- **Third-party** integrations
- **Performance** monitoring tools

## 📞 Contact

For questions about contributing:
- **GitHub Issues**: For specific problems
- **GitHub Discussions**: For general questions
- **Email**: [your-email@example.com]

Thank you for contributing to the InDesign MCP Server! 🚀 
# AI Chat Agent - File Management Tools Specification

## Overview
This specification defines the file management tools for an AI chat agent that can read, list, edit, create, and delete files in the workspace via a chat interface.

## API Endpoint
- **Endpoint**: `POST https://the3rdacademy.com/api/chat/completions`
- **Streaming**: Supported via SSE

## Tool Definitions

### 1. read_file
Read the contents of a file from the workspace.
```json
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "Read the contents of a file from the workspace. Returns the file content as a string.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The file path to read (relative to workspace root)"
        }
      },
      "required": ["path"]
    }
  }
}
```

### 2. list_files
List files and directories in a given path.
```json
{
  "type": "function",
  "function": {
    "name": "list_files",
    "description": "List all files and directories at a given path. Returns file names, types, sizes, and modification dates.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The directory path to list (relative to workspace root). Use empty string or '/' for root."
        }
      },
      "required": ["path"]
    }
  }
}
```

### 3. edit_file
Edit an existing file with search/replace or full content replacement.
```json
{
  "type": "function",
  "function": {
    "name": "edit_file",
    "description": "Edit an existing file. Supports search/replace for partial edits or full content replacement.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The file path to edit (relative to workspace root)"
        },
        "search": {
          "type": "string",
          "description": "The exact string to search for in the file (for partial edit)"
        },
        "replace": {
          "type": "string",
          "description": "The new string to replace the search string with"
        },
        "newContent": {
          "type": "string",
          "description": "Full new content for the file (replaces entire file when provided)"
        }
      },
      "required": ["path"]
    }
  }
}
```

### 4. create_file
Create a new file in the workspace.
```json
{
  "type": "function",
  "function": {
    "name": "create_file",
    "description": "Create a new file in the workspace with the specified content.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The file path to create (relative to workspace root)"
        },
        "content": {
          "type": "string",
          "description": "The initial content for the new file"
        }
      },
      "required": ["path"]
    }
  }
}
```

### 5. delete_file
Delete a file or directory from the workspace.
```json
{
  "type": "function",
  "function": {
    "name": "delete_file",
    "description": "Delete a file or empty directory from the workspace.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The file or directory path to delete (relative to workspace root)"
        }
      },
      "required": ["path"]
    }
  }
}
```

### 6. create_directory
Create a new directory in the workspace.
```json
{
  "type": "function",
  "function": {
    "name": "create_directory",
    "description": "Create a new directory in the workspace.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The directory path to create (relative to workspace root)"
        }
      },
      "required": ["path"]
    }
  }
}
```

### 7. search_files
Search for files matching a pattern or search file contents for a string.
```json
{
  "type": "function",
  "function": {
    "name": "search_files",
    "description": "Search for files by name pattern or search file contents for a specific string.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The search query (file name pattern or content string to find)"
        },
        "path": {
          "type": "string",
          "description": "The directory path to search within (defaults to workspace root)"
        },
        "searchContents": {
          "type": "boolean",
          "description": "If true, search within file contents. If false, search by file name."
        }
      },
      "required": ["query"]
    }
  }
}
```

### 8. get_file_info
Get detailed metadata about a file or directory.
```json
{
  "type": "function",
  "function": {
    "name": "get_file_info",
    "description": "Get detailed information about a file or directory including size, type, and modification date.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "The file or directory path to get info for (relative to workspace root)"
        }
      },
      "required": ["path"]
    }
  }
}
```

## UI Components

### Tool Call Indicator
- Shows when AI is executing a tool
- Displays tool name, parameters, and status
- Animated spinner during execution
- Success/error state indicators

### File Operation Chips
- Inline chips attached to chat messages
- Shows file operations: read, created, edited, deleted
- Clickable to navigate to file in editor
- Color-coded by operation type

### File Tree Sidebar
- Hierarchical file browser
- Icons for different file types
- Context menu for file operations
- Drag and drop support

### Tool Execution Panel
- Log of all tool executions
- Expandable to show full request/response
- Copy, re-execute options
- Error details with stack traces

## Implementation Notes

1. **Streaming Support**: Tools emit status events during streaming to show progress
2. **Error Handling**: All tools return detailed error messages on failure
3. **Path Validation**: Tools validate paths to prevent directory traversal
4. **Type Detection**: File types auto-detected from extensions
5. **Safety Confirmations**: Delete operations require explicit confirmation

## Response Formats

### Success Response
```json
{
  "success": true,
  "data": { /* tool-specific response data */ },
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "The file at path 'example.txt' does not exist",
    "details": {}
  }
}
```

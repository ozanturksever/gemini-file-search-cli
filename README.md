# gemini-file-search-cli

A CLI tool for managing Google Gemini File Search stores. Upload files, query with RAG (Retrieval Augmented Generation), and manage document metadata.

## Features

- **Store Management**: Create, list, and delete File Search stores
- **File Upload**: Upload files and directories with automatic MIME type detection
- **Email Thread Support**: Mbox files are uploaded as single email threads with aggregated metadata
- **Glob Patterns**: Upload specific files from directories using glob patterns
- **Custom Metadata**: Add custom metadata via CLI flags or external hook scripts
- **RAG Queries**: Query your documents using natural language with Gemini models
- **Metadata Filtering**: Filter queries by custom metadata (year, author, etc.)
- **JSON Output**: All commands support `--json` flag for machine-readable output

## Installation

### From npm

```bash
bun install -g gemini-file-search-cli
# or
npm install -g gemini-file-search-cli
```

### From source

```bash
git clone https://github.com/ozanturksever/gemini-file-search-cli.git
cd gemini-file-search-cli
bun install
bun link
```

## Requirements

- [Bun](https://bun.sh) runtime (v1.0.0+)
- Google Gemini API key

## Setup

Set your Gemini API key as an environment variable:

```bash
export GEMINI_API_KEY=your_api_key_here
```

You can get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Your Google Gemini API key (required) |
| `GET_CUSTOM_METADATA` | Path to script that outputs `key=value` metadata for uploads |

## Usage

### Store Management

```bash
# List all stores
gemini-file-search stores list

# List stores as JSON
gemini-file-search stores list --json

# Create a new store
gemini-file-search stores create my-docs

# Delete a store
gemini-file-search stores delete my-docs
```

### Uploading Files

```bash
# Upload a single file
gemini-file-search upload ./document.pdf --store my-docs

# Upload a directory (recursive)
gemini-file-search upload ./docs --store my-docs

# Upload with glob pattern
gemini-file-search upload ./src --store my-code --glob "**/*.ts"

# Upload with custom metadata
gemini-file-search upload ./doc.pdf --store my-docs --meta author=John --meta year=2024

# Upload mbox email archive (as a single email thread)
gemini-file-search upload ./thread.mbox --store my-emails
```

### Custom Metadata Hook

Set `GET_CUSTOM_METADATA` to a script path. The script receives environment variables and should output `key=value` lines:

```bash
# Example hook script
#!/bin/bash
echo "file_size=$(wc -c < "$FILE_PATH")"
echo "processed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Environment variables available to hook:
# FILE_PATH     - Absolute path to the file
# FILE_NAME     - Basename of the file
# FILE_DIR      - Directory containing the file
# FILE_MIME_TYPE - MIME type of the file
```

Usage:
```bash
export GET_CUSTOM_METADATA=/path/to/metadata-hook.sh
gemini-file-search upload ./docs --store my-docs
```

### Managing Files

```bash
# List files in a store
gemini-file-search files list my-docs

# List files as JSON
gemini-file-search files list my-docs --json

# Get a specific file by name
gemini-file-search files get my-docs "report.pdf"

# Get file as JSON
gemini-file-search files get my-docs "report.pdf" --json

# Delete files by metadata filter
gemini-file-search files delete my-docs --filter source_filename=old.pdf
```

### Querying

```bash
# Basic query
gemini-file-search query my-docs "What are the main topics discussed?"

# Query with specific model
gemini-file-search query my-docs "Summarize the key points" --model gemini-2.5-pro

# Query with metadata filter
gemini-file-search query my-emails "emails about meetings" --filter year=2024

# Query with JSON output
gemini-file-search query my-docs "Summarize" --json
```

## Supported File Types

The tool supports a wide range of file types including:

- Documents: PDF, Word, Excel, PowerPoint
- Code: TypeScript, JavaScript, Python, Java, and many more
- Text: Markdown, plain text, HTML, XML, JSON
- Email: mbox archives (processed as email threads)

See the [Gemini File Search documentation](https://ai.google.dev/gemini-api/docs/file-search) for the full list.

## Metadata

When uploading files, the tool automatically adds metadata:

- `directory`: The source directory path

For mbox email threads, additional metadata is extracted:

- `email_thread`: Always "true" for mbox files
- `email_count`: Number of emails in the thread
- `from_emails`: All sender email addresses
- `to_emails`: All recipient email addresses
- `participants`: All email participants (from, to, cc, bcc)
- `subjects`: Email subjects in the thread
- `year`: Year of the earliest email
- `month`: Month of the earliest email
- `start_date`: ISO date of the first email
- `end_date`: ISO date of the last email

## Models

Supported models for querying:

- `gemini-3-pro-preview` (default)
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`
- `gemini-2.5-pro`

## License

MIT

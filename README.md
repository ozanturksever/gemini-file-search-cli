# gemini-file-search-cli

A CLI tool for managing Google Gemini File Search stores. Upload files, query with RAG (Retrieval Augmented Generation), and manage document metadata.

## Features

- **Store Management**: Create, list, and delete File Search stores
- **File Upload**: Upload files and directories with automatic MIME type detection
- **Mbox Support**: Special handling for mbox email archives with metadata extraction
- **Glob Patterns**: Upload specific files from directories using glob patterns
- **RAG Queries**: Query your documents using natural language with Gemini models
- **Metadata Filtering**: Filter queries by custom metadata (year, author, etc.)

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

## Usage

### Store Management

```bash
# List all stores
gemini-file-search stores list

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

# Upload mbox email archive (extracts individual emails)
gemini-file-search upload ./archive.mbox --store my-emails
```

### Managing Files

```bash
# List files in a store
gemini-file-search files list my-docs

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
```

## Supported File Types

The tool supports a wide range of file types including:

- Documents: PDF, Word, Excel, PowerPoint
- Code: TypeScript, JavaScript, Python, Java, and many more
- Text: Markdown, plain text, HTML, XML, JSON
- Email: mbox archives (with special processing)

See the [Gemini File Search documentation](https://ai.google.dev/gemini-api/docs/file-search) for the full list.

## Metadata

When uploading files, the tool automatically adds metadata:

- `directory`: The source directory path

For mbox files, additional metadata is extracted:

- `from_email`: Sender email address
- `to_email`: Recipient email addresses
- `participants`: All email participants (to, cc, bcc)
- `year`: Year the email was sent
- `month`: Month the email was sent
- `source_filename`: Original mbox filename

## Models

Supported models for querying:

- `gemini-3-pro-preview` (default)
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`
- `gemini-2.5-pro`

## License

MIT

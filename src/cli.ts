#!/usr/bin/env bun
import { GoogleGenAI } from '@google/genai';
import { readdir, stat, readFile } from 'fs/promises';
import { resolve, join, basename, dirname } from 'path';
import PostalMime from 'postal-mime';

// --- Configuration ---
const POLL_INTERVAL_MS = 2000;

// --- Helper Functions ---

function getApiKey(): string {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable is not set.');
        console.error('Please set it with: export GEMINI_API_KEY=your_api_key');
        process.exit(1);
    }
    return apiKey;
}

async function waitForOperation(ai: GoogleGenAI, operation: any): Promise<void> {
    process.stdout.write('Processing');
    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        operation = await ai.operations.get({ operation });
        process.stdout.write('.');
    }
    console.log(' done!');
}

async function findStoreByDisplayName(ai: GoogleGenAI, displayName: string): Promise<string | null> {
    const stores = await ai.fileSearchStores.list();
    for await (const store of stores) {
        if (store.displayName === displayName) {
            return store.name!;
        }
    }
    return null;
}

// --- Store Management ---

async function listStores(ai: GoogleGenAI, jsonOutput: boolean = false): Promise<void> {
    const stores = await ai.fileSearchStores.list();
    const storeList: any[] = [];
    
    for await (const store of stores) {
        storeList.push({
            displayName: store.displayName || null,
            name: store.name,
            createTime: store.createTime
        });
    }

    if (jsonOutput) {
        console.log(JSON.stringify(storeList, null, 2));
    } else {
        console.log('\nListing all File Search Stores:\n');
        let count = 0;
        for (const store of storeList) {
            count++;
            console.log(`  ${count}. ${store.displayName || '(no name)'}`);
            console.log(`     Name: ${store.name}`);
            console.log(`     Created: ${store.createTime}`);
            console.log('');
        }
        if (count === 0) console.log('  No stores found.');
        else console.log(`Total: ${count} store(s)`);
    }
}

async function createStore(ai: GoogleGenAI, displayName: string): Promise<void> {
    console.log(`Creating new File Search Store: ${displayName}...`);
    const store = await ai.fileSearchStores.create({
        config: { displayName }
    });
    console.log(`Created store: ${store.name}`);
}

async function deleteStore(ai: GoogleGenAI, nameOrDisplay: string): Promise<void> {
    let storeName = nameOrDisplay;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            console.error(`Error: Store with display name "${storeName}" not found.`);
            return;
        }
        storeName = found;
    }

    console.log(`Deleting store: ${storeName}...`);
    await ai.fileSearchStores.delete({
        name: storeName,
        config: { force: true }
    });
    console.log('Store deleted successfully.');
}

// --- File Management ---

async function deleteFiles(ai: GoogleGenAI, storeName: string, filter: string): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            console.error(`Error: Store with display name "${storeName}" not found.`);
            return;
        }
        fullStoreName = found;
    }

    console.log(`Deleting files from ${fullStoreName} with filter: ${filter}...`);

    const [filterKey, filterValue] = filter.split('=');
    if (!filterKey || !filterValue) {
        console.error('Error: Filter must be in format key=value');
        return;
    }

    let deletedCount = 0;

    const response = await ai.fileSearchStores.documents.list({
        parent: fullStoreName,
        config: { pageSize: 20 }
    });

    for await (const doc of response) {
        const d = doc as any;
        if (d.customMetadata) {
            const match = d.customMetadata.find((m: any) => m.key === filterKey && m.stringValue === filterValue);
            if (match && d.name) {
                console.log(`Deleting document ${d.name}...`);
                await ai.fileSearchStores.documents.delete({
                    name: d.name,
                    config: { force: true }
                } as any);
                deletedCount++;
            }
        }
    }

    console.log(`Deleted ${deletedCount} documents.`);
}

// --- Upload Logic ---

function parseMetadataValue(key: string, value: string): any {
    // Try to parse as number
    if (!isNaN(Number(value)) && !isNaN(parseFloat(value))) {
        return { key, numericValue: parseFloat(value) };
    }
    // Otherwise treat as string
    return { key, stringValue: value };
}

async function getCustomMetadataFromHook(filePath: string, mimeType: string): Promise<Map<string, string>> {
    const hookScript = process.env.GET_CUSTOM_METADATA;
    const result = new Map<string, string>();
    
    if (!hookScript) {
        return result;
    }

    try {
        const absolutePath = resolve(filePath);
        const proc = Bun.spawn([hookScript], {
            env: {
                ...process.env,
                FILE_PATH: absolutePath,
                FILE_NAME: basename(filePath),
                FILE_DIR: dirname(absolutePath),
                FILE_MIME_TYPE: mimeType
            },
            stdout: 'pipe',
            stderr: 'pipe'
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            console.error(`Warning: Metadata hook script failed with exit code ${exitCode}`);
            if (stderr) console.error(`  stderr: ${stderr.trim()}`);
            return result;
        }

        // Parse key=value lines from stdout
        const lines = stdout.split('\n').filter(line => line.trim());
        for (const line of lines) {
            const eqIndex = line.indexOf('=');
            if (eqIndex > 0) {
                const key = line.substring(0, eqIndex).trim();
                const value = line.substring(eqIndex + 1).trim();
                if (key && value) {
                    result.set(key, value);
                }
            }
        }

        if (result.size > 0) {
            console.log(`  Hook metadata: ${result.size} key(s) from script`);
        }
    } catch (e: any) {
        console.error(`Warning: Failed to run metadata hook script: ${e.message}`);
    }

    return result;
}

async function processMbox(ai: GoogleGenAI, filePath: string, storeName: string, customMeta: Map<string, string>): Promise<void> {
    console.log(`Processing mbox file as email thread: ${filePath}`);
    const fileContent = await readFile(filePath, 'utf-8');
    const directory = dirname(resolve(filePath));
    const originalFilename = basename(filePath);

    // Parse all emails in the mbox to collect metadata
    const emailParts = fileContent.split(/^From /m).filter(e => e.trim().length > 0);
    console.log(`Found ${emailParts.length} emails in thread.`);

    const allFromEmails = new Set<string>();
    const allToEmails = new Set<string>();
    const allParticipants = new Set<string>();
    const allSubjects = new Set<string>();
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const emailPart of emailParts) {
        const rawEmail = 'From ' + emailPart;
        const parser = new PostalMime();
        const email = await parser.parse(rawEmail);

        // Collect from addresses
        if (email.from?.address) {
            allFromEmails.add(email.from.address);
            allParticipants.add(email.from.address);
        }

        // Collect to addresses
        email.to?.forEach(t => {
            if (t.address) {
                allToEmails.add(t.address);
                allParticipants.add(t.address);
            }
        });

        // Collect cc addresses
        email.cc?.forEach(c => {
            if (c.address) allParticipants.add(c.address);
        });

        // Collect bcc addresses
        email.bcc?.forEach(b => {
            if (b.address) allParticipants.add(b.address);
        });

        // Collect subjects
        if (email.subject) {
            allSubjects.add(email.subject);
        }

        // Track date range
        if (email.date) {
            const date = new Date(email.date);
            if (!minDate || date < minDate) minDate = date;
            if (!maxDate || date > maxDate) maxDate = date;
        }
    }

    // Build metadata
    const metadata: any[] = [
        { key: 'email_thread', stringValue: 'true' },
        { key: 'email_count', numericValue: emailParts.length },
        { key: 'directory', stringValue: directory }
    ];

    if (allFromEmails.size > 0) {
        metadata.push({ key: 'from_emails', stringListValue: { values: Array.from(allFromEmails) } });
    }

    if (allToEmails.size > 0) {
        metadata.push({ key: 'to_emails', stringListValue: { values: Array.from(allToEmails) } });
    }

    if (allParticipants.size > 0) {
        metadata.push({ key: 'participants', stringListValue: { values: Array.from(allParticipants) } });
    }

    if (allSubjects.size > 0) {
        metadata.push({ key: 'subjects', stringListValue: { values: Array.from(allSubjects) } });
    }

    if (minDate) {
        metadata.push({ key: 'year', numericValue: minDate.getFullYear() });
        metadata.push({ key: 'month', numericValue: minDate.getMonth() + 1 });
        metadata.push({ key: 'start_date', stringValue: minDate.toISOString() });
    }

    if (maxDate) {
        metadata.push({ key: 'end_date', stringValue: maxDate.toISOString() });
    }

    // Add custom metadata
    for (const [key, value] of customMeta) {
        metadata.push(parseMetadataValue(key, value));
    }

    console.log(`Uploading thread: ${originalFilename}`);
    console.log(`  Emails: ${emailParts.length}`);
    console.log(`  Participants: ${allParticipants.size}`);

    const operation = await ai.fileSearchStores.uploadToFileSearchStore({
        file: filePath,
        fileSearchStoreName: storeName,
        config: {
            displayName: originalFilename,
            mimeType: 'text/plain',
            customMetadata: metadata
        }
    });

    await waitForOperation(ai, operation);
}

async function uploadCommand(ai: GoogleGenAI, path: string, storeName: string, globPattern?: string, customMeta?: Map<string, string>): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await createOrGetStore(ai, storeName);
        fullStoreName = found;
    }

    const meta = customMeta || new Map<string, string>();

    const stats = await stat(path);
    if (stats.isDirectory()) {
        if (globPattern) {
            console.log(`Scanning directory ${path} with glob: ${globPattern}`);
            const glob = new Bun.Glob(globPattern);
            for await (const relativePath of glob.scan({ cwd: path, onlyFiles: true })) {
                const fullPath = join(path, relativePath);
                await uploadCommand(ai, fullPath, fullStoreName, undefined, meta);
            }
        } else {
            const entries = await readdir(path, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(path, entry.name);
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                await uploadCommand(ai, fullPath, fullStoreName, undefined, meta);
            }
        }
    } else if (stats.isFile()) {
        const rawMimeType = Bun.file(path).type;
        const mimeType = rawMimeType ? rawMimeType.split(';')[0].trim() : 'text/plain';

        console.log(`File: ${path}, Type: ${rawMimeType} -> ${mimeType}`);

        // Get hook metadata for all files
        const hookMeta = await getCustomMetadataFromHook(path, mimeType);
        
        if (path.endsWith('.mbox')) {
            // Merge hook metadata with custom meta
            const combinedMeta = new Map([...meta, ...hookMeta]);
            await processMbox(ai, path, fullStoreName, combinedMeta);
        } else {
            console.log(`Uploading generic file: ${path}`);
            const directory = dirname(resolve(path));

            const baseMetadata: any[] = [
                { key: 'directory', stringValue: directory }
            ];

            // Add custom metadata from --meta flags
            for (const [key, value] of meta) {
                baseMetadata.push(parseMetadataValue(key, value));
            }

            // Add hook metadata
            for (const [key, value] of hookMeta) {
                baseMetadata.push(parseMetadataValue(key, value));
            }

            const operation = await ai.fileSearchStores.uploadToFileSearchStore({
                file: path,
                fileSearchStoreName: fullStoreName,
                config: {
                    displayName: basename(path),
                    mimeType: mimeType,
                    customMetadata: baseMetadata
                }
            });
            await waitForOperation(ai, operation);
        }
    }
}

async function createOrGetStore(ai: GoogleGenAI, storeName: string): Promise<string> {
    const found = await findStoreByDisplayName(ai, storeName);
    if (found) return found;

    console.log(`Creating new store: ${storeName}`);
    const store = await ai.fileSearchStores.create({
        config: { displayName: storeName }
    });
    return store.name!;
}

// --- Query Logic ---

async function queryStore(ai: GoogleGenAI, storeName: string, queryText: string, modelName: string = 'gemini-3-pro-preview', filter?: string, jsonOutput: boolean = false): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            console.error(`Error: Store with display name "${storeName}" not found.`);
            return;
        }
        fullStoreName = found;
    }

    if (!jsonOutput) {
        console.log(`Querying store: ${fullStoreName}`);
        console.log(`Query: ${queryText}`);
        console.log(`Model: ${modelName}`);
        if (filter) {
            console.log(`Filter: ${filter}`);
        }
    }

    const fileSearchConfig: any = {
        fileSearchStoreNames: [fullStoreName]
    };

    if (filter) {
        const isSimple = filter.includes('=') &&
            !filter.includes('<') &&
            !filter.includes('>') &&
            !filter.includes(' AND ') &&
            !filter.includes(' OR ') &&
            !filter.includes('ANY(') &&
            !filter.includes('IN(');

        if (isSimple) {
            const [key, value] = filter.split('=');
            if (key && value) {
                const isNumeric = !isNaN(Number(value)) && !isNaN(parseFloat(value));
                const trimmedValue = value.trim();
                if (isNumeric) {
                    fileSearchConfig.metadataFilter = `${key.trim()} = ${trimmedValue}`;
                } else if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
                    fileSearchConfig.metadataFilter = `${key.trim()} = ${trimmedValue}`;
                } else {
                    fileSearchConfig.metadataFilter = `${key.trim()} = "${trimmedValue}"`;
                }
            } else {
                fileSearchConfig.metadataFilter = filter;
            }
        } else {
            fileSearchConfig.metadataFilter = filter;
        }
    }

    const config = {
        tools: [
            {
                fileSearch: fileSearchConfig
            }
        ]
    };
    if (!jsonOutput) {
        console.log('Config:', JSON.stringify(config, null, 2));
        console.log('---');
    }

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: queryText,
            config: config
        });

        if (jsonOutput) {
            console.log(JSON.stringify({
                query: queryText,
                model: modelName,
                filter: filter || null,
                response: response.text
            }, null, 2));
        } else {
            console.log('Response:');
            console.log(response.text);
        }

    } catch (error: any) {
        if (jsonOutput) {
            console.log(JSON.stringify({ error: error.message }));
        } else {
            console.error('Error querying store:', error.message);
        }
    }
}

// --- Get File ---

async function getFile(ai: GoogleGenAI, storeName: string, filename: string, jsonOutput: boolean = false): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            console.error(`Error: Store with display name "${storeName}" not found.`);
            return;
        }
        fullStoreName = found;
    }

    if (!jsonOutput) {
        console.log(`Looking up file: ${filename} in ${fullStoreName}...`);
    }

    try {
        const response = await ai.fileSearchStores.documents.list({
            parent: fullStoreName,
            config: { pageSize: 20 }
        });

        const matchingDocs: any[] = [];

        for await (const doc of response) {
            const d = doc as any;
            if (d.displayName === filename) {
                matchingDocs.push(d);
            }
        }

        if (matchingDocs.length === 0) {
            if (jsonOutput) {
                console.log(JSON.stringify({ error: `No file found with name "${filename}"` }));
            } else {
                console.error(`Error: No file found with name "${filename}"`);
            }
            process.exit(1);
        }

        if (matchingDocs.length === 1) {
            printDocumentDetails(matchingDocs[0], jsonOutput);
            return;
        }

        // Multiple matches - try to disambiguate using directory
        const dirPart = dirname(filename);
        if (dirPart && dirPart !== '.') {
            const dirMatches = matchingDocs.filter(d => {
                const dirMeta = d.customMetadata?.find((m: any) => m.key === 'directory');
                return dirMeta?.stringValue?.includes(dirPart);
            });

            if (dirMatches.length === 1) {
                printDocumentDetails(dirMatches[0], jsonOutput);
                return;
            }

            if (dirMatches.length > 1) {
                const matches = dirMatches.map(d => ({
                    displayName: d.displayName,
                    directory: d.customMetadata?.find((m: any) => m.key === 'directory')?.stringValue || 'unknown'
                }));
                if (jsonOutput) {
                    console.log(JSON.stringify({ error: 'Multiple files found', matches }));
                } else {
                    console.error(`Error: Multiple files found matching "${filename}":`);
                    for (const m of matches) {
                        console.error(`  - ${m.displayName} (directory: ${m.directory})`);
                    }
                }
                process.exit(1);
            }
        }

        // Still multiple matches without directory disambiguation
        const matches = matchingDocs.map(d => ({
            displayName: d.displayName,
            directory: d.customMetadata?.find((m: any) => m.key === 'directory')?.stringValue || 'unknown'
        }));
        if (jsonOutput) {
            console.log(JSON.stringify({ error: 'Multiple files found', matches, tip: 'Include a directory path to disambiguate' }));
        } else {
            console.error(`Error: Multiple files found with name "${filename}":`);
            for (const m of matches) {
                console.error(`  - ${m.displayName} (directory: ${m.directory})`);
            }
            console.error('\nTip: Include a directory path to disambiguate, e.g., "path/to/file.txt"');
        }
        process.exit(1);

    } catch (e: any) {
        if (jsonOutput) {
            console.log(JSON.stringify({ error: e.message }));
        } else {
            console.error('Error getting file:', e.message);
        }
        process.exit(1);
    }
}

function printDocumentDetails(doc: any, jsonOutput: boolean = false): void {
    if (jsonOutput) {
        console.log(JSON.stringify({
            displayName: doc.displayName || null,
            name: doc.name,
            metadata: doc.customMetadata ? formatMetadataForJson(doc.customMetadata) : {}
        }, null, 2));
    } else {
        console.log(`\nDocument: ${doc.displayName || '(no name)'}`);
        console.log(`  Name: ${doc.name}`);
        if (doc.customMetadata && doc.customMetadata.length > 0) {
            console.log('  Metadata:');
            for (const m of doc.customMetadata) {
                const value = m.stringValue ?? m.numericValue ?? (m.stringListValue ? JSON.stringify(m.stringListValue.values) : 'undefined');
                console.log(`    ${m.key}: ${value}`);
            }
        }
    }
}

// --- List Files ---

function formatMetadataForJson(customMetadata: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const m of customMetadata) {
        result[m.key] = m.stringValue ?? m.numericValue ?? (m.stringListValue?.values ?? null);
    }
    return result;
}

async function listFiles(ai: GoogleGenAI, storeName: string, jsonOutput: boolean = false): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            if (jsonOutput) {
                console.log(JSON.stringify({ error: `Store with display name "${storeName}" not found.` }));
            } else {
                console.error(`Error: Store with display name "${storeName}" not found.`);
            }
            return;
        }
        fullStoreName = found;
    }

    if (!jsonOutput) {
        console.log(`Listing documents in ${fullStoreName}...`);
    }

    try {
        const response = await ai.fileSearchStores.documents.list({
            parent: fullStoreName,
            config: { pageSize: 20 }
        });

        const documents: any[] = [];
        for await (const doc of response) {
            const d = doc as any;
            documents.push({
                displayName: d.displayName || null,
                name: d.name,
                metadata: d.customMetadata ? formatMetadataForJson(d.customMetadata) : {}
            });
        }

        if (jsonOutput) {
            console.log(JSON.stringify(documents, null, 2));
        } else {
            for (const d of documents) {
                console.log(`Document: ${d.displayName || '(no name)'} (${d.name})`);
                if (Object.keys(d.metadata).length > 0) {
                    console.log('  Metadata:');
                    for (const [key, value] of Object.entries(d.metadata)) {
                        const displayValue = Array.isArray(value) ? JSON.stringify(value) : value;
                        console.log(`    ${key}: ${displayValue}`);
                    }
                }
                console.log('---');
            }
        }
    } catch (e: any) {
        if (jsonOutput) {
            console.log(JSON.stringify({ error: e.message }));
        } else {
            console.error('Error listing files:', e.message);
        }
    }
}

// --- Usage ---

function printUsage() {
    console.log(`
gemini-file-search - CLI tool for Google Gemini File Search stores

Usage: gemini-file-search <command> [options]

Environment Variables:
  GEMINI_API_KEY       Your Google Gemini API key (required)
  GET_CUSTOM_METADATA  Path to script that outputs key=value metadata for uploads

Commands:
  stores list                           List all file search stores
  stores create <name>                  Create a new file search store
  stores delete <name>                  Delete a file search store

  upload <path> --store <name>          Upload file(s) to a store
    [--glob <pattern>]                  Optional glob pattern for directory uploads
    [--meta <key=value>]                Add custom metadata (can be repeated)

  files list <store>                    List files in a store
  files get <store> <filename>          Get a specific file by name
  files delete <store> --filter <k=v>   Delete files matching filter

  query <store> <query>                 Query a store with natural language
    [--model <model>]                   Model to use (default: gemini-2.5-flash)
    [--filter <key=value>]              Filter by metadata

Global Options:
  --json                                Output results in JSON format

Examples:
  gemini-file-search stores list
  gemini-file-search stores create my-docs
  gemini-file-search upload ./docs --store my-docs
  gemini-file-search upload ./src --store my-code --glob "**/*.ts"
  gemini-file-search upload ./doc.pdf --store my-docs --meta author=John --meta year=2024
  gemini-file-search files list my-docs
  gemini-file-search files get my-docs "report.pdf"
  gemini-file-search query my-docs "What are the main features?"
  gemini-file-search query my-docs "Summarize" --filter year=2024
  gemini-file-search files list my-docs --json
`);
}

// --- Main ---

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    // Handle help and version before requiring API key
    if (!command || command === '--help' || command === '-h' || command === 'help') {
        printUsage();
        process.exit(command ? 0 : 1);
    }

    if (command === '--version' || command === '-v') {
        const pkg = await import('../package.json');
        console.log(pkg.version);
        process.exit(0);
    }

    // Parse global --json flag
    const jsonOutput = args.includes('--json');
    const filteredArgs = args.filter(a => a !== '--json');

    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    switch (command) {
        case 'stores':
            if (filteredArgs[1] === 'list') {
                await listStores(ai, jsonOutput);
            } else if (filteredArgs[1] === 'create' && filteredArgs[2]) {
                await createStore(ai, filteredArgs[2]);
            } else if (filteredArgs[1] === 'delete' && filteredArgs[2]) {
                await deleteStore(ai, filteredArgs[2]);
            } else {
                console.error('Invalid stores command. Use list, create <name>, or delete <name>.');
            }
            break;

        case 'upload': {
            let path = '';
            let store = '';
            let globPattern: string | undefined;
            const customMeta = new Map<string, string>();

            for (let i = 1; i < filteredArgs.length; i++) {
                if (filteredArgs[i] === '--store' && filteredArgs[i + 1]) {
                    store = filteredArgs[i + 1];
                    i++;
                } else if (filteredArgs[i] === '--glob' && filteredArgs[i + 1]) {
                    globPattern = filteredArgs[i + 1];
                    i++;
                } else if (filteredArgs[i] === '--meta' && filteredArgs[i + 1]) {
                    const [key, ...valueParts] = filteredArgs[i + 1].split('=');
                    const value = valueParts.join('=');
                    if (key && value) {
                        customMeta.set(key, value);
                    }
                    i++;
                } else if (!filteredArgs[i].startsWith('-')) {
                    path = filteredArgs[i];
                }
            }
            if (!path || !store) {
                console.error('Usage: upload <path> --store <name> [--glob <pattern>] [--meta <key=value>]');
                process.exit(1);
            }
            await uploadCommand(ai, path, store, globPattern, customMeta);
            break;
        }

        case 'files':
            if (filteredArgs[1] === 'get') {
                const store = filteredArgs[2];
                const filename = filteredArgs[3];
                if (!store || !filename) {
                    console.error('Usage: files get <store> <filename>');
                    process.exit(1);
                }
                await getFile(ai, store, filename, jsonOutput);
            } else if (filteredArgs[1] === 'delete') {
                const store = filteredArgs[2];
                let filter = '';
                for (let i = 3; i < filteredArgs.length; i++) {
                    if (filteredArgs[i] === '--filter' && filteredArgs[i + 1]) {
                        filter = filteredArgs[i + 1];
                        i++;
                    }
                }
                if (!store || !filter) {
                    console.error('Usage: files delete <store> --filter <key=value>');
                    process.exit(1);
                }
                await deleteFiles(ai, store, filter);
            } else if (filteredArgs[1] === 'list') {
                const store = filteredArgs[2];
                if (!store) {
                    console.error('Usage: files list <store>');
                    process.exit(1);
                }
                await listFiles(ai, store, jsonOutput);
            } else {
                console.error('Invalid files command.');
            }
            break;

        case 'query': {
            const qStore = filteredArgs[1];
            const qText = filteredArgs[2];
            let model = 'gemini-3-pro-preview';
            let filter: string | undefined;

            for (let i = 3; i < filteredArgs.length; i++) {
                if (filteredArgs[i] === '--model' && filteredArgs[i + 1]) {
                    model = filteredArgs[i + 1];
                    i++;
                } else if (filteredArgs[i] === '--filter' && filteredArgs[i + 1]) {
                    filter = filteredArgs[i + 1];
                    i++;
                }
            }

            if (!qStore || !qText) {
                console.error('Usage: query <store> <query_text> [--model <model>] [--filter <key=value>]');
                process.exit(1);
            }
            await queryStore(ai, qStore, qText, model, filter, jsonOutput);
            break;
        }

        default:
            printUsage();
            process.exit(1);
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

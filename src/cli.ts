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

async function listStores(ai: GoogleGenAI): Promise<void> {
    console.log('\nListing all File Search Stores:\n');
    const stores = await ai.fileSearchStores.list();
    let count = 0;
    for await (const store of stores) {
        count++;
        console.log(`  ${count}. ${store.displayName || '(no name)'}`);
        console.log(`     Name: ${store.name}`);
        console.log(`     Created: ${store.createTime}`);
        console.log('');
    }
    if (count === 0) console.log('  No stores found.');
    else console.log(`Total: ${count} store(s)`);
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

async function processMbox(ai: GoogleGenAI, filePath: string, storeName: string): Promise<void> {
    console.log(`Processing mbox file: ${filePath}`);
    const fileContent = await readFile(filePath, 'utf-8');
    const directory = dirname(filePath);

    const emails = fileContent.split(/^From /m).filter(e => e.trim().length > 0);
    console.log(`Found ${emails.length} emails in mbox.`);

    for (let i = 0; i < emails.length; i++) {
        const rawEmail = 'From ' + emails[i];

        const parser = new PostalMime();
        const email = await parser.parse(rawEmail);

        const from = email.from?.address || '';

        let year = '';
        let month = '';
        if (email.date) {
            const date = new Date(email.date);
            year = date.getFullYear().toString();
            month = (date.getMonth() + 1).toString().padStart(2, '0');
        }

        const originalFilename = basename(filePath);
        const subject = email.subject || '(no subject)';
        const safeSubject = subject.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const fileName = `${year}${month}_${safeSubject}_${i}.eml`;

        const contentToUpload = rawEmail;

        const tempPath = join('/tmp', fileName);
        await Bun.write(tempPath, contentToUpload);

        console.log(`Uploading email ${i + 1}/${emails.length}: ${subject}`);

        const metadata: any[] = [
            { key: 'from_email', stringValue: from },
            { key: 'source_filename', stringValue: originalFilename },
            { key: 'directory', stringValue: directory }
        ];

        const toList = email.to?.map(t => t.address).filter(Boolean) as string[] || [];
        if (toList.length > 0) {
            metadata.push({ key: 'to_email', stringListValue: { values: toList } });
        }

        const allParticipants = [
            ...(email.to?.map(t => t.address) || []),
            ...(email.cc?.map(c => c.address) || []),
            ...(email.bcc?.map(b => b.address) || [])
        ].filter(Boolean) as string[];

        if (allParticipants.length > 0) {
            metadata.push({ key: 'participants', stringListValue: { values: allParticipants } });
        }

        if (year) {
            metadata.push({ key: 'year', numericValue: parseInt(year) });
        }
        if (month) {
            metadata.push({ key: 'month', numericValue: parseInt(month) });
        }

        await ai.fileSearchStores.uploadToFileSearchStore({
            file: tempPath,
            fileSearchStoreName: storeName,
            config: {
                displayName: fileName,
                mimeType: 'text/plain',
                customMetadata: metadata
            }
        });
    }
}

async function uploadCommand(ai: GoogleGenAI, path: string, storeName: string, globPattern?: string): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await createOrGetStore(ai, storeName);
        fullStoreName = found;
    }

    const stats = await stat(path);
    if (stats.isDirectory()) {
        if (globPattern) {
            console.log(`Scanning directory ${path} with glob: ${globPattern}`);
            const glob = new Bun.Glob(globPattern);
            for await (const relativePath of glob.scan({ cwd: path, onlyFiles: true })) {
                const fullPath = join(path, relativePath);
                await uploadCommand(ai, fullPath, fullStoreName);
            }
        } else {
            const entries = await readdir(path, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(path, entry.name);
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                await uploadCommand(ai, fullPath, fullStoreName);
            }
        }
    } else if (stats.isFile()) {
        const rawMimeType = Bun.file(path).type;
        const mimeType = rawMimeType ? rawMimeType.split(';')[0].trim() : 'text/plain';

        console.log(`File: ${path}, Type: ${rawMimeType} -> ${mimeType}`);

        if (path.endsWith('.mbox')) {
            await processMbox(ai, path, fullStoreName);
        } else {
            console.log(`Uploading generic file: ${path}`);
            const directory = dirname(resolve(path));

            const operation = await ai.fileSearchStores.uploadToFileSearchStore({
                file: path,
                fileSearchStoreName: fullStoreName,
                config: {
                    displayName: basename(path),
                    mimeType: mimeType,
                    customMetadata: [
                        { key: 'directory', stringValue: directory }
                    ] as any
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

async function queryStore(ai: GoogleGenAI, storeName: string, queryText: string, modelName: string = 'gemini-2.5-flash', filter?: string): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            console.error(`Error: Store with display name "${storeName}" not found.`);
            return;
        }
        fullStoreName = found;
    }

    console.log(`Querying store: ${fullStoreName}`);
    console.log(`Query: ${queryText}`);
    console.log(`Model: ${modelName}`);
    if (filter) {
        console.log(`Filter: ${filter}`);
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
    console.log('Config:', JSON.stringify(config, null, 2));
    console.log('---');

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: queryText,
            config: config
        });

        console.log('Response:');
        console.log(response.text);

    } catch (error: any) {
        console.error('Error querying store:', error.message);
    }
}

// --- List Files ---

async function listFiles(ai: GoogleGenAI, storeName: string): Promise<void> {
    let fullStoreName = storeName;
    if (!storeName.startsWith('fileSearchStores/')) {
        const found = await findStoreByDisplayName(ai, storeName);
        if (!found) {
            console.error(`Error: Store with display name "${storeName}" not found.`);
            return;
        }
        fullStoreName = found;
    }

    console.log(`Listing documents in ${fullStoreName}...`);

    try {
        const response = await ai.fileSearchStores.documents.list({
            parent: fullStoreName,
            config: { pageSize: 20 }
        });

        for await (const doc of response) {
            const d = doc as any;
            console.log(`Document: ${d.displayName || '(no name)'} (${d.name})`);
            if (d.customMetadata && d.customMetadata.length > 0) {
                console.log('  Metadata:');
                for (const m of d.customMetadata) {
                    const value = m.stringValue ?? m.numericValue ?? (m.stringListValue ? JSON.stringify(m.stringListValue.values) : 'undefined');
                    console.log(`    ${m.key}: ${value}`);
                }
            }
            console.log('---');
        }
    } catch (e: any) {
        console.error('Error listing files:', e.message);
    }
}

// --- Usage ---

function printUsage() {
    console.log(`
gemini-file-search - CLI tool for Google Gemini File Search stores

Usage: gemini-file-search <command> [options]

Environment Variables:
  GEMINI_API_KEY    Your Google Gemini API key (required)

Commands:
  stores list                           List all file search stores
  stores create <name>                  Create a new file search store
  stores delete <name>                  Delete a file search store

  upload <path> --store <name>          Upload file(s) to a store
    [--glob <pattern>]                  Optional glob pattern for directory uploads

  files list <store>                    List files in a store
  files delete <store> --filter <k=v>   Delete files matching filter

  query <store> <query>                 Query a store with natural language
    [--model <model>]                   Model to use (default: gemini-2.5-flash)
    [--filter <key=value>]              Filter by metadata

Examples:
  gemini-file-search stores list
  gemini-file-search stores create my-docs
  gemini-file-search upload ./docs --store my-docs
  gemini-file-search upload ./src --store my-code --glob "**/*.ts"
  gemini-file-search files list my-docs
  gemini-file-search query my-docs "What are the main features?"
  gemini-file-search query my-docs "Summarize" --filter year=2024
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

    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    switch (command) {
        case 'stores':
            if (args[1] === 'list') {
                await listStores(ai);
            } else if (args[1] === 'create' && args[2]) {
                await createStore(ai, args[2]);
            } else if (args[1] === 'delete' && args[2]) {
                await deleteStore(ai, args[2]);
            } else {
                console.error('Invalid stores command. Use list, create <name>, or delete <name>.');
            }
            break;

        case 'upload': {
            let path = '';
            let store = '';
            let globPattern: string | undefined;

            for (let i = 1; i < args.length; i++) {
                if (args[i] === '--store' && args[i + 1]) {
                    store = args[i + 1];
                    i++;
                } else if (args[i] === '--glob' && args[i + 1]) {
                    globPattern = args[i + 1];
                    i++;
                } else if (!args[i].startsWith('-')) {
                    path = args[i];
                }
            }
            if (!path || !store) {
                console.error('Usage: upload <path> --store <name> [--glob <pattern>]');
                process.exit(1);
            }
            await uploadCommand(ai, path, store, globPattern);
            break;
        }

        case 'files':
            if (args[1] === 'delete') {
                const store = args[2];
                let filter = '';
                for (let i = 3; i < args.length; i++) {
                    if (args[i] === '--filter' && args[i + 1]) {
                        filter = args[i + 1];
                        i++;
                    }
                }
                if (!store || !filter) {
                    console.error('Usage: files delete <store> --filter <key=value>');
                    process.exit(1);
                }
                await deleteFiles(ai, store, filter);
            } else if (args[1] === 'list') {
                const store = args[2];
                if (!store) {
                    console.error('Usage: files list <store>');
                    process.exit(1);
                }
                await listFiles(ai, store);
            } else {
                console.error('Invalid files command.');
            }
            break;

        case 'query': {
            const qStore = args[1];
            const qText = args[2];
            let model = 'gemini-2.5-flash';
            let filter: string | undefined;

            for (let i = 3; i < args.length; i++) {
                if (args[i] === '--model' && args[i + 1]) {
                    model = args[i + 1];
                    i++;
                } else if (args[i] === '--filter' && args[i + 1]) {
                    filter = args[i + 1];
                    i++;
                }
            }

            if (!qStore || !qText) {
                console.error('Usage: query <store> <query_text> [--model <model>] [--filter <key=value>]');
                process.exit(1);
            }
            await queryStore(ai, qStore, qText, model, filter);
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

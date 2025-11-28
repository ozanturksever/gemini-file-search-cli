<br />

The Gemini API enables Retrieval Augmented Generation ("RAG") through the File Search tool. File Search imports, chunks, and indexes your data to enable fast retrieval of relevant information based on a user's prompt. This information is then provided as context to the model, allowing the model to provide more accurate and relevant answers.

You can use the[`uploadToFileSearchStore`](https://ai.google.dev/api/file-search/file-search-stores#method:-media.uploadtofilesearchstore)API to directly upload an existing file to your File Search store, or separately upload and then[`importFile`](https://ai.google.dev/api/file-search/file-search-stores#method:-filesearchstores.importfile)if you want to create the file at the same time.

## Directly upload to File Search store

This examples shows how to directly upload a file to a file store:  

### Python

    from google import genai
    from google.genai import types
    import time

    client = genai.Client()

    # Create the File Search store with an optional display name
    file_search_store = client.file_search_stores.create(config={'display_name': 'your-fileSearchStore-name'})

    # Upload and import a file into the File Search store, supply a file name which will be visible in citations
    operation = client.file_search_stores.upload_to_file_search_store(
      file='sample.txt',
      file_search_store_name=file_search_store.name,
      config={
          'display_name' : 'display-file-name',
      }
    )

    # Wait until import is complete
    while not operation.done:
        time.sleep(5)
        operation = client.operations.get(operation)

    # Ask a question about the file
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="""Can you tell me about Robert Graves""",
        config=types.GenerateContentConfig(
            tools=[
                types.Tool(
                    file_search=types.FileSearch(
                        file_search_store_names=[file_search_store.name]
                    )
                )
            ]
        )
    )

    print(response.text)

### JavaScript

    const { GoogleGenAI } = require('@google/genai');

    const ai = new GoogleGenAI({});

    async function run() {
      // Create the File Search store with an optional display name
      const fileSearchStore = await ai.fileSearchStores.create({
        config: { displayName: 'your-fileSearchStore-name' }
      });

      // Upload and import a file into the File Search store, supply a file name which will be visible in citations
      let operation = await ai.fileSearchStores.uploadToFileSearchStore({
        file: 'file.txt',
        fileSearchStoreName: fileSearchStore.name,
        config: {
          displayName: 'file-name',
        }
      });

      // Wait until import is complete
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.get({ operation });
      }

      // Ask a question about the file
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Can you tell me about Robert Graves",
        config: {
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [fileSearchStore.name]
              }
            }
          ]
        }
      });

      console.log(response.text);
    }

    run();

### REST

    FILE_PATH="path/to/sample.pdf"
    MIME_TYPE=$(file -b --mime-type "${FILE_PATH}")
    NUM_BYTES=$(wc -c < "${FILE_PATH}")

    # Create a FileSearchStore
    STORE_RESPONSE=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${GEMINI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{ "displayName": "My Store" }')

    # Extract the store name (format: fileSearchStores/xxxxxxx)
    STORE_NAME=$(echo $STORE_RESPONSE | jq -r '.name')

    # Initiate Resumable Upload to the Store
    TMP_HEADER="upload-header.tmp"

    curl -s -D "${TMP_HEADER}" \ "https://generativelanguage.googleapis.com/upload/v1beta/${STORE_NAME}:uploadToFileSearchStore?key=${GEMINI_API_KEY}" \
      -H "X-Goog-Upload-Protocol: resumable" \
      -H "X-Goog-Upload-Command: start" \
      -H "X-Goog-Upload-Header-Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Header-Content-Type: ${MIME_TYPE}" \
      -H "Content-Type: application/json" > /dev/null

    # Extract upload_url from headers
    UPLOAD_URL=$(grep -i "x-goog-upload-url: " "${TMP_HEADER}" | cut -d" " -f2 | tr -d "\r")
    rm "${TMP_HEADER}"

    # --- Upload the actual bytes ---
    curl "${UPLOAD_URL}" \
      -H "Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Offset: 0" \
      -H "X-Goog-Upload-Command: upload, finalize" \
      --data-binary "@${FILE_PATH}" 2> /dev/null

    # Generate content using the FileSearchStore
    curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
        -H "x-goog-api-key: $GEMINI_API_KEY" \
        -H 'Content-Type: application/json' \
        -X POST \
        -d '{
                "contents": [{
                    "parts":[{"text": "What does the research say about ..."}]          
                }],
                "tools": [{
                    "file_search": { "file_search_store_names":["'$STORE_NAME'"] }
                }]
            }' 2> /dev/null > response.json

    cat response.json

Check the API reference for[`uploadToFileSearchStore`](https://ai.google.dev/api/file-search/file-search-stores#method:-media.uploadtofilesearchstore)for more information.

## Importing files

Alternatively, you can upload an existing file and import it to your file store:  

### Python

    from google import genai
    from google.genai import types
    import time

    client = genai.Client()

    # Upload the file using the Files API, supply a file name which will be visible in citations
    sample_file = client.files.upload(file='sample.txt', config={'name': 'display_file_name'})

    # Create the File Search store with an optional display name
    file_search_store = client.file_search_stores.create(config={'display_name': 'your-fileSearchStore-name'})

    # Import the file into the File Search store
    operation = client.file_search_stores.import_file(
        file_search_store_name=file_search_store.name,
        file_name=sample_file.name
    )

    # Wait until import is complete
    while not operation.done:
        time.sleep(5)
        operation = client.operations.get(operation)

    # Ask a question about the file
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="""Can you tell me about Robert Graves""",
        config=types.GenerateContentConfig(
            tools=[
                types.Tool(
                    file_search=types.FileSearch(
                        file_search_store_names=[file_search_store.name]
                    )
                )
            ]
        )
    )

    print(response.text)

### JavaScript

    const { GoogleGenAI } = require('@google/genai');

    const ai = new GoogleGenAI({});

    async function run() {
      // Upload the file using the Files API, supply a file name which will be visible in citations
      const sampleFile = await ai.files.upload({
        file: 'sample.txt',
        config: { name: 'file-name' }
      });

      // Create the File Search store with an optional display name
      const fileSearchStore = await ai.fileSearchStores.create({
        config: { displayName: 'your-fileSearchStore-name' }
      });

      // Import the file into the File Search store
      let operation = await ai.fileSearchStores.importFile({
        fileSearchStoreName: fileSearchStore.name,
        fileName: sampleFile.name
      });

      // Wait until import is complete
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.get({ operation: operation });
      }

      // Ask a question about the file
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Can you tell me about Robert Graves",
        config: {
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [fileSearchStore.name]
              }
            }
          ]
        }
      });

      console.log(response.text);
    }

    run();

### REST

    FILE_PATH="path/to/sample.pdf"
    MIME_TYPE=$(file -b --mime-type "${FILE_PATH}")
    NUM_BYTES=$(wc -c < "${FILE_PATH}")

    # Create a FileSearchStore
    STORE_RESPONSE=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${GEMINI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{ "displayName": "My Store" }')

    STORE_NAME=$(echo $STORE_RESPONSE | jq -r '.name')

    # Initiate Resumable Upload to the Store
    TMP_HEADER="upload-header.tmp"

    curl -s -X POST "https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}" \
      -D "${TMP_HEADER}" \
      -H "X-Goog-Upload-Protocol: resumable" \
      -H "X-Goog-Upload-Command: start" \
      -H "X-Goog-Upload-Header-Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Header-Content-Type: ${MIME_TYPE}" \
      -H "Content-Type: application/json" 2> /dev/null

    UPLOAD_URL=$(grep -i "x-goog-upload-url: " "${TMP_HEADER}" | cut -d" " -f2 | tr -d "\r")
    rm "${TMP_HEADER}"

    # Upload the actual bytes.
    curl -s -X POST "${UPLOAD_URL}" \
      -H "Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Offset: 0" \
      -H "X-Goog-Upload-Command: upload, finalize" \
      --data-binary "@${FILE_PATH}" 2> /dev/null > file_info.json

    file_uri=$(jq ".file.name" file_info.json)

    # Import files into the file search store
    operation_name=$(curl "https://generativelanguage.googleapis.com/v1beta/${STORE_NAME}:importFile?key=${GEMINI_API_KEY}" \
      -H "Content-Type: application/json" \
      -X POST \
      -d '{
            "file_name":'$file_uri'
        }' | jq -r .name)

    # Wait for long running operation to complete
    while true; do
      # Get the full JSON status and store it in a variable.
      status_response=$(curl -s -H "x-goog-api-key: $GEMINI_API_KEY" "https://generativelanguage.googleapis.com/v1beta/${operation_name}")

      # Check the "done" field from the JSON stored in the variable.
      is_done=$(echo "${status_response}" | jq .done)

      if [ "${is_done}" = "true" ]; then
        break
      fi
      # Wait for 10 seconds before checking again.
      sleep 10
    done

    # Generate content using the FileSearchStore
    curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}" \
        -H 'Content-Type: application/json' \
        -X POST \
        -d '{
                "contents": [{
                    "parts":[{"text": "What does the research say about ..."}]          
                }],
                "tools": [{
                    "file_search": { "file_search_store_names":["'$STORE_NAME'"] }
                }]
            }' 2> /dev/null > response.json

    cat response.json

Check the API reference for[`importFile`](https://ai.google.dev/api/file-search/file-search-stores#method:-filesearchstores.importfile)for more information.

## Chunking configuration

When you import a file into a File Search store, it's automatically broken down into chunks, embedded, indexed, and uploaded to your File Search store. If you need more control over the chunking strategy, you can specify a[`chunking_config`](https://ai.google.dev/api/file-search/file-search-stores#request-body_5)setting to set a maximum number of tokens per chunk and maximum number of overlapping tokens.  

### Python

    # Upload and import and upload the file into the File Search store with a custom chunking configuration
    operation = client.file_search_stores.upload_to_file_search_store(
        file_search_store_name=file_search_store.name,
        file_name=sample_file.name,
        config={
            'chunking_config': {
              'white_space_config': {
                'max_tokens_per_chunk': 200,
                'max_overlap_tokens': 20
              }
            }
        }
    )

### JavaScript

    // Upload and import and upload the file into the File Search store with a custom chunking configuration
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file: 'file.txt',
      fileSearchStoreName: fileSearchStore.name,
      config: {
        displayName: 'file-name',
        chunkingConfig: {
          whiteSpaceConfig: {
            maxTokensPerChunk: 200,
            maxOverlapTokens: 20
          }
        }
      }
    });

### REST

    FILE_PATH="path/to/sample.pdf"
    MIME_TYPE=$(file -b --mime-type "${FILE_PATH}")
    NUM_BYTES=$(wc -c < "${FILE_PATH}")

    # Create a FileSearchStore
    STORE_RESPONSE=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${GEMINI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{ "displayName": "My Store" }')

    # Extract the store name (format: fileSearchStores/xxxxxxx)
    STORE_NAME=$(echo $STORE_RESPONSE | jq -r '.name')

    # Initiate Resumable Upload to the Store
    TMP_HEADER="upload-header.tmp"

    curl -s -D "${TMP_HEADER}" \ "https://generativelanguage.googleapis.com/upload/v1beta/${STORE_NAME}:uploadToFileSearchStore?key=${GEMINI_API_KEY}" \
      -H "X-Goog-Upload-Protocol: resumable" \
      -H "X-Goog-Upload-Command: start" \
      -H "X-Goog-Upload-Header-Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Header-Content-Type: ${MIME_TYPE}" \
      -H "Content-Type: application/json" > /dev/null
      -d '{
            "chunking_config": {
              "white_space_config": {
                "max_tokens_per_chunk": 200,
                "max_overlap_tokens": 20
              }
            }
        }'

    # Extract upload_url from headers
    UPLOAD_URL=$(grep -i "x-goog-upload-url: " "${TMP_HEADER}" | cut -d" " -f2 | tr -d "\r")
    rm "${TMP_HEADER}"

    # --- Upload the actual bytes ---
    curl "${UPLOAD_URL}" \
      -H "Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Offset: 0" \
      -H "X-Goog-Upload-Command: upload, finalize" \
      --data-binary "@${FILE_PATH}" 2> /dev/null

To use your File Search store, pass it as a tool to the`generateContent`method, as shown in the[Upload](https://ai.google.dev/gemini-api/docs/file-search#upload)and[Import](https://ai.google.dev/gemini-api/docs/file-search#importing-files)examples.

## How it works

File Search uses a technique called semantic search to find information relevant to the user prompt. Unlike traditional keyword-based search, semantic search understands the meaning and context of your query.

When you import a file, it's converted into numerical representations called[embeddings](https://ai.google.dev/gemini-api/docs/embeddings), which capture the semantic meaning of the text. These embeddings are stored in a specialized File Search database. When you make a query, it's also converted into an embedding. Then the system performs a File Search to find the most similar and relevant document chunks from the File Search store.

Here's a breakdown of the process for using the File Search`uploadToFileSearchStore`API:

1. **Create a File Search store**: A File Search store contains the processed data from your files. It's the persistent container for the embeddings that the semantic search will operate on.

2. **Upload a file and import into a File Search store** : Simultaneously upload a file and import the results into your File Search store. This creates a temporary`File`object, which is a reference to your raw document. That data is then chunked, converted into File Search embeddings, and indexed. The`File`object gets deleted after 48 hours, while the data imported into the File Search store will be stored indefinitely until you choose to delete it.

3. **Query with File Search** : Finally, you use the`FileSearch`tool in a`generateContent`call. In the tool configuration, you specify a`FileSearchRetrievalResource`, which points to the`FileSearchStore`you want to search. This tells the model to perform a semantic search on that specific File Search store to find relevant information to ground its response.

![The indexing and querying process of File Search](https://ai.google.dev/static/gemini-api/docs/images/File-search.png)The indexing and querying process of File Search

In this diagram, the dotted line from from*Documents* to*Embedding model* (using[`gemini-embedding-001`](https://ai.google.dev/gemini-api/docs/embeddings)) represents the`uploadToFileSearchStore`API (bypassing*File storage* ). Otherwise, using the[Files API](https://ai.google.dev/gemini-api/docs/files)to separately create and then import files moves the indexing process from*Documents* to*File storage* and then to*Embedding model*.

## File Search stores

A File Search store is a container for your document embeddings. While raw files uploaded through the File API are deleted after 48 hours, the data imported into a File Search store is stored indefinitely until you manually delete it. You can create multiple File Search stores to organize your documents. The`FileSearchStore`API lets you create, list, get, and delete to manage your file search stores. File Search store names are globally scoped.

Here are some examples of how to manage your File Search stores:  

### Python

    # Create a File Search store (including optional display_name for easier reference)
    file_search_store = client.file_search_stores.create(config={'display_name': 'my-file_search-store-123'})

    # List all your File Search stores
    for file_search_store in client.file_search_stores.list():
        print(file_search_store)

    # Get a specific File Search store by name
    my_file_search_store = client.file_search_stores.get(name='fileSearchStores/my-file_search-store-123')

    # Delete a File Search store
    client.file_search_stores.delete(name='fileSearchStores/my-file_search-store-123', config={'force': True})

### JavaScript

    // Create a File Search store (including optional display_name for easier reference)
    const fileSearchStore = await ai.fileSearchStores.create({
      config: { displayName: 'my-file_search-store-123' }
    });

    // List all your File Search stores
    const fileSearchStores = await ai.fileSearchStores.list();
    for await (const store of fileSearchStores) {
      console.log(store);
    }

    // Get a specific File Search store by name
    const myFileSearchStore = await ai.fileSearchStores.get({
      name: 'fileSearchStores/my-file_search-store-123'
    });

    // Delete a File Search store
    await ai.fileSearchStores.delete({
      name: 'fileSearchStores/my-file_search-store-123',
      config: { force: true }
    });

### REST

    # Create a File Search store (including optional display_name for easier reference)
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${GEMINI_API_KEY}" \
        -H "Content-Type: application/json" 
        -d '{ "displayName": "My Store" }'

    # List all your File Search stores
    curl "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${GEMINI_API_KEY}" \

    # Get a specific File Search store by name
    curl "https://generativelanguage.googleapis.com/v1beta/fileSearchStores/my-file_search-store-123?key=${GEMINI_API_KEY}"

    # Delete a File Search store
    curl -X DELETE "https://generativelanguage.googleapis.com/v1beta/fileSearchStores/my-file_search-store-123?key=${GEMINI_API_KEY}"

The[File Search Documents](https://ai.google.dev/api/file-search/documents)API reference for methods and fields related to managing documents in your file stores.

## File metadata

You can add custom metadata to your files to help filter them or provide additional context. Metadata is a set of key-value pairs.  

### Python

    # Import the file into the File Search store with custom metadata
    op = client.file_search_stores.import_file(
        file_search_store_name=file_search_store.name,
        file_name=sample_file.name,
        custom_metadata=[
            {"key": "author", "string_value": "Robert Graves"},
            {"key": "year", "numeric_value": 1934}
        ]
    )

### JavaScript

    // Import the file into the File Search store with custom metadata
    let operation = await ai.fileSearchStores.importFile({
      fileSearchStoreName: fileSearchStore.name,
      fileName: sampleFile.name,
      config: {
        customMetadata: [
          { key: "author", stringValue: "Robert Graves" },
          { key: "year", numericValue: 1934 }
        ]
      }
    });

### REST

    FILE_PATH="path/to/sample.pdf"
    MIME_TYPE=$(file -b --mime-type "${FILE_PATH}")
    NUM_BYTES=$(wc -c < "${FILE_PATH}")

    # Create a FileSearchStore
    STORE_RESPONSE=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${GEMINI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{ "displayName": "My Store" }')

    # Extract the store name (format: fileSearchStores/xxxxxxx)
    STORE_NAME=$(echo $STORE_RESPONSE | jq -r '.name')

    # Initiate Resumable Upload to the Store
    TMP_HEADER="upload-header.tmp"

    curl -s -D "${TMP_HEADER}" \
      "https://generativelanguage.googleapis.com/upload/v1beta/${STORE_NAME}:uploadToFileSearchStore?key=${GEMINI_API_KEY}" \
      -H "X-Goog-Upload-Protocol: resumable" \
      -H "X-Goog-Upload-Command: start" \
      -H "X-Goog-Upload-Header-Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Header-Content-Type: ${MIME_TYPE}" \
      -H "Content-Type: application/json" \
      -d '{
            "custom_metadata": [
              {"key": "author", "string_value": "Robert Graves"},
              {"key": "year", "numeric_value": 1934}
            ]
        }' > /dev/null

    # Extract upload_url from headers
    UPLOAD_URL=$(grep -i "x-goog-upload-url: " "${TMP_HEADER}" | cut -d" " -f2 | tr -d "\r")
    rm "${TMP_HEADER}"

    # --- Upload the actual bytes ---
    curl "${UPLOAD_URL}" \
      -H "Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Offset: 0" \
      -H "X-Goog-Upload-Command: upload, finalize" \
      --data-binary "@${FILE_PATH}" 2> /dev/null

This is useful when you have multiple documents in a File Search store and want to search only a subset of them.  

### Python

    # Use the metadata filter to search within a subset of documents
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="Tell me about the book 'I, Claudius'",
        config=types.GenerateContentConfig(
            tools=[
                types.Tool(
                    file_search=types.FileSearch(
                        file_search_store_names=[file_search_store.name],
                        metadata_filter="author=Robert Graves",
                    )
                )
            ]
        )
    )

    print(response.text)

### JavaScript

    // Use the metadata filter to search within a subset of documents
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Tell me about the book 'I, Claudius'",
      config: {
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: [fileSearchStore.name],
              metadataFilter: 'author="Robert Graves"',
            }
          }
        ]
      }
    });

    console.log(response.text);

### REST

    curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}" \
        -H 'Content-Type: application/json' \
        -X POST \
        -d '{
                "contents": [{
                    "parts":[{"text": "Tell me about the book I, Claudius"}]          
                }],
                "tools": [{
                    "file_search": { 
                        "file_search_store_names":["'$STORE_NAME'"],
                        "metadata_filter": "author = \"Robert Graves\""
                    }
                }]
            }' 2> /dev/null > response.json

    cat response.json

Guidance on implementing list filter syntax for`metadata_filter`can be found at[google.aip.dev/160](https://google.aip.dev/160)

## Citations

When you use File Search, the model's response may include citations that specify which parts of your uploaded documents were used to generate the answer. This helps with fact-checking and verification.

You can access citation information through the`grounding_metadata`attribute of the response.  

### Python

    print(response.candidates[0].grounding_metadata)

### JavaScript

    console.log(JSON.stringify(response.candidates?.[0]?.groundingMetadata, null, 2));

## Supported models

The following models support File Search:

- [`gemini-3-pro-preview`](https://ai.google.dev/gemini-api/docs/models#gemini-3-pro)
- [`gemini-2.5-pro`](https://ai.google.dev/gemini-api/docs/models#gemini-2.5-pro)
- [`gemini-2.5-flash`](https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash)and its preview versions
- [`gemini-2.5-flash-lite`](https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-lite)and its preview versions

## Supported file types

File Search supports a wide range of file formats, listed in the following sections.

### Application file types

- `application/dart`
- `application/ecmascript`
- `application/json`
- `application/ms-java`
- `application/msword`
- `application/pdf`
- `application/sql`
- `application/typescript`
- `application/vnd.curl`
- `application/vnd.dart`
- `application/vnd.ibm.secure-container`
- `application/vnd.jupyter`
- `application/vnd.ms-excel`
- `application/vnd.oasis.opendocument.text`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.template`
- `application/x-csh`
- `application/x-hwp`
- `application/x-hwp-v5`
- `application/x-latex`
- `application/x-php`
- `application/x-powershell`
- `application/x-sh`
- `application/x-shellscript`
- `application/x-tex`
- `application/x-zsh`
- `application/xml`
- `application/zip`

### Text file types

- `text/1d-interleaved-parityfec`
- `text/RED`
- `text/SGML`
- `text/cache-manifest`
- `text/calendar`
- `text/cql`
- `text/cql-extension`
- `text/cql-identifier`
- `text/css`
- `text/csv`
- `text/csv-schema`
- `text/dns`
- `text/encaprtp`
- `text/enriched`
- `text/example`
- `text/fhirpath`
- `text/flexfec`
- `text/fwdred`
- `text/gff3`
- `text/grammar-ref-list`
- `text/hl7v2`
- `text/html`
- `text/javascript`
- `text/jcr-cnd`
- `text/jsx`
- `text/markdown`
- `text/mizar`
- `text/n3`
- `text/parameters`
- `text/parityfec`
- `text/php`
- `text/plain`
- `text/provenance-notation`
- `text/prs.fallenstein.rst`
- `text/prs.lines.tag`
- `text/prs.prop.logic`
- `text/raptorfec`
- `text/rfc822-headers`
- `text/rtf`
- `text/rtp-enc-aescm128`
- `text/rtploopback`
- `text/rtx`
- `text/sgml`
- `text/shaclc`
- `text/shex`
- `text/spdx`
- `text/strings`
- `text/t140`
- `text/tab-separated-values`
- `text/texmacs`
- `text/troff`
- `text/tsv`
- `text/tsx`
- `text/turtle`
- `text/ulpfec`
- `text/uri-list`
- `text/vcard`
- `text/vnd.DMClientScript`
- `text/vnd.IPTC.NITF`
- `text/vnd.IPTC.NewsML`
- `text/vnd.a`
- `text/vnd.abc`
- `text/vnd.ascii-art`
- `text/vnd.curl`
- `text/vnd.debian.copyright`
- `text/vnd.dvb.subtitle`
- `text/vnd.esmertec.theme-descriptor`
- `text/vnd.exchangeable`
- `text/vnd.familysearch.gedcom`
- `text/vnd.ficlab.flt`
- `text/vnd.fly`
- `text/vnd.fmi.flexstor`
- `text/vnd.gml`
- `text/vnd.graphviz`
- `text/vnd.hans`
- `text/vnd.hgl`
- `text/vnd.in3d.3dml`
- `text/vnd.in3d.spot`
- `text/vnd.latex-z`
- `text/vnd.motorola.reflex`
- `text/vnd.ms-mediapackage`
- `text/vnd.net2phone.commcenter.command`
- `text/vnd.radisys.msml-basic-layout`
- `text/vnd.senx.warpscript`
- `text/vnd.sosi`
- `text/vnd.sun.j2me.app-descriptor`
- `text/vnd.trolltech.linguist`
- `text/vnd.wap.si`
- `text/vnd.wap.sl`
- `text/vnd.wap.wml`
- `text/vnd.wap.wmlscript`
- `text/vtt`
- `text/wgsl`
- `text/x-asm`
- `text/x-bibtex`
- `text/x-boo`
- `text/x-c`
- `text/x-c++hdr`
- `text/x-c++src`
- `text/x-cassandra`
- `text/x-chdr`
- `text/x-coffeescript`
- `text/x-component`
- `text/x-csh`
- `text/x-csharp`
- `text/x-csrc`
- `text/x-cuda`
- `text/x-d`
- `text/x-diff`
- `text/x-dsrc`
- `text/x-emacs-lisp`
- `text/x-erlang`
- `text/x-gff3`
- `text/x-go`
- `text/x-haskell`
- `text/x-java`
- `text/x-java-properties`
- `text/x-java-source`
- `text/x-kotlin`
- `text/x-lilypond`
- `text/x-lisp`
- `text/x-literate-haskell`
- `text/x-lua`
- `text/x-moc`
- `text/x-objcsrc`
- `text/x-pascal`
- `text/x-pcs-gcd`
- `text/x-perl`
- `text/x-perl-script`
- `text/x-python`
- `text/x-python-script`
- `text/x-r-markdown`
- `text/x-rsrc`
- `text/x-rst`
- `text/x-ruby-script`
- `text/x-rust`
- `text/x-sass`
- `text/x-scala`
- `text/x-scheme`
- `text/x-script.python`
- `text/x-scss`
- `text/x-setext`
- `text/x-sfv`
- `text/x-sh`
- `text/x-siesta`
- `text/x-sos`
- `text/x-sql`
- `text/x-swift`
- `text/x-tcl`
- `text/x-tex`
- `text/x-vbasic`
- `text/x-vcalendar`
- `text/xml`
- `text/xml-dtd`
- `text/xml-external-parsed-entity`
- `text/yaml`

## Rate limits

The File Search API has the following limits to enforce service stability:

- **Maximum file size / per document limit**: 100 MB
- **Total size of project File Search stores** (based on user tier):
  - **Free**: 1 GB
  - **Tier 1**: 10 GB
  - **Tier 2**: 100 GB
  - **Tier 3**: 1 TB
- **Recommendation**: Limit the size of each File Search store to under 20 GB to ensure optimal retrieval latencies.

| **Note:** The limit on File Search store size is computed on the backend, based on the size of your input plus the embeddings generated and stored with it. This is typically approximately 3 times the size of your input data.

## Pricing

- Developers are charged for embeddings at indexing time based on existing[embeddings pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-embedding)($0.15 per 1M tokens).
- Storage is free of charge.
- Query time embeddings are free of charge.
- Retrieved document tokens are charged as regular[context tokens](https://ai.google.dev/gemini-api/docs/tokens).

## What's next

- Visit the API reference for[File Search Stores](https://ai.google.dev/api/file-search/file-search-stores)and File Search[Documents](https://ai.google.dev/api/file-search/documents).

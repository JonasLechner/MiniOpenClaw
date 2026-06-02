# Manual web tool test results

Source implementations:
- `src/agent/tools/websearch.ts`
- `src/agent/tools/webfetch.ts`

Tested manually by importing:
- `dist/agent/tools/websearch.js`
- `dist/agent/tools/webfetch.js`

## Command used

```bash
node --input-type=module <<'EOF'
import { webSearchTool } from './dist/agent/tools/websearch.js';
import { webFetchTool } from './dist/agent/tools/webfetch.js';

const results = {};

async function run(name, fn) {
  try {
    results[name] = { ok: true, output: await fn() };
  } catch (error) {
    results[name] = {
      ok: false,
      error: {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      },
    };
  }
}

await run('websearch', () => webSearchTool.run({ query: 'OpenAI', limit: 3 }));
await run('webfetch_text', () => webFetchTool.run({ url: 'https://example.com', format: 'text' }));
await run('webfetch_html', () => webFetchTool.run({ url: 'https://example.com', format: 'html' }));

console.log(JSON.stringify(results, null, 2));
EOF
```

## Returned output

```json
{
  "websearch": {
    "ok": true,
    "output": {
      "query": "OpenAI",
      "results": [
        {
          "title": "Official site",
          "url": "//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2F&rut=95b9721151fcc3756d81913de377aa72809eb0b23daf5c1a40ab0fca2a8def45",
          "snippet": "OpenAI"
        },
        {
          "title": "OpenAI | Research & Deployment",
          "url": "//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2F&rut=95b9721151fcc3756d81913de377aa72809eb0b23daf5c1a40ab0fca2a8def45",
          "snippet": "We believe our research will eventually lead to artificial general intelligence, a system that can solve human-level problems. Building safe and beneficial AGI is our mission."
        },
        {
          "title": "ChatGPT",
          "url": "//duckduckgo.com/l/?uddg=https%3A%2F%2Fchatgpt.com%2F&rut=bbe48ce0ce7f46ec48a65d176efa06a5b45bcf3df26782b0d37330b19525670b",
          "snippet": "ChatGPT helps you get answers, find inspiration, and be more productive."
        }
      ]
    }
  },
  "webfetch_text": {
    "ok": true,
    "output": {
      "url": "https://example.com/",
      "status": 200,
      "content": "Example Domain Example Domain This domain is for use in documentation examples without needing permission. Avoid use in operations. Learn more"
    }
  },
  "webfetch_html": {
    "ok": true,
    "output": {
      "url": "https://example.com/",
      "status": 200,
      "content": "<!doctype html><html lang=\"en\"><head><title>Example Domain</title><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>body{background:#eee;width:60vw;margin:15vh auto;font-family:system-ui,sans-serif}h1{font-size:1.5em}div{opacity:0.8}a:link,a:visited{color:#348}</style></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href=\"https://iana.org/domains/example\">Learn more</a></p></div></body></html>\n"
    }
  }
}
```

## Notes

- `websearch` currently returns DuckDuckGo redirect URLs (`//duckduckgo.com/l/?uddg=...`) rather than resolved destination URLs.
- `webfetch` worked for both stripped text and raw HTML when tested directly.

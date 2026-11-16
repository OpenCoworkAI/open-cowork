# Choose a browser for Chrome MCP

In Settings → MCP Connectors, edit the Chrome connector. Keep the `npx`
command and replace its arguments with a JSON array. This preserves executable
paths containing spaces. For example, on macOS:

```json
["-y", "chrome-devtools-mcp@latest", "--executablePath", "/Applications/Ungoogled Chromium.app/Contents/MacOS/Chromium"]
```

Use the actual executable inside your browser's application bundle. On Windows,
escape backslashes in JSON strings, for example `"C:\\Program Files\\Chromium\\chrome.exe"`.
Add `"--headless"` to the array to run without a browser window.

For an already running browser with remote debugging enabled, use its endpoint:

```json
["-y", "chrome-devtools-mcp@latest", "--browser-url", "http://127.0.0.1:9333"]
```

Replace the preset arguments completely when choosing a custom executable;
`--browser-url` selects an existing browser instead. Open Cowork starts Chrome
automatically only for its unmodified preset. Custom configurations are passed
to Chrome DevTools MCP, which launches or connects when a browser tool is used.

See the upstream [configuration guide](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)
for other options. Upstream officially supports Google Chrome and Chrome for
Testing; compatibility with other Chromium browsers depends on that server and
browser versions.

# Printer Bridge Electron App

An Electron application with WebSocket server that receives print jobs via WebSocket and sends them to printers.

## Features

- 🖨️ **WebSocket Server** - Receives print jobs via WebSocket
- 🖥️ **System Tray** - Runs in background with system tray icon
- 📄 **PDF Printing** - Supports base64 PDF documents
- 🔄 **Multiple Print Methods** - Fallback printing methods for Windows
- 🧪 **Test Interface** - Built-in test interface and client

## Quick Start

### 1. Install Dependencies
```bash
cd electron-bridge
npm install
```

### 2. Run the Application
```bash
npm start
```

### 3. Test the Service
```bash
node test-client.js
```

## WebSocket API

The service runs a WebSocket server on `ws://localhost:8912` and accepts the following message types:

### Print Document
```javascript
{
  "type": "print",
  "base64String": "data:application/pdf;base64,JVBERi0xLjQK...",
  "printerName": "HP LaserJet Pro",
  "documentName": "My Document"
}
```

**Response:**
```javascript
{
  "type": "print_response",
  "success": true,
  "message": "Print job sent successfully",
  "result": {
    "success": true,
    "printer": "HP LaserJet Pro",
    "method": "Windows Print Command"
  }
}
```

### Get Available Printers
```javascript
{
  "type": "get_printers"
}
```

**Response:**
```javascript
{
  "type": "printers_response",
  "success": true,
  "printers": ["HP LaserJet Pro", "Microsoft Print to PDF"]
}
```

### Ping
```javascript
{
  "type": "ping"
}
```

**Response:**
```javascript
{
  "type": "pong",
  "message": "Service is running",
  "timestamp": "2025-09-28T23:00:00.000Z"
}
```

## Usage Examples

### JavaScript Client
```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8912');

ws.on('open', () => {
  // Print a document
  ws.send(JSON.stringify({
    type: 'print',
    base64String: 'data:application/pdf;base64,JVBERi0xLjQK...',
    printerName: 'HP LaserJet Pro',
    documentName: 'Invoice'
  }));
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  console.log('Print result:', response);
});
```

### Python Client
```python
import websocket
import json

def on_message(ws, message):
    response = json.loads(message)
    print("Print result:", response)

def on_open(ws):
    # Print a document
    ws.send(json.dumps({
        "type": "print",
        "base64String": "data:application/pdf;base64,JVBERi0xLjQK...",
        "printerName": "HP LaserJet Pro",
        "documentName": "Invoice"
    }))

ws = websocket.WebSocketApp("ws://localhost:8912",
                          on_open=on_open,
                          on_message=on_message)
ws.run_forever()
```

## System Tray Features

The application runs in the system tray with the following options:

- **Show Window** - Show/hide the main window
- **Test Print** - Send a test document to the first available printer
- **Quit** - Close the application

## Building for Distribution

### Build Executable
```bash
npm run build-win    # Windows
npm run build-mac    # macOS
npm run build-linux  # Linux
```

### Build All Platforms
```bash
npm run build
```

## Supported Platforms

- **Windows** - Multiple printing methods with fallbacks
- **macOS** - Uses `lpr` command
- **Linux** - Uses `lp` command

## Troubleshooting

### Service Not Starting
1. Check if port 8912 is available
2. Run as administrator if needed
3. Check Windows Firewall settings

### Print Jobs Failing
1. Verify printer is online and has paper
2. Check printer drivers are installed
3. Use the test print function in the tray menu

### WebSocket Connection Issues
1. Ensure the Electron app is running
2. Check firewall settings
3. Verify the WebSocket URL is correct

## Development

### Project Structure
```
electron-bridge/
├── main.js              # Main Electron process
├── index.html           # UI for the main window
├── test-client.js       # Test WebSocket client
├── package.json         # Dependencies and scripts
└── assets/              # Icons and resources
```

### Adding New Features
1. Modify `main.js` for WebSocket handling
2. Update `index.html` for UI changes
3. Test with `test-client.js`

## License

MIT License

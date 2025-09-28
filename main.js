const { app, BrowserWindow, Tray, Menu } = require("electron");
const WebSocket = require("ws");
const path = require("path");

let mainWindow;
let tray = null;

// Create WebSocket server
function createWebSocketServer() {
  const wss = new WebSocket.Server({ port: 8912 });

  wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", (message) => {
      console.log("Received:", message.toString());

      // Example: send response back
      ws.send(`Echo: ${message}`);
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });

  console.log("WebSocket server running on ws://localhost:8912");
}

// Create Electron window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  mainWindow.loadFile("index.html"); // placeholder UI
  mainWindow.on("closed", () => (mainWindow = null));
}

// Tray (runs in background)
function createTray() {
    const iconPath = path.join(__dirname, "assets", "banana.ico");
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        { label: "Show", click: () => mainWindow.show() },
        { label: "Quit", click: () => app.quit() },
    ]);
  tray.setToolTip("Printers Den");
  tray.setContextMenu(contextMenu);
}

app.on("ready", () => {
  createWindow();
  createWebSocketServer();
  createTray();
});

const { app, BrowserWindow, Tray, Menu } = require("electron");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

let mainWindow;
let tray = null;
let tempDir = path.join(require("os").tmpdir(), "printer-bridge");

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Print job handler
async function handlePrintJob(data) {
  try {
    const { base64String, printerName, documentName = "document" } = data;
    
    if (!base64String || !printerName) {
      throw new Error("base64String and printerName are required");
    }

    console.log(`Print job received: ${documentName} to ${printerName}`);
    
    // Remove data URL prefix if present
    const base64Data = base64String.replace(/^data:.*,/, "");
    
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, "base64");
    
    // Create temporary file
    const tempFilePath = path.join(tempDir, `${documentName}_${Date.now()}.pdf`);
    fs.writeFileSync(tempFilePath, buffer);
    
    // Print the document
    const result = await printFile(tempFilePath, printerName);
    
    // Clean up temporary file
    setTimeout(() => {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }, 5000);
    
    return {
      success: true,
      message: "Print job sent successfully",
      result: result
    };
  } catch (error) {
    console.error("Print job error:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Print file to printer
async function printFile(filePath, printerName) {
  try {
    if (process.platform === "win32") {
      return await printFileWindows(filePath, printerName);
    } else if (process.platform === "darwin") {
      const command = `lpr -P "${printerName}" "${filePath}"`;
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes("Warning")) {
        throw new Error(`Print command failed: ${stderr}`);
      }
      
      return {
        success: true,
        printer: printerName,
        file: filePath,
        output: stdout
      };
    } else {
      const command = `lp -d "${printerName}" "${filePath}"`;
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes("Warning")) {
        throw new Error(`Print command failed: ${stderr}`);
      }
      
      return {
        success: true,
        printer: printerName,
        file: filePath,
        output: stdout
      };
    }
  } catch (error) {
    throw new Error(`Print execution failed: ${error.message}`);
  }
}

// Windows printing methods
async function printFileWindows(filePath, printerName) {
  const methods = [
    () => tryWindowsPrintCommand(filePath, printerName),
    () => tryPowerShellPrint(filePath, printerName),
    () => tryRundll32Print(filePath, printerName)
  ];

  let lastError;
  for (const method of methods) {
    try {
      const result = await method();
      if (result.success) {
        return result;
      }
      lastError = result.error;
    } catch (error) {
      lastError = error.message;
      continue;
    }
  }

  throw new Error(`All printing methods failed. Last error: ${lastError}`);
}

async function tryWindowsPrintCommand(filePath, printerName) {
  try {
    const command = `print /D:"${printerName}" "${filePath}"`;
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr && stderr.includes("Unable to initialize device")) {
      return { success: false, error: "Printer initialization failed" };
    }
    
    return {
      success: true,
      printer: printerName,
      file: filePath,
      method: "Windows Print Command",
      output: stdout
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function tryPowerShellPrint(filePath, printerName) {
  try {
    const command = `powershell -Command "& {Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait -ErrorAction Stop}"`;
    
    const { stdout, stderr } = await execAsync(command);
    
    return {
      success: true,
      printer: printerName,
      file: filePath,
      method: "PowerShell Print",
      output: stdout
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function tryRundll32Print(filePath, printerName) {
  try {
    const command = `rundll32.exe shell32.dll,ShellExec_RunDLL "${filePath}" /p /n"${printerName}"`;
    const { stdout, stderr } = await execAsync(command);
    
    return {
      success: true,
      printer: printerName,
      file: filePath,
      method: "Rundll32 Print",
      output: stdout
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get available printers
async function getAvailablePrinters() {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync("wmic printer get name");
      const printers = stdout
        .split("\n")
        .filter(line => line.trim() && !line.includes("Name"))
        .map(line => line.trim())
        .filter(name => name.length > 0);
      return printers;
    } else if (process.platform === "darwin") {
      const { stdout } = await execAsync("lpstat -p");
      const printers = stdout
        .split("\n")
        .filter(line => line.startsWith("printer"))
        .map(line => line.split(" ")[1])
        .filter(name => name);
      return printers;
    } else {
      const { stdout } = await execAsync("lpstat -p");
      const printers = stdout
        .split("\n")
        .filter(line => line.startsWith("printer"))
        .map(line => line.split(" ")[1])
        .filter(name => name);
      return printers;
    }
  } catch (error) {
    console.error("Error getting printers:", error);
    return [];
  }
}

// Create WebSocket server
function createWebSocketServer() {
  const wss = new WebSocket.Server({ port: 8912 });

  wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log("Received message:", data);

        // Handle different message types
        switch (data.type) {
          case "print":
            const printResult = await handlePrintJob(data);
            ws.send(JSON.stringify({
              type: "print_response",
              ...printResult
            }));
            break;

          case "get_printers":
            const printers = await getAvailablePrinters();
            ws.send(JSON.stringify({
              type: "printers_response",
              success: true,
              printers: printers
            }));
            break;

          case "ping":
            ws.send(JSON.stringify({
              type: "pong",
              message: "Service is running",
              timestamp: new Date().toISOString()
            }));
            break;

          default:
            ws.send(JSON.stringify({
              type: "error",
              message: "Unknown message type"
            }));
        }
      } catch (error) {
        console.error("Error processing message:", error);
        ws.send(JSON.stringify({
          type: "error",
          message: error.message
        }));
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: "welcome",
      message: "Printer Bridge Service connected",
      timestamp: new Date().toISOString()
    }));
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
        { 
            label: "🖨️ Printer Bridge Service", 
            enabled: false 
        },
        { type: "separator" },
        { 
            label: "Status: Running", 
            enabled: false 
        },
        { 
            label: "Port: 8912", 
            enabled: false 
        },
        { type: "separator" },
        { 
            label: "Show Window", 
            click: () => mainWindow.show() 
        },
        { 
            label: "Test Print", 
            click: async () => {
                try {
                    const printers = await getAvailablePrinters();
                    if (printers.length > 0) {
                        // Create a simple test PDF
                        const testPdf = await createTestPDF();
                        const result = await handlePrintJob({
                            base64String: testPdf,
                            printerName: printers[0],
                            documentName: "Test Document"
                        });
                        
                        if (result.success) {
                            tray.setToolTip("Printer Bridge - Test print successful");
                        } else {
                            tray.setToolTip("Printer Bridge - Test print failed");
                        }
                    } else {
                        tray.setToolTip("Printer Bridge - No printers found");
                    }
                } catch (error) {
                    console.error("Test print error:", error);
                    tray.setToolTip("Printer Bridge - Test print error");
                }
            }
        },
        { type: "separator" },
        { 
            label: "Quit", 
            click: () => app.quit() 
        },
    ]);
    
    tray.setToolTip("Printer Bridge Service - Running on port 8912");
    tray.setContextMenu(contextMenu);
}

// Create test PDF (simple version without pdf-lib)
async function createTestPDF() {
    try {
        // Create a simple PDF using a minimal PDF structure
        const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Resources <<
/Font <<
/F1 4 0 R
>>
>>
/Contents 5 0 R
>>
endobj

4 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj

5 0 obj
<<
/Length 200
>>
stream
BT
/F1 24 Tf
50 700 Td
(Printer Bridge Test Document) Tj
0 -30 Td
/F1 12 Tf
(This is a test document to verify printing functionality.) Tj
0 -20 Td
/F1 10 Tf
(Generated at: ${new Date().toLocaleString()}) Tj
ET
endstream
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000268 00000 n 
0000000377 00000 n 
trailer
<<
/Size 6
/Root 1 0 R
>>
startxref
475
%%EOF`;

        return `data:application/pdf;base64,${Buffer.from(pdfContent).toString("base64")}`;
    } catch (error) {
        throw new Error(`Failed to create test PDF: ${error.message}`);
    }
}

app.on("ready", () => {
  createWindow();
  createWebSocketServer();
  createTray();
});

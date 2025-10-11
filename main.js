const { app, BrowserWindow, Tray, Menu } = require("electron");
const WebSocket = require("ws");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");
const acrobatPath = "Acrobat.exe"

const execAsync = promisify(exec);

let mainWindow;
let tray = null;
let tempDir = path.join(require("os").tmpdir(), "sada-bridge");

// Print queue to handle Microsoft Print to PDF limitations
let printQueue = [];
let isProcessingQueue = false;

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Print job handler with queue system
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
    
    // For other printers, print directly
    const result = await printFile(tempFilePath, printerName);
    
    // Clean up temporary file
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (error) {
        console.log(`Cleanup failed: ${error.message}`);
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

// Simple and reliable print function
async function printFile(filePath, printerName) {
  try {
    if (process.platform === "win32") {
      return await printFileWindowsSimple(filePath, printerName);
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
        method: "macOS lpr",
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
        method: "Linux lp",
        output: stdout
      };
    }
  } catch (error) {
    throw new Error(`Print execution failed: ${error.message}`);
  }
}

// Simple Windows printing - try the most reliable methods first
async function printFileWindowsSimple(filePath, printerName) {
  const methods = [
    () => printFileWithElectron(filePath, printerName), // Try Electron native silent print FIRST - NO POPUP!
    () => tryPowerShellPrint(filePath, printerName),
    () => tryRundll32Print(filePath, printerName),
    () => tryWindowsPrintCommand(filePath, printerName)
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
    
    // Check for printer initialization errors
    if (stderr?.includes("Unable to initialize device")) {
      return { 
        success: false, 
        error: "Printer initialization failed",
        printer: printerName,
        file: filePath,
        method: "Windows Print Command",
        output: stderr
      };
    }
    
    // Check for other common print errors
    if (stderr && (stderr.includes("The system cannot find the file specified") || 
                   stderr.includes("Access is denied") ||
                   stderr.includes("The printer name is invalid"))) {
      return { 
        success: false, 
        error: `Print error: ${stderr.trim()}`,
        printer: printerName,
        file: filePath,
        method: "Windows Print Command",
        output: stderr
      };
    }
    
    return {
      success: true,
      printer: printerName,
      file: filePath,
      method: "Windows Print Command",
      output: stdout || stderr
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      printer: printerName,
      file: filePath,
      method: "Windows Print Command"
    };
  }
}

async function tryPowerShellPrint(filePath, printerName) {
  try {
    const command = `powershell -Command "Start-Process -FilePath '${acrobatPath}' -ArgumentList '/t \\"${filePath}\\" \\"${printerName}\\"' -WindowStyle Hidden -Wait"`

    const { stdout } = await execAsync(command)

    return {
      success: true,
      printer: printerName,
      file: filePath,
      method: "PowerShell Print",
      output: stdout,
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function tryPowerShellPrintx(filePath, printerName) {
  try {
    const command = `powershell -Command "& {Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait -ErrorAction Stop}"`;
    
    const { stdout } = await execAsync(command);
    
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
    const { stdout } = await execAsync(command);
    
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

/**
 * Electron Native Silent Print - NO POPUP, NO ACROBAT REQUIRED!
 * 
 * This function uses Electron's built-in printing API to print PDFs completely silently.
 * 
 * Benefits:
 * ✓ 100% silent - no popups, no dialogs, no windows
 * ✓ No external dependencies (no Acrobat.exe needed)
 * ✓ Fast and reliable
 * ✓ Works with all Windows printers
 * ✓ Supports all PDF files
 * 
 * How it works:
 * 1. Creates a hidden BrowserWindow
 * 2. Loads the PDF file into the hidden window
 * 3. Prints using Electron's webContents.print() with silent: true
 * 4. Automatically closes the hidden window after printing
 * 
 * @param {string} filePath - Path to the PDF file to print
 * @param {string} printerName - Name of the printer to use
 * @returns {Promise<Object>} Result object with success status and details
 */
async function printFileWithElectron(filePath, printerName) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Starting Electron silent print: ${filePath} to ${printerName}`);
      
      // Create a hidden window to load and print the PDF
      const printWindow = new BrowserWindow({
        show: false, // Keep window hidden
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          plugins: true // Enable PDF viewer plugin
        },
        width: 800,
        height: 600
      });

      // Handle window errors
      printWindow.on('error', (error) => {
        console.error('Print window error:', error);
        printWindow.close();
        resolve({ success: false, error: error.message });
      });

      // Track if PDF content is actually loaded
      let pdfContentReady = false;
      let printTimeout = null;

      // Listen for when the PDF is actually rendered and ready
      printWindow.webContents.on('did-finish-load', () => {
        console.log('PDF content fully loaded and ready');
        pdfContentReady = true;
      });

      // Load the PDF file
      printWindow.loadFile(filePath).then(() => {
        console.log('PDF file loaded in hidden window, waiting for render...');
        
        // Wait longer for PDF to fully render (especially important for complex PDFs)
        // Increased from 1500ms to 3500ms to ensure proper rendering
        printTimeout = setTimeout(() => {
          if (!pdfContentReady) {
            console.warn('PDF may not be fully rendered yet, but proceeding with print...');
          }
          
          // Configure silent printing options
          const printOptions = {
            silent: true, // This is the key - NO DIALOG, NO POPUP!
            printBackground: true,
            deviceName: printerName, // Specify the target printer
            color: true,
            margins: {
              marginType: 'none'
            },
            landscape: false,
            scaleFactor: 100,
            pagesPerSheet: 1,
            collate: false,
            copies: 1
          };

          console.log('Sending PDF to printer...');
          
          // Print the PDF silently
          printWindow.webContents.print(printOptions, (success, failureReason) => {
            console.log(`Print result - Success: ${success}, Reason: ${failureReason}`);
            
            // Close the hidden window
            printWindow.close();
            
            if (success) {
              resolve({
                success: true,
                printer: printerName,
                file: filePath,
                method: "Electron Native Silent Print",
                output: "Printed successfully without any popup"
              });
            } else {
              resolve({
                success: false,
                error: failureReason || "Print failed",
                printer: printerName,
                file: filePath,
                method: "Electron Native Silent Print"
              });
            }
          });
        }, 3500); // Increased timeout to 3.5 seconds for better PDF rendering
        
      }).catch((error) => {
        console.error('Error loading PDF:', error);
        if (printTimeout) clearTimeout(printTimeout);
        printWindow.close();
        resolve({ 
          success: false, 
          error: `Failed to load PDF: ${error.message}` 
        });
      });

    } catch (error) {
      console.error('Electron print error:', error);
      resolve({ 
        success: false, 
        error: error.message 
      });
    }
  });
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
    } else {
      // Handle both macOS and Linux
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

// write a function to get LAN ip address of the machine using node js
async function getLANIPAddress() {
  const { stdout } = await execAsync("ipconfig");
  const ipAddress = stdout.split("\n").find(line => line.includes("IPv4 Address")).split(":")[1].trim();
  return ipAddress;
}

// Generate self-signed SSL certificates using Node.js crypto
function generateSSLCertificates() {
  const { execSync } = require('child_process');
  
  try {
    console.log('Attempting to generate SSL certificates...');
    
    // Try to generate certificates using OpenSSL if available
    const certPath = path.join(tempDir, 'server.crt');
    const keyPath = path.join(tempDir, 'server.key');
    
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      console.log('Generating new SSL certificates...');
      // Generate self-signed certificate using OpenSSL
      const opensslCmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/C=US/ST=State/L=City/O=SADA Bridge/CN=foodtimesoman.com"`;
      execSync(opensslCmd, { stdio: 'pipe' });
      console.log('SSL certificates generated successfully');
    } else {
      console.log('Using existing SSL certificates');
    }
    
    // Verify the certificates exist and are readable
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      throw new Error('Certificate files were not created');
    }
    
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    
    if (!cert || !key) {
      throw new Error('Certificate files are empty or unreadable');
    }
    
    console.log('SSL certificates loaded successfully');
    return { cert, key };
  } catch (error) {
    console.warn('Could not generate SSL certificates:', error.message);
    console.log('This is normal if OpenSSL is not installed. Falling back to HTTP...');
    return null;
  }
}

// Create WebSocket server
function createWebSocketServer() {
  try {
    const sslOptions = generateSSLCertificates();
    
    if (sslOptions) {
      console.log("SSL certificates generated successfully, starting HTTPS server...");
      
      // Create HTTPS server
      const httpsServer = https.createServer(sslOptions, (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('SADA Bridge HTTPS Server');
      });

      // Create WebSocket server with HTTPS (don't specify port here)
      const wss = new WebSocket.Server({ 
        server: httpsServer
      });

      // Start HTTPS server
      httpsServer.listen(8912, '0.0.0.0', () => {
        console.log("HTTPS WebSocket server running on wss://0.0.0.0:8912");
        console.log("Clients can connect via wss://[your-ip]:8912");
      });

      httpsServer.on('error', (error) => {
        console.error('HTTPS server error:', error);
        console.log('Falling back to HTTP WebSocket server...');
        startHTTPWebSocketServer();
      });

      setupWebSocketHandlers(wss);
      
      wss.on('error', (error) => {
        console.error('WebSocket server error:', error);
      });
    } else {
      console.warn("SSL certificate generation failed, falling back to HTTP WebSocket server");
      startHTTPWebSocketServer();
    }
  } catch (error) {
    console.error('Error creating WebSocket server:', error);
    console.log('Falling back to HTTP WebSocket server...');
    startHTTPWebSocketServer();
  }
}

// Start HTTP WebSocket server as fallback
function startHTTPWebSocketServer() {
  try {
    const wss = new WebSocket.Server({ 
      port: 8912,
      host: '0.0.0.0'
    });
    console.log("HTTP WebSocket server running on ws://0.0.0.0:8912");
    console.log("Clients can connect via ws://[your-ip]:8912");
    setupWebSocketHandlers(wss);
    
    wss.on('error', (error) => {
      console.error('HTTP WebSocket server error:', error);
    });
  } catch (error) {
    console.error('Failed to start HTTP WebSocket server:', error);
  }
}

// Setup WebSocket event handlers
function setupWebSocketHandlers(wss) {
  wss.on("connection", (ws, req) => {
    const clientIP = req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    console.log(`Client connected from ${clientIP}`);

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log("Received message:", data);

        // Handle different message types
        let printResult, printers;
        switch (data.type) {
          case "print": {
            printResult = await handlePrintJob(data);
            ws.send(JSON.stringify({
              type: "print_response",
              ...printResult
            }));
            break;
          }

          case "get_printers": {
            printers = await getAvailablePrinters();
            ws.send(JSON.stringify({
              type: "printers_response",
              success: true,
              printers: printers
            }));
            break;
          }

          case "ping": {
            ws.send(JSON.stringify({
              type: "pong",
              message: "Service is running",
              timestamp: new Date().toISOString()
            }));
            break;
          }

          case "get_lan_ip": {
            const ipAddress = await getLANIPAddress();
            ws.send(JSON.stringify({
              type: "lan_ip_response",
              success: true,
              ipAddress: ipAddress
            }));
            break;
          }

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
      message: "SADA Bridge - Service connected successfully",
      timestamp: new Date().toISOString()
    }));
  });
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
    const iconPath = path.join(__dirname, "assets", "printer.ico");
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: "🖨️ SADA Bridge Service", 
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
        { type: "separator" },
        { 
            label: "Quit", 
            click: () => app.quit() 
        },
    ]);
    
    tray.setToolTip("SADA Bridge Service - Running on port 8912 (WSS/HTTPS)");
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

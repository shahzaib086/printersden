const { app, BrowserWindow, Tray, Menu } = require("electron");
const WebSocket = require("ws");
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
    
    // For Microsoft Print to PDF, save directly to a specified location
    // if (printerName === "Microsoft Print to PDF") {
    //   return await savePDFDirectly(tempFilePath, documentName);
    // }
    
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

// Direct PDF save function - much more reliable than Microsoft Print to PDF
async function savePDFDirectly(tempFilePath, documentName) {
  try {
    // Create a permanent save location
    const desktopPath = path.join(require("os").homedir(), "Desktop");
    const savePath = path.join(desktopPath, `${documentName}_${Date.now()}.pdf`);
    
    // Copy the temporary file to the save location
    fs.copyFileSync(tempFilePath, savePath);
    
    console.log(`PDF saved to: ${savePath}`);
    
    // Clean up temporary file
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (error) {
        console.log(`Cleanup failed: ${error.message}`);
      }
    }, 1000);
    
    return {
      success: true,
      message: "PDF saved successfully",
      result: {
        success: true,
        printer: "Microsoft Print to PDF",
        file: savePath,
        method: "Direct Save",
        output: `PDF saved to Desktop: ${path.basename(savePath)}`
      }
    };
  } catch (error) {
    console.error("PDF save error:", error.message);
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

// Reset printer spooler for Microsoft Print to PDF
async function resetPrinterSpooler() {
  try {
    // Stop and start print spooler service
    await execAsync('net stop spooler');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await execAsync('net start spooler');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds for service to fully start
    console.log('Printer spooler reset completed');
    return true;
  } catch (error) {
    console.log('Printer spooler reset failed:', error.message);
    return false;
  }
}

// Windows printing methods
async function printFileWindows(filePath, printerName) {
  // Special handling for Microsoft Print to PDF
  if (printerName === "Microsoft Print to PDF") {
    return await printToPDFWithRetry(filePath, printerName);
  }

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

// Alternative PDF printing method that works better with Microsoft Print to PDF
async function printPDFAlternative(filePath, printerName) {
  const methods = [
    () => tryPowerShellPrint(filePath, printerName),
    () => tryRundll32Print(filePath, printerName),
    () => tryWindowsPrintCommand(filePath, printerName),
    () => tryAdobeReaderPrint(filePath, printerName),
    () => tryEdgePrint(filePath, printerName)
  ];

  let lastError;
  for (const method of methods) {
    try {
      console.log(`Trying PDF print method: ${method.name}`);
      const result = await method();
      if (result.success) {
        console.log(`PDF print successful with method: ${result.method}`);
        return result;
      }
      lastError = result.error;
      console.log(`Method failed: ${result.error}`);
    } catch (error) {
      lastError = error.message;
      console.log(`Method error: ${error.message}`);
      continue;
    }
  }

  throw new Error(`All PDF printing methods failed. Last error: ${lastError}`);
}

// Try printing with Adobe Reader
async function tryAdobeReaderPrint(filePath, printerName) {
  try {
    // Try different possible locations for Acrobat.exe
    const possiblePaths = [
      // Bundled version in app directory
      path.join(__dirname, "Acrobat.exe"),
      // Bundled version in resources (when packaged)
      path.join(process.resourcesPath, "Acrobat.exe"),
      // System installation
      "C:\\Program Files\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe",
      "C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe"
    ];
    
    let adobePath = null;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        adobePath = possiblePath;
        break;
      }
    }
    
    if (!adobePath) {
      return { success: false, error: "Adobe Reader not found in any expected location" };
    }
    
    console.log(`Using Adobe Reader at: ${adobePath}`);
    const command = `"${adobePath}" /t "${filePath}" "${printerName}"`;
    const { stdout, stderr } = await execAsync(command);
    
    return {
      success: true,
      printer: printerName,
      file: filePath,
      method: "Adobe Reader Print",
      output: stdout || stderr
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Try printing with Microsoft Edge
async function tryEdgePrint(filePath, printerName) {
  try {
    const command = `msedge --headless --disable-gpu --print-to-pdf="${filePath.replace('.pdf', '_edge.pdf')}" --virtual-time-budget=5000 "${filePath}"`;
    const { stdout, stderr } = await execAsync(command);
    
    // Then print the generated PDF
    const edgePdfPath = filePath.replace('.pdf', '_edge.pdf');
    if (fs.existsSync(edgePdfPath)) {
      const printResult = await tryWindowsPrintCommand(edgePdfPath, printerName);
      // Clean up the intermediate file
      setTimeout(() => {
        try {
          if (fs.existsSync(edgePdfPath)) {
            fs.unlinkSync(edgePdfPath);
          }
        } catch (e) {
          console.log(`Edge PDF cleanup failed: ${e.message}`);
        }
      }, 5000);
      
      return {
        success: printResult.success,
        printer: printerName,
        file: filePath,
        method: "Edge Print",
        output: printResult.output || stdout || stderr
      };
    }
    
    return { success: false, error: "Edge PDF generation failed" };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Special handling for Microsoft Print to PDF with retry mechanism
async function printToPDFWithRetry(filePath, printerName) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to print to PDF`);
      
      // Try the print command
      const result = await tryWindowsPrintCommand(filePath, printerName);
      
      if (result.success) {
        return result;
      }
      
      lastError = result.error;
      
      // If it's a printer initialization error and we have retries left
      if (result.error.includes("Printer initialization failed") && attempt < maxRetries) {
        console.log(`Printer initialization failed, attempting to reset spooler...`);
        await resetPrinterSpooler();
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // If it's not a retryable error, break
      if (!result.error.includes("Printer initialization failed")) {
        break;
      }
      
    } catch (error) {
      lastError = error.message;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  throw new Error(`PDF printing failed after ${maxRetries} attempts. Last error: ${lastError}`);
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
    // const command = `powershell -Command "& {Start-Process -FilePath '${filePath}' -Verb Print -WindowStyle Hidden -Wait -ErrorAction Stop}"`;
    const command = `powershell -Command "Start-Process -FilePath '${acrobatPath}' -ArgumentList '/t \\"${filePath}\\" \\"${printerName}\\"' -WindowStyle Hidden -Wait"`

    const { stdout, stderr } = await execAsync(command)

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
        let printResult, printers;
        switch (data.type) {
          case "print":
            printResult = await handlePrintJob(data);
            ws.send(JSON.stringify({
              type: "print_response",
              ...printResult
            }));
            break;

          case "get_printers":
            printers = await getAvailablePrinters();
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

          case "get_lan_ip":
            const ipAddress = await getLANIPAddress();
            ws.send(JSON.stringify({
              type: "lan_ip_response",
              success: true,
              ipAddress: ipAddress
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
      message: "SADA Bridge - Service connected successfully",
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
    
    tray.setToolTip("SADA Bridge Service - Running on port 8912");
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

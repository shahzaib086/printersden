// Test client for Printer Bridge WebSocket service
const WebSocket = require('ws');

class PrinterBridgeClient {
  constructor(url = 'ws://localhost:8912') {
    this.url = url;
    this.ws = null;
  }

  // Helper method to try both HTTP and HTTPS
  static async connectWithFallback(host = 'localhost', port = 8912) {
    const client = new PrinterBridgeClient(`wss://${host}:${port}`);
    
    try {
      console.log(`Attempting WSS connection to wss://${host}:${port}...`);
      await client.connect();
      console.log('✅ Connected via WSS (HTTPS)');
      return client;
    } catch (wssError) {
      console.log('WSS connection failed, trying WS (HTTP)...');
      client.disconnect();
      
      const httpClient = new PrinterBridgeClient(`ws://${host}:${port}`);
      try {
        await httpClient.connect();
        console.log('✅ Connected via WS (HTTP)');
        return httpClient;
      } catch (wsError) {
        console.error('Both WSS and WS connections failed');
        throw new Error(`WSS Error: ${wssError.message}, WS Error: ${wsError.message}`);
      }
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        console.log('✅ Connected to Printer Bridge Service');
        resolve();
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        console.log('📨 Received:', message);
      });

      this.ws.on('close', () => {
        console.log('❌ Connection closed');
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      });
    });
  }

  async sendMessage(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve) => {
      const messageHandler = (data) => {
        const response = JSON.parse(data.toString());
        this.ws.removeListener('message', messageHandler);
        resolve(response);
      };

      this.ws.on('message', messageHandler);
      this.ws.send(JSON.stringify(message));
    });
  }

  async getPrinters() {
    console.log('📋 Getting available printers...');
    const response = await this.sendMessage({ type: 'get_printers' });
    return response;
  }

  async printDocument(base64String, printerName, documentName = 'Document') {
    console.log(`🖨️ Printing document "${documentName}" to "${printerName}"...`);
    const response = await this.sendMessage({
      type: 'print',
      base64String: base64String,
      printerName: printerName,
      documentName: documentName
    });
    return response;
  }

  async ping() {
    console.log('🏓 Sending ping...');
    const response = await this.sendMessage({ type: 'ping' });
    return response;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Example usage
async function testPrinterService() {
  let client;
  
  try {
    // Try to connect with fallback (WSS first, then WS)
    client = await PrinterBridgeClient.connectWithFallback();

    // Test ping
    const pingResponse = await client.ping();
    console.log('Ping response:', pingResponse);

    // Get available printers
    const printersResponse = await client.getPrinters();
    console.log('Available printers:', printersResponse.printers);

    if (printersResponse.printers && printersResponse.printers.length > 0) {
      // Create a simple test PDF
      const testPdf = createTestPDF();
      
      // Print to the first available printer
      const printResponse = await client.printDocument(
        testPdf,
        printersResponse.printers[0],
        'Test Document'
      );
      
      console.log('Print response:', printResponse);
    } else {
      console.log('No printers available');
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

// Create a simple test PDF
function createTestPDF() {
  // This is a minimal PDF in base64 format
  return 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKL01lZGlhQm94IFswIDAgNTk1IDg0Ml0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA0IDAgUgo+Pgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoyNTAgNzAwIFRkCihUZXN0IERvY3VtZW50KSBUagoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYKMDAwMDAwMDAwOSAwMDAwMCBuCjAwMDAwMDAwNTggMDAwMDAgbgowMDAwMDAwMTE1IDAwMDAwIG4KMDAwMDAwMDI2OCAwMDAwMCBuCjAwMDAwMDAzNzcgMDAwMDAgbgp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQ3NQolJUVPRgo=';
}

// Test with specific IP address
async function testWithIP(ipAddress = '192.168.1.132') {
  console.log(`\n🔍 Testing connection to ${ipAddress}:8912`);
  let client;
  
  try {
    client = await PrinterBridgeClient.connectWithFallback(ipAddress);
    
    // Test ping
    const pingResponse = await client.ping();
    console.log('✅ Ping successful:', pingResponse);
    
    // Get available printers
    const printersResponse = await client.getPrinters();
    console.log('✅ Available printers:', printersResponse.printers);
    
  } catch (error) {
    console.error('❌ Test with IP failed:', error);
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Test with specific IP address
    testWithIP(args[0]);
  } else {
    // Test with localhost
    testPrinterService();
  }
}

module.exports = PrinterBridgeClient;

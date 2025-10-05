const WebSocket = require('ws');

// Test the simplified printer bridge
async function testPrinterBridge() {
  const ws = new WebSocket('ws://localhost:8912');
  
  ws.on('open', function() {
    console.log('Connected to printer bridge');
    
    // Test 1: Get available printers
    console.log('\n=== Test 1: Get Printers ===');
    ws.send(JSON.stringify({type: 'get_printers'}));
    
    // Test 2: Test print to Microsoft Print to PDF (should save to Desktop)
    setTimeout(() => {
      console.log('\n=== Test 2: Print to Microsoft Print to PDF ===');
      const testPdf = createTestPDF();
      ws.send(JSON.stringify({
        type: 'print',
        base64String: testPdf,
        printerName: 'Microsoft Print to PDF',
        documentName: 'Test Document Simple'
      }));
    }, 2000);
    
    // Test 3: Test print to another printer (if available)
    setTimeout(() => {
      console.log('\n=== Test 3: Print to Another Printer ===');
      const testPdf = createTestPDF();
      ws.send(JSON.stringify({
        type: 'print',
        base64String: testPdf,
        printerName: 'Microsoft XPS Document Writer', // Alternative to PDF
        documentName: 'Test Document XPS'
      }));
    }, 5000);
  });
  
  ws.on('message', function(data) {
    const response = JSON.parse(data);
    console.log('Response:', JSON.stringify(response, null, 2));
  });
  
  ws.on('error', function(error) {
    console.error('WebSocket error:', error);
  });
  
  ws.on('close', function() {
    console.log('Connection closed');
  });
}

function createTestPDF() {
  // Simple PDF content
  return 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKL01lZGlhQm94IFswIDAgNTk1IDg0Ml0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA0IDAgUgo+Pgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoyNTAgNzAwIFRkCihUZXN0IERvY3VtZW50KSBUagoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYKMDAwMDAwMDAwOSAwMDAwMCBuCjAwMDAwMDAwNTggMDAwMDAgbgowMDAwMDAwMTE1IDAwMDAwIG4KMDAwMDAwMDI2OCAwMDAwMCBuCjAwMDAwMDAzNzcgMDAwMDAgbgp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQ3NQolJUVPRgo=';
}

// Run the test
testPrinterBridge();

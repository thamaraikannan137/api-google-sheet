// Quick test script to connect spreadsheet
// Run: node test-connect.js YOUR_SPREADSHEET_ID

const fetch = require('node-fetch');

const spreadsheetId = process.argv[2];

if (!spreadsheetId) {
  console.error('❌ Please provide spreadsheet ID as argument');
  console.log('Usage: node test-connect.js YOUR_SPREADSHEET_ID');
  process.exit(1);
}

async function connectSpreadsheet() {
  try {
    const response = await fetch('http://localhost:3000/auth/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ spreadsheetId }),
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!', data);
      console.log('\n📋 You can now use:');
      console.log('  GET  http://localhost:3000/expenses');
      console.log('  POST http://localhost:3000/expenses');
    } else {
      console.error('❌ Error:', data);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    console.log('\n💡 Make sure:');
    console.log('  1. Server is running (npm run dev)');
    console.log('  2. You are authenticated (visit http://localhost:3000/auth/google)');
    console.log('  3. You run this from the same browser session');
  }
}

connectSpreadsheet();


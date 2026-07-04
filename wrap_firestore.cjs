const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server/services/firestoreService.ts');
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('export async function _getFirestoreDoc')) {
  // Rename exports to internal functions
  content = content.replace(/export async function getFirestoreDoc/g, 'export async function _getFirestoreDoc');
  content = content.replace(/export async function setFirestoreDoc/g, 'export async function _setFirestoreDoc');
  content = content.replace(/export async function deleteFirestoreDoc/g, 'export async function _deleteFirestoreDoc');
  content = content.replace(/export async function getFirestoreCollection/g, 'export async function _getFirestoreCollection');

  // Add the wrapper functions at the bottom
  const wrappers = `

// ==========================================
// AUTO-RETRY WRAPPERS FOR ROBUSTNESS
// ==========================================

export async function getFirestoreDoc(collectionName: string, docId: string): Promise<any> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _getFirestoreDoc(collectionName, docId);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(\`⚠️ Auto-retry getFirestoreDoc for \${docId} (\${retries} left)\`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function setFirestoreDoc(collectionName: string, docId: string, data: any): Promise<void> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _setFirestoreDoc(collectionName, docId, data);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(\`⚠️ Auto-retry setFirestoreDoc for \${docId} (\${retries} left)\`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function deleteFirestoreDoc(collectionName: string, docId: string): Promise<void> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _deleteFirestoreDoc(collectionName, docId);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(\`⚠️ Auto-retry deleteFirestoreDoc for \${docId} (\${retries} left)\`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export async function getFirestoreCollection(collectionName: string): Promise<any[]> {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await _getFirestoreCollection(collectionName);
    } catch (err: any) {
      if (retries === 0) throw err;
      console.warn(\`⚠️ Auto-retry getFirestoreCollection for \${collectionName} (\${retries} left)\`);
      retries--;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
`;
  
  content += wrappers;
  fs.writeFileSync(file, content);
  console.log("Wrapped functions with auto-retry.");
} else {
  console.log("Already wrapped.");
}

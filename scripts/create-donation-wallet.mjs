import { Wallet } from 'ethers';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Wallet setup requires an interactive local terminal. It will not run in CI or a redirected shell.');
  process.exit(1);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });

async function readSecret(label) {
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = '';
  return new Promise((resolve, reject) => {
    const onData = chunk => {
      const text = chunk.toString('utf8');
      for (const character of text) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Wallet creation canceled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on('data', onData);
  });
}

console.log('\nGameDeck donation wallet — secure local setup');
console.log('This creates one EVM address usable on Ethereum, Base, and Polygon.');
console.log('The encrypted keystore is stored outside the repository. Nothing is transmitted.\n');

const consent = (await prompt.question('Type CREATE to continue: ')).trim();
if (consent !== 'CREATE') {
  console.log('Canceled. No wallet was created.');
  prompt.close();
  process.exit(0);
}
prompt.close();

const password = await readSecret('Create a strong keystore password (12+ characters): ');
const confirmation = await readSecret('Confirm the password: ');
if (password.length < 12 || password !== confirmation) {
  console.error('Passwords must match and contain at least 12 characters. No wallet was created.');
  process.exit(1);
}

const wallet = Wallet.createRandom();
const phrase = wallet.mnemonic?.phrase || '';
const words = phrase.split(' ');
console.log('\nWRITE THIS RECOVERY PHRASE ON PAPER. Never send it by email, chat, issue, or pull request.\n');
console.log(phrase);
console.log('\nGameDeck cannot recover this phrase or your password.');
const verification = createInterface({ input: process.stdin, output: process.stdout });
const proof = (await verification.question('To confirm your backup, type recovery words 3 and 10 separated by one space: ')).trim().toLowerCase();
if (proof !== `${words[2]} ${words[9]}`) {
  console.error('Backup confirmation failed. No wallet was saved.');
  verification.close();
  process.exit(1);
}
verification.close();

console.log('\nEncrypting the keystore. This can take a moment…');
const encrypted = await wallet.encrypt(password);
const vault = process.env.GAMEDECK_WALLET_VAULT || path.join(os.homedir(), 'Documents', 'GameDeck Vault');
await mkdir(vault, { recursive: true });
const keystorePath = path.join(vault, 'gamedeck-evm-keystore.json');
const publicPath = path.join(vault, 'PUBLIC-ADDRESS.txt');
await writeFile(keystorePath, encrypted, { mode: 0o600, flag: 'wx' });
await writeFile(publicPath, `${wallet.address}\n`, { mode: 0o600, flag: 'wx' });
if (process.platform !== 'win32') {
  await chmod(keystorePath, 0o600);
  await chmod(publicPath, 0o600);
}

console.clear();
console.log('Wallet created and encrypted locally.');
console.log(`Public address: ${wallet.address}`);
console.log(`Encrypted keystore: ${keystorePath}`);
console.log('Back up the keystore and paper recovery phrase in two separate secure locations before accepting funds.');
console.log('\nTo publish this address, add it to config/donations.json. Never copy the keystore or recovery phrase into the repository.');

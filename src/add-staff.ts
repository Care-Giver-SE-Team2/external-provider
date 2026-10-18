// Adds a staff account who can sign in to the portal, or sets a new password for one.
//   npm run add-staff -- <username> [--name "Alan Tan"] [--role Manager]
//   npm run add-staff -- <username> --remove
// The password is asked for, never taken as an argument, so it stays out of the shell's history.

import { parseArgs } from 'node:util';
import { MIN_PASSWORD, hashPassword, normaliseUsername, readStaff, writeStaff } from './server/auth.ts';
import { ENV_FILE, loadConfig } from './server/config.ts';
import { askHidden } from './server/prompt.ts';
import { createSettings } from './server/settings.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: 'string' }, role: { type: 'string' }, remove: { type: 'boolean' } },
});

const username = normaliseUsername(positionals[0] ?? '');
if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
  console.error('Usage: npm run add-staff -- <username> [--name "Full Name"] [--role Manager] [--remove]');
  console.error('A username is 2 to 40 letters, digits, dots, dashes or underscores.');
  process.exit(1);
}

const { dataDir } = loadConfig(createSettings({ envFile: ENV_FILE }));
const staff = await readStaff(dataDir);
const existing = staff.find((m) => m.username === username);

if (values.remove) {
  if (!existing) {
    console.error(`No account "${username}".`);
    process.exit(1);
  }
  await writeStaff(dataDir, staff.filter((m) => m !== existing));
  console.log(`Removed "${username}". Sessions already open end within an hour of idling, or on restart.`);
  process.exit(0);
}

const password = await askHidden(`Password for ${username}: `);
if (password.length < MIN_PASSWORD) {
  console.error(`The password must be at least ${MIN_PASSWORD} characters.`);
  process.exit(1);
}
if (process.stdin.isTTY && (await askHidden('Again: ')) !== password) {
  console.error('The passwords do not match.');
  process.exit(1);
}

const member = {
  username,
  name: values.name ?? existing?.name ?? username,
  role: values.role ?? existing?.role ?? 'Staff',
  passwordHash: await hashPassword(password),
};
await writeStaff(dataDir, existing ? staff.map((m) => (m === existing ? member : m)) : [...staff, member]);
console.log(`${existing ? 'Updated' : 'Added'} "${username}" (${member.name}, ${member.role}). They can sign in now.`);

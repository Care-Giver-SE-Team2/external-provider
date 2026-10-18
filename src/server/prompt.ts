// Asking for a secret on the command line, without echoing it.

import { createInterface } from 'node:readline/promises';

/** Reads a line without echoing it when typed at a terminal. Piped input (scripts) is read as it is. */
export async function askHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin });
    const line = await new Promise<string>((resolve) => rl.once('line', resolve));
    rl.close();
    return line;
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let typed = '';
  return new Promise((resolve) => {
    const onData = (chars: string) => {
      for (const c of chars) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(typed);
          return;
        }
        if (c === '\u0003') process.exit(130); // Ctrl-C
        if (c === '\u007f' || c === '\b') typed = typed.slice(0, -1);
        else typed += c;
      }
    };
    stdin.on('data', onData);
  });
}

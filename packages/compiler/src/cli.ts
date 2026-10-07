import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseAetherSchema } from './parser.js';
import { generateTypeScript } from './codegen-ts.js';
import { generateSwift } from './codegen-swift.js';
import { generateKotlin } from './codegen-kotlin.js';

export function runCli(args: string[]): void {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Aether-WV Compiler (aetherc) - Schema compiler for WebView Heterogeneous IPC

Usage:
  aetherc compile <schema.aether> [options]

Options:
  --out-ts <path>       Output path for generated TypeScript (.ts)
  --out-swift <path>    Output path for generated Swift (.swift)
  --out-kotlin <path>   Output path for generated Kotlin (.kt)
  -h, --help            Show this help screen
`);
    return;
  }

  const cmd = args[0];
  if (cmd !== 'compile') {
    console.error(`Unknown command: ${cmd}. Use 'aetherc --help' for usage.`);
    process.exit(1);
  }

  const schemaPath = args[1];
  if (!schemaPath) {
    console.error('Error: Missing schema file path.');
    process.exit(1);
  }

  let outTs: string | null = null;
  let outSwift: string | null = null;
  let outKotlin: string | null = null;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--out-ts') outTs = args[++i];
    if (args[i] === '--out-swift') outSwift = args[++i];
    if (args[i] === '--out-kotlin') outKotlin = args[++i];
  }

  const fullSchemaPath = resolve(process.cwd(), schemaPath);
  const content = readFileSync(fullSchemaPath, 'utf8');
  const ast = parseAetherSchema(content);

  console.log(`[aetherc] Parsed package '${ast.packageName}' with ${ast.services.length} services and ${ast.messages.length} messages.`);

  if (outTs) {
    const fullOut = resolve(process.cwd(), outTs);
    mkdirSync(dirname(fullOut), { recursive: true });
    writeFileSync(fullOut, generateTypeScript(ast), 'utf8');
    console.log(`[aetherc] Generated TypeScript -> ${outTs}`);
  }

  if (outSwift) {
    const fullOut = resolve(process.cwd(), outSwift);
    mkdirSync(dirname(fullOut), { recursive: true });
    writeFileSync(fullOut, generateSwift(ast), 'utf8');
    console.log(`[aetherc] Generated Swift -> ${outSwift}`);
  }

  if (outKotlin) {
    const fullOut = resolve(process.cwd(), outKotlin);
    mkdirSync(dirname(fullOut), { recursive: true });
    writeFileSync(fullOut, generateKotlin(ast), 'utf8');
    console.log(`[aetherc] Generated Kotlin -> ${outKotlin}`);
  }

  console.log('[aetherc] Compilation finished successfully.');
}

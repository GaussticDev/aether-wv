#!/usr/bin/env node
import { runCli } from '../dist/packages/compiler/src/cli.js';

runCli(process.argv.slice(2));

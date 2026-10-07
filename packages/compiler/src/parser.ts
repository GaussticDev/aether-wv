import { SchemaAST, ServiceDefinition, MessageDefinition, MethodDefinition, FieldDefinition } from './ast.js';

export function parseAetherSchema(content: string): SchemaAST {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'));

  let packageName = 'app';
  const services: ServiceDefinition[] = [];
  const messages: MessageDefinition[] = [];

  let currentService: ServiceDefinition | null = null;
  let currentMessage: MessageDefinition | null = null;

  for (const line of lines) {
    if (line.startsWith('syntax')) {
      continue;
    }

    if (line.startsWith('package ')) {
      const match = line.match(/^package\s+([\w\.]+);$/);
      if (match) packageName = match[1];
      continue;
    }

    // Service start: service Name {
    if (line.startsWith('service ')) {
      const match = line.match(/^service\s+(\w+)\s*\{?$/);
      if (match) {
        currentService = { name: match[1], methods: [] };
        services.push(currentService);
      }
      continue;
    }

    // Message start: message Name {
    if (line.startsWith('message ')) {
      const match = line.match(/^message\s+(\w+)\s*\{?$/);
      if (match) {
        currentMessage = { name: match[1], fields: [] };
        messages.push(currentMessage);
      }
      continue;
    }

    // Block close: }
    if (line === '}') {
      currentService = null;
      currentMessage = null;
      continue;
    }

    // Inside service: rpc MethodName(Input) returns (stream Output);
    if (currentService) {
      const rpcMatch = line.match(
        /^rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\);?$/
      );
      if (rpcMatch) {
        const method: MethodDefinition = {
          name: rpcMatch[1],
          isInputStream: !!rpcMatch[2],
          inputType: rpcMatch[3],
          isOutputStream: !!rpcMatch[4],
          outputType: rpcMatch[5],
        };
        currentService.methods.push(method);
      }
      continue;
    }

    // Inside message: type field_name = 1;
    if (currentMessage) {
      const fieldMatch = line.match(/^([\w\.]+)\s+(\w+)\s*=\s*(\d+);?$/);
      if (fieldMatch) {
        const field: FieldDefinition = {
          type: fieldMatch[1],
          name: fieldMatch[2],
          tag: parseInt(fieldMatch[3], 10),
        };
        currentMessage.fields.push(field);
      }
      continue;
    }
  }

  return {
    packageName,
    services,
    messages,
  };
}

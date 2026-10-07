import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseAetherSchema,
  generateTypeScript,
  generateSwift,
  generateKotlin,
} from '../packages/compiler/src/index.js';

describe('Aether Schema Compiler', () => {
  const schemaPath = resolve(process.cwd(), 'examples/schema.aether');
  const schemaContent = readFileSync(schemaPath, 'utf8');

  test('parses .aether schema into SchemaAST correctly', () => {
    const ast = parseAetherSchema(schemaContent);

    assert.equal(ast.packageName, 'mobile.system');
    assert.equal(ast.services.length, 2);
    assert.equal(ast.messages.length, 6);

    const deviceService = ast.services.find((s) => s.name === 'DeviceService')!;
    assert.ok(deviceService);
    assert.equal(deviceService.methods.length, 2);

    const rpcMethod = deviceService.methods.find((m) => m.name === 'GetDeviceInfo')!;
    assert.equal(rpcMethod.isOutputStream, false);
    assert.equal(rpcMethod.inputType, 'DeviceRequest');
    assert.equal(rpcMethod.outputType, 'DeviceResponse');

    const streamMethod = deviceService.methods.find((m) => m.name === 'StreamAccelerometer')!;
    assert.equal(streamMethod.isOutputStream, true);
    assert.equal(streamMethod.outputType, 'SensorData');
  });

  test('generates valid TypeScript client code with typed methods', () => {
    const ast = parseAetherSchema(schemaContent);
    const tsCode = generateTypeScript(ast);

    assert.ok(tsCode.includes('export interface DeviceRequest'));
    assert.ok(tsCode.includes('export class DeviceServiceClient'));
    assert.ok(tsCode.includes('async getDeviceInfo(request: DeviceRequest): Promise<DeviceResponse>'));
    assert.ok(tsCode.includes('async *streamAccelerometer(request: SensorConfig'));
    assert.ok(tsCode.includes('export class PaymentServiceClient'));
  });

  test('generates valid Swift 6 code with actors and protocols', () => {
    const ast = parseAetherSchema(schemaContent);
    const swiftCode = generateSwift(ast);

    assert.ok(swiftCode.includes('public struct DeviceRequest: Sendable'));
    assert.ok(swiftCode.includes('public protocol DeviceServiceProtocol: Actor'));
    assert.ok(swiftCode.includes('func getDeviceInfo(request: DeviceRequest) async throws -> DeviceResponse'));
    assert.ok(swiftCode.includes('func streamAccelerometer(request: SensorConfig) -> AsyncThrowingStream<SensorData, Error>'));
  });

  test('generates valid Kotlin 2.x code with data classes and Flow', () => {
    const ast = parseAetherSchema(schemaContent);
    const kotlinCode = generateKotlin(ast);

    assert.ok(kotlinCode.includes('package mobile.system'));
    assert.ok(kotlinCode.includes('data class DeviceRequest('));
    assert.ok(kotlinCode.includes('interface DeviceService {'));
    assert.ok(kotlinCode.includes('suspend fun getDeviceInfo(request: DeviceRequest): DeviceResponse'));
    assert.ok(kotlinCode.includes('fun streamAccelerometer(request: SensorConfig): Flow<SensorData>'));
  });
});

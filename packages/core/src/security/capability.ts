import { createHmac } from 'node:crypto';

export interface CapabilityManifest {
  origin: string;
  allowedServices: string[];
  expiresAt: number;
}

export class CapabilityGatekeeper {
  constructor(private readonly secretKey: string = 'aether-internal-secret') {}

  /**
   * Generates a signed capability token for a trusted mini-app origin
   */
  generateToken(manifest: CapabilityManifest): string {
    const payload = JSON.stringify(manifest);
    const signature = createHmac('sha256', this.secretKey).update(payload).digest('hex');
    const b64Payload = Buffer.from(payload).toString('base64url');
    return `${b64Payload}.${signature}`;
  }

  /**
   * Verifies a capability token and checks if the service/method is authorized
   */
  authorize(token: string, currentOrigin: string, serviceName: string, methodName: string): boolean {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [b64Payload, signature] = parts;
    const payload = Buffer.from(b64Payload, 'base64url').toString('utf8');
    const expectedSig = createHmac('sha256', this.secretKey).update(payload).digest('hex');

    if (signature !== expectedSig) {
      return false;
    }

    try {
      const manifest: CapabilityManifest = JSON.parse(payload);
      if (manifest.expiresAt < Date.now()) {
        return false;
      }
      if (manifest.origin !== '*' && currentOrigin !== '*' && manifest.origin !== currentOrigin) {
        return false;
      }

      // Check wildcards and exact service matches
      const target = `${serviceName}.${methodName}`;
      return manifest.allowedServices.some((pattern) => {
        if (pattern === '*') return true;
        if (pattern === serviceName || pattern === `${serviceName}.*`) return true;
        if (pattern === target) return true;
        return false;
      });
    } catch {
      return false;
    }
  }
}

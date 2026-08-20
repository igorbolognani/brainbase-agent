import { describe, expect, it } from 'vitest';
import { classifyIpAddress } from '../ip-safety.js';

describe('IP safety classification', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '0.0.0.0',
  ])('rejects unsafe IPv4 %s', (ip) => {
    expect(classifyIpAddress(ip).safe).toBe(false);
  });

  it.each(['::1', '::', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'ff02::1', '2001:db8::1'])(
    'rejects unsafe IPv6 %s',
    (ip) => {
      expect(classifyIpAddress(ip).safe).toBe(false);
    }
  );

  it.each(['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254'])(
    'rejects IPv4-mapped IPv6 %s',
    (ip) => {
      expect(classifyIpAddress(ip).safe).toBe(false);
    }
  );

  it('accepts representative public addresses', () => {
    expect(classifyIpAddress('93.184.216.34').safe).toBe(true);
    expect(classifyIpAddress('2606:4700:4700::1111').safe).toBe(true);
  });

  it('fails closed for malformed addresses', () => {
    expect(classifyIpAddress('999.1.1.1')).toEqual({ safe: false, reason: 'invalid_ip' });
    expect(classifyIpAddress('not-an-ip')).toEqual({ safe: false, reason: 'invalid_ip' });
  });
});

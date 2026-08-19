/**
 * Utility functions
 */

import { randomUUID } from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}

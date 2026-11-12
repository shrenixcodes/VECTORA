import { ping } from './a';

export function pong(n: number): number {
  return n <= 0 ? 0 : ping(n - 1);
}

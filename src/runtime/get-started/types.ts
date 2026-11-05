/**
 * The handful of types the guided flow's own modules pass between each other.
 *
 * Separate from `runtime/types.ts`, which describes the generated command table: these describe
 * how `get-started`'s phases hand work to one another, and nothing outside this folder uses them.
 */

import type Roark from '@roarkanalytics/sdk';

import type { OutputFormat } from '../output';

export type ClientFor = (options: never) => Roark;

/** One entry of an apply result, which is where a created resource's id comes back. */
export type ConfigChange = { configKey: string; id?: string };
export type ResolveOutput = (options: never) => { format: OutputFormat; color: boolean };

/**
 * Step 1: what the credential says it is.
 *
 * Named so the flow can open with the account and project it is about to change, rather than
 * announcing that something unspecified worked.
 */

import type Roark from '@roarkanalytics/sdk';

import { AuthRequiredError } from '../errors';

export interface Credential {
  email?: string;
  scope?: string;
  defaultProject?: string;
}

/**
 * What the credential says it is, so step one can name the account and project rather than
 * announcing that something unspecified worked. Only a 401 stops the flow: anything else (an
 * older API with no `/v1/me`, a key without the permission) is a thin answer, not a broken one.
 */
export const describeCredential = async (client: Roark, binaryName: string): Promise<Credential> => {
  try {
    const me = (await client.get('/v1/me')) as {
      data?: {
        tokenScope?: string;
        user?: { email?: string } | null;
        defaultProject?: { id?: string } | null;
      };
    };
    const email = me.data?.user?.email;
    const scope = me.data?.tokenScope;
    const defaultProject = me.data?.defaultProject?.id;
    return {
      ...(email === undefined ? {} : { email }),
      ...(scope === undefined ? {} : { scope }),
      ...(defaultProject === undefined ? {} : { defaultProject }),
    };
  } catch (error) {
    if ((error as { status?: number }).status === 401) {
      throw new AuthRequiredError(
        `The stored credential was rejected (401). Run \`${binaryName} auth login\`, then \`${binaryName} get-started\` again.`,
      );
    }
    return {};
  }
};

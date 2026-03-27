import type { ObjectTypeComposerArgumentConfigMapDefinition } from 'graphql-compose';
import type { ExtendedResolveParams } from '../index';

export type PerPageHelperArgsOpts = {
  /**
   * Set limit for default number of returned records
   * if it does not provided in query.
   * By default: 20
   */
  defaultValue?: number;
};

export function perPageHelperArgs(
  opts?: PerPageHelperArgsOpts
): ObjectTypeComposerArgumentConfigMapDefinition<{ perPage: any }> {
  return {
    perPage: {
      type: 'Int',
      defaultValue: opts?.defaultValue || 20,
    },
  };
}

export function perPageHelper(resolveParams: ExtendedResolveParams): number {
  return parseInt(resolveParams.args?.perPage, 10) || 0;
}

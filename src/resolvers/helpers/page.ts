import type { ObjectTypeComposerArgumentConfigMapDefinition } from 'graphql-compose';
import type { ExtendedResolveParams } from '../index';

export function pageHelperArgs(): ObjectTypeComposerArgumentConfigMapDefinition<{ page: any }> {
  return {
    page: {
      type: 'Int',
    },
  };
}

export function pageHelper(resolveParams: ExtendedResolveParams): number {
  return parseInt(resolveParams && resolveParams.args && resolveParams.args.page, 10) || 1;
}

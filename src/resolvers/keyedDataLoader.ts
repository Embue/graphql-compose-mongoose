import { toInputType } from 'graphql-compose';
import type { Resolver, ObjectTypeComposer, InterfaceTypeComposer } from 'graphql-compose';
import type { Model, Document } from 'mongoose';
import {
  projectionHelper,
  prepareNestedAliases,
  prepareAliasesReverse,
  replaceAliases,
} from './helpers';
import type { ExtendedResolveParams } from './index';
import { beforeQueryHelper, beforeQueryHelperLean } from './helpers/beforeQueryHelper';
import { getKeyedDataLoader } from './helpers/keyedDataLoaderHelper';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface KeyedDataLoaderResolverOpts {
  /**
   * Enabling the lean option tells Mongoose to skip instantiating
   * a full Mongoose document and just give you the plain JavaScript objects.
   * Documents are much heavier than vanilla JavaScript objects,
   * because they have a lot of internal state for change tracking.
   * The downside of enabling lean is that lean docs don't have:
   *   Default values
   *   Getters and setters
   *   Virtuals
   * Read more about `lean`: https://mongoosejs.com/docs/tutorials/lean.html
   */
  lean?: boolean;
  lookupByKey: string;
}

type TArgs = {
  key: any;
};

export function keyedDataLoader<TSource = any, TContext = any, TDoc extends Document = any>(
  model: Model<TDoc>,
  tc: ObjectTypeComposer<TDoc, TContext> | InterfaceTypeComposer<TDoc, TContext>,
  opts: KeyedDataLoaderResolverOpts = { lean: false, lookupByKey: '_id' }
): Resolver<TSource, TContext, TArgs, TDoc> {
  if (!model || !model.modelName || !model.schema) {
    throw new Error('First arg for Resolver dataLoader() should be instance of Mongoose Model.');
  }

  if (!tc || !['ObjectTypeComposer', 'DiscriminatorTypeComposer'].includes(tc.constructor.name)) {
    throw new Error(
      'Second arg for Resolver dataLoader() should be instance of ObjectTypeComposer.'
    );
  }

  const aliases = prepareNestedAliases(model.schema);
  const aliasesReverse = prepareAliasesReverse(model.schema);

  return tc.schemaComposer.createResolver<TSource, TArgs>({
    type: tc,
    name: 'dataLoader',
    kind: 'query',
    args: {
      key: tc.hasField(opts.lookupByKey)
        ? toInputType(tc.getFieldTC(opts.lookupByKey)).NonNull
        : 'MongoID!',
    },
    resolve: ((resolveParams: ExtendedResolveParams<TDoc>) => {
      const args = resolveParams.args || {};

      if (!args.key) {
        return Promise.resolve(null);
      }

      if (!resolveParams.info) {
        throw new Error(
          `Cannot use ${tc.getTypeName()}.dataLoader resolver without 'info: GraphQLResolveInfo'`
        );
      }

      const dl = getKeyedDataLoader(
        resolveParams.context,
        resolveParams.info,
        async (keys) => {
          const queryObj = {} as any;
          queryObj[opts.lookupByKey] = { $in: keys };
          resolveParams.query = model.find(queryObj);
          resolveParams.model = model;
          projectionHelper(resolveParams, aliases);

          if (opts?.lean) {
            const result = (await beforeQueryHelperLean(resolveParams)) || [];
            return Array.isArray(result) && aliasesReverse
              ? result.map((r) => replaceAliases(r, aliasesReverse))
              : result;
          } else {
            return beforeQueryHelper(resolveParams) || [];
          }
        },
        opts.lookupByKey
      );

      return dl.load(args.key);
    }) as any,
  });
}
